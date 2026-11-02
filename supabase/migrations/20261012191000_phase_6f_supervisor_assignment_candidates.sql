-- Phase 6F: server-selected eligible assignees for exactly one authorized WO.
-- This is a pre-dispatch read projection: no assignment, consent or roster mutation,
-- and no reuse of legacy Admin-only mutation with Supervisor authority.
create function public.office_supervisor_assignment_candidates(
  p_org uuid,p_work_order uuid,p_expected_scope_fingerprint text,
  p_limit integer default 25,p_after uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $candidates$
declare
  exact jsonb;
  work jsonb;
  team uuid;
  rows jsonb;
  more integer;
  last_id uuid;
begin
  if p_limit not in (25,50) or p_work_order is null or p_org is null then
    raise exception 'Bounded exact candidate request required' using errcode='22023';
  end if;
  -- Single existing Supervisor selected-work guard is authoritative; it checks
  -- current session, tier, scope fingerprint, live team, org, and exact WO.
  exact:=public.office_supervisor_work_detail(p_org,p_work_order,p_expected_scope_fingerprint);
  work:=exact->'work_order';
  if work->>'field_status' not in ('ASSIGNED','IN_PROGRESS')
    or (work->>'team_id') is null then
    raise exception 'Only active assigned or in-progress work has assignee candidates'
      using errcode='22023';
  end if;
  team:=(work->>'team_id')::uuid;
  with eligible as (
    select u.id,u.email
    from private.contractor_team_memberships m
      join private.account_work_access a
        on a.organization_id=m.organization_id and a.user_id=m.user_id
      join auth.users u on u.id=m.user_id
    where m.organization_id=p_org and m.team_id=team and m.active
      and a.work_role='CONTRACTOR' and a.active and a.disabled_at is null
      and a.suspension_authority is null and u.deleted_at is null
      and u.email_confirmed_at is not null
      and (p_after is null or u.id>p_after)
      and private.is_assignable_contractor(u.id,p_org)
    order by u.id asc
    limit p_limit+1
  ), numbered as (
    select e.*,row_number() over(order by id asc) rn from eligible e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id',id,'label',coalesce(nullif(btrim(email),''),'Contractor account'))
      order by id) filter(where rn<=p_limit),'[]'::jsonb),
    count(*) filter(where rn>p_limit),
    (min(id::text) filter(where rn=p_limit))::uuid
  into rows,more,last_id
  from numbered;
  return jsonb_build_object(
    'organization_id',p_org,'work_order_id',p_work_order,
    'team_id',team,'scope_fingerprint',p_expected_scope_fingerprint,
    'field_status',work->>'field_status',
    'requires_current_contractor_consent',work->>'field_status'='IN_PROGRESS',
    'candidate_contractors',rows,'next_after',case when more>0 then last_id else null end);
end;
$candidates$;
revoke all on function public.office_supervisor_assignment_candidates(uuid,uuid,text,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.office_supervisor_assignment_candidates(uuid,uuid,text,integer,uuid)
  to authenticated;
