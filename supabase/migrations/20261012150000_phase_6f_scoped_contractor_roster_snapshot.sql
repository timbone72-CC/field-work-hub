-- Phase 6F: bounded staffing-only roster projection. No work/photo visibility,
-- account creation, roster mutation or implied WO team handoff.
-- Only eligible same-organization active verified Contractors are returned.
create function public.office_contractor_roster_snapshot(
  p_org uuid, p_environment text, p_after uuid default null, p_limit integer default 25
) returns jsonb
language plpgsql security definer set search_path='' as $roster_snapshot$
declare
  caller_tier smallint;
  rows_page jsonb;
  next_cursor text;
begin
  if p_org is null or p_environment is null
    or p_environment not in ('TEST','PRODUCTION')
    or p_limit is null or p_limit not between 1 and 50
    or not private.current_identity_valid()
    or private.current_work_role(p_org) is distinct from 'SUPERVISOR'
    or not exists(select 1 from private.org_work_settings s
      where s.organization_id=p_org and s.supervisor_work_ready) then
    raise exception 'Current scoped staffing authority required' using errcode='42501';
  end if;

  select g.tier into caller_tier from private.supervisor_grants g
    where g.organization_id=p_org and g.user_id=auth.uid() and g.active;
  if caller_tier is null or caller_tier<2 then
    raise exception 'Tier 2/3 staffing authority required' using errcode='42501';
  end if;
  if caller_tier=2 and not exists(
    select 1 from private.supervisor_team_scopes scope
    where scope.organization_id=p_org and scope.user_id=auth.uid()
      and private.has_team_capability(p_org,scope.team_id,'PLACE_UNASSIGNED_CONTRACTOR')
  ) then
    raise exception 'A current supervised team is required' using errcode='42501';
  end if;

  -- A Tier 2 manager sees only its existing teams and available unplaced
  -- Contractors. Tier 3 sees this organization's current roster, not jobs.
  -- The busy flag is advisory only; manage_idle_contractor_roster rechecks
  -- exact assignment identity under locks before any placement/transfer.
  with eligible as (
    select a.user_id,u.email,
      case when m.active then m.team_id else null end as team_id,
      m.revision,
      not exists(
        select 1 from public.work_orders w
        where w.organization_id=p_org
          and w.field_status not in ('FIELD_COMPLETE','CANCELLED')
          and (w.assigned_user_id=a.user_id or w.pending_assignee_user_id=a.user_id)
      ) and not exists(
        select 1 from public.work_order_assignments wa
        join public.work_orders w on w.current_run_id=wa.run_id
        where w.organization_id=p_org
          and w.field_status not in ('FIELD_COMPLETE','CANCELLED')
          and wa.assigned_user_id=a.user_id and wa.assignment_ended_at is null
      ) as idle
    from private.account_work_access a
    join auth.users u on u.id=a.user_id
    left join private.contractor_team_memberships m
      on m.organization_id=a.organization_id and m.user_id=a.user_id
    where a.organization_id=p_org and a.work_role='CONTRACTOR'
      and a.active and a.disabled_at is null
      and a.suspension_authority is null
      and private.account_identity_ready(p_org,a.user_id,'CONTRACTOR')
      and (p_after is null or a.user_id>p_after)
      and (caller_tier=3 or m.active is not true or
        private.has_team_capability(p_org,m.team_id,'MANAGE_CONTRACTOR'))
    order by a.user_id limit p_limit+1
  ), numbered as (
    select e.*,row_number() over(order by e.user_id) as rn from eligible e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id',user_id,'email',email,'team_id',team_id,
      'revision',revision,'idle',idle
    ) order by user_id) filter(where rn<=p_limit),'[]'::jsonb),
    case when count(*)>p_limit then
      max(user_id::text) filter(where rn=p_limit) else null end
  into rows_page,next_cursor from numbered;
  return jsonb_build_object(
    'organization_id',p_org,'contractors',rows_page,'next_after',next_cursor);
end;
$roster_snapshot$;

revoke all on function public.office_contractor_roster_snapshot(uuid,text,uuid,integer)
  from public,anon;
grant execute on function public.office_contractor_roster_snapshot(uuid,text,uuid,integer)
  to authenticated,service_role;
