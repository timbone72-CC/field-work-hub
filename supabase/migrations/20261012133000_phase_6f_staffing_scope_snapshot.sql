-- Phase 6F source-only staffing view: no account, team, invitation or work mutation.
-- The narrow projection supplies exact owner-set quota revision and explicitly
-- allowed team identifiers for guarded Admin invitation requests.
create function public.office_staffing_scope_snapshot(
  p_org uuid,p_environment text,p_after uuid default null,p_limit integer default 25
) returns jsonb
language plpgsql security definer set search_path='' as $staff$
declare
  quota private.org_office_allowances%rowtype;
  caller_owner boolean;
  caller_tier smallint;
  active_count bigint;
  reserved_count bigint;
  team_page jsonb;
  next_cursor text;
begin
  if p_org is null or p_environment is null
    or p_environment not in ('TEST','PRODUCTION')
    or p_limit is null or p_limit not between 1 and 50
    or not private.current_identity_valid() then
    raise exception 'Verified staffing scope required' using errcode='42501';
  end if;
  caller_owner:=private.is_current_platform_owner(p_environment);
  if not caller_owner then
    if private.current_work_role(p_org) is distinct from 'SUPERVISOR'
      or not exists(select 1 from private.org_work_settings s
          where s.organization_id=p_org and s.supervisor_work_ready) then
      raise exception 'Current Tier 2/3 staffing authority required' using errcode='42501';
    end if;
    select g.tier into caller_tier from private.supervisor_grants g
      where g.organization_id=p_org and g.user_id=auth.uid() and g.active;
    if caller_tier is null or caller_tier < 2 then
      raise exception 'Tier 2/3 staffing authority required' using errcode='42501';
    end if;
  end if;
  select * into quota from private.org_office_allowances q
    where q.organization_id=p_org;
  if not found then raise exception 'Office allowance unavailable' using errcode='42501';end if;
  -- A Product Owner only gets aggregate office metadata, never customer WOs
  -- or photos. A Tier 2 user sees precisely current explicit team scopes.
  with eligible as (
    select t.id,t.name from public.admin_teams t
    where t.organization_id=p_org and t.active
      and (p_after is null or t.id>p_after)
      and (caller_owner or (caller_tier=3) or
        private.has_team_capability(p_org,t.id,'MANAGE_ADMIN'))
    order by t.id limit p_limit+1
  ), numbered as (
    select e.id,e.name,row_number() over(order by e.id) as rn from eligible e
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('team_id',id,'name',name)
      order by id) filter(where rn<=p_limit),'[]'::jsonb),
    case when count(*)>p_limit then
      max(id::text) filter(where rn=p_limit) else null end
  into team_page,next_cursor from numbered;

  select count(*) into active_count from private.account_work_access a
    where a.organization_id=p_org and a.work_role='ADMIN'
      and a.active and a.disabled_at is null;
  select count(*) into reserved_count from private.office_seat_reservations s
    where s.organization_id=p_org and s.requested_role='ADMIN'
      and s.state='RESERVED';
  return jsonb_build_object(
    'organization_id',p_org,
    'allowance_revision',quota.revision,
    'admin_limit',quota.admin_limit,
    'admin_active',active_count,
    'admin_reserved',reserved_count,
    'admin_available',greatest(0,quota.admin_limit-active_count-reserved_count),
    'teams',team_page,
    'next_after',next_cursor
  );
end;
$staff$;
revoke all on function public.office_staffing_scope_snapshot(uuid,text,uuid,integer)
  from public,anon;
grant execute on function public.office_staffing_scope_snapshot(uuid,text,uuid,integer)
  to authenticated,service_role;
