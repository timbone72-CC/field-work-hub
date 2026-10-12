-- Phase 6F: source-only owner enrollment of an already verified SUPERVISOR
-- identity. Does not create Auth users, deliver invitations or turn on work.
-- An existing reserved Supervisor seat is required and consumed exactly once.
create table private.supervisor_enrollment_actions (
  action_id uuid primary key,
  organization_id uuid not null,
  user_id uuid not null,
  reservation_action_id uuid not null unique references private.office_seat_reservations(action_id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  expected_access_revision uuid not null,
  tier smallint not null check (tier between 1 and 3),
  team_ids uuid[] not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  environment text not null check (environment in ('TEST','PRODUCTION')),
  result_grant_revision uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,user_id)
    references private.account_work_access(organization_id,user_id) on delete restrict
);
alter table private.supervisor_enrollment_actions enable row level security;
revoke all on private.supervisor_enrollment_actions from public,anon,authenticated,service_role;
grant select,insert on private.supervisor_enrollment_actions to service_role;

create function public.owner_enroll_existing_supervisor(
 p_action uuid,p_org uuid,p_user uuid,p_reservation uuid,
 p_expected_access_revision uuid,p_tier smallint,p_team_ids uuid[],
 p_reason text,p_environment text
) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  prior private.supervisor_enrollment_actions%rowtype;
  reserved private.office_seat_reservations%rowtype;
  access_row private.account_work_access%rowtype;
  normalized uuid[];
  revision uuid:=gen_random_uuid();
begin
  if p_action is null or p_org is null or p_user is null or p_reservation is null
    or p_expected_access_revision is null or p_tier is null or p_tier not between 1 and 3
    or p_team_ids is null or array_ndims(p_team_ids)>1
    or array_position(p_team_ids,null) is not null
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000
    or p_environment is null or p_environment not in ('TEST','PRODUCTION')
  then raise exception 'Explicit Supervisor enrollment inputs required' using errcode='22023';end if;
  select coalesce(array_agg(x order by x),'{}'::uuid[]) into normalized
    from unnest(p_team_ids) x;
  if cardinality(normalized) <> (select count(distinct x) from unnest(normalized) x)
    or (p_tier=3 and cardinality(normalized)<>0)
    or (p_tier<3 and cardinality(normalized)=0)
    or cardinality(normalized)>100
  then raise exception 'Explicit unique scoped teams required' using errcode='22023';end if;
  if not private.is_current_platform_owner(p_environment) or auth.uid()=p_user then
    raise exception 'Separate verified Product Owner required' using errcode='42501';end if;
  perform private.lock_account_lifecycle();
  if not private.is_current_platform_owner(p_environment) then
    raise exception 'Owner session changed' using errcode='42501';end if;
  select * into prior from private.supervisor_enrollment_actions e
    where e.action_id=p_action;
  if found then
    if row(prior.organization_id,prior.user_id,prior.reservation_action_id,
      prior.actor_id,prior.expected_access_revision,prior.tier,
      prior.team_ids,prior.reason,prior.environment)
      is distinct from row(p_org,p_user,p_reservation,auth.uid(),
      p_expected_access_revision,p_tier,normalized,btrim(p_reason),p_environment)
    then raise exception 'Enrollment action reused with different inputs' using errcode='22023';end if;
    -- Historical replay is not a request to re-enable a subsequently disabled grant.
    return prior.result_grant_revision;
  end if;
  select * into reserved from private.office_seat_reservations r
    where r.action_id=p_reservation for update;
  if not found or reserved.organization_id<>p_org or reserved.requested_role<>'SUPERVISOR'
    or reserved.actor_id<>auth.uid() or reserved.state<>'RESERVED'
  then raise exception 'Exact active owner Supervisor seat reservation required' using errcode='42501';end if;
  select * into access_row from private.account_work_access a
    where a.organization_id=p_org and a.user_id=p_user for update;
  if not found or access_row.work_role<>'SUPERVISOR'
    or access_row.active or access_row.disabled_at is not null
    or access_row.suspension_authority is not null
    or not private.account_identity_ready(p_org,p_user,'SUPERVISOR')
  then raise exception 'Verified inactive Supervisor identity required' using errcode='42501';end if;
  if access_row.revision is distinct from p_expected_access_revision then
    raise exception 'Supervisor access revision changed' using errcode='40001';end if;
  if exists(select 1 from private.supervisor_grants g
      where g.organization_id=p_org and g.user_id=p_user) then
    raise exception 'Supervisor already enrolled; use reviewed grant lifecycle' using errcode='42501';end if;
  if not exists(select 1 from private.org_office_allowances o where o.organization_id=p_org) then
    raise exception 'Office allowance not configured' using errcode='42501';end if;
  if exists(select 1 from unnest(normalized) t where not exists(
      select 1 from public.admin_teams team
      where team.organization_id=p_org and team.id=t and team.active)) then
    raise exception 'A selected team is outside the active organization scope' using errcode='42501';end if;
  insert into private.supervisor_grants(
    organization_id,user_id,tier,active,granted_by,reason,revision)
  values (p_org,p_user,p_tier,true,auth.uid(),btrim(p_reason),revision);
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
    select p_org,p_user,t from unnest(normalized) t;
  update private.office_seat_reservations set state='CONSUMED'
    where action_id=p_reservation and state='RESERVED';
  if not found then raise exception 'Seat reservation changed' using errcode='40001';end if;
  insert into private.supervisor_enrollment_actions(action_id,organization_id,user_id,
    reservation_action_id,actor_id,expected_access_revision,tier,team_ids,reason,
    environment,result_grant_revision)
  values(p_action,p_org,p_user,p_reservation,auth.uid(),p_expected_access_revision,
    p_tier,normalized,btrim(p_reason),p_environment,revision);
  -- Do not activate account_work_access, org_work_settings or Auth.
  return revision;
end;
$$;
revoke all on function public.owner_enroll_existing_supervisor(
  uuid,uuid,uuid,uuid,uuid,smallint,uuid[],text,text) from public,anon;
grant execute on function public.owner_enroll_existing_supervisor(
  uuid,uuid,uuid,uuid,uuid,smallint,uuid[],text,text) to authenticated,service_role;

-- One transaction combines reservation and enrollment for the existing owner UI.
-- On failure the seat reservation rolls back; an ambiguous client retry uses
-- the SAME immutable action UUID and never creates another identity or seat.
create function public.owner_enroll_supervisor_with_seat(
 p_action uuid,p_org uuid,p_user uuid,p_expected_access_revision uuid,
 p_tier smallint,p_team_ids uuid[],p_reason text,p_environment text
) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 if p_action is null or not private.is_current_platform_owner(p_environment) then
   raise exception 'Current verified Product Owner required' using errcode='42501';end if;
 if exists(select 1 from private.supervisor_enrollment_actions a where a.action_id=p_action) then
   return public.owner_enroll_existing_supervisor(p_action,p_org,p_user,p_action,
     p_expected_access_revision,p_tier,p_team_ids,p_reason,p_environment);
 end if;
 perform public.owner_reserve_office_seat(p_action,p_org,'SUPERVISOR',p_reason,p_environment);
 return public.owner_enroll_existing_supervisor(p_action,p_org,p_user,p_action,
   p_expected_access_revision,p_tier,p_team_ids,p_reason,p_environment);
end;
$$;
revoke all on function public.owner_enroll_supervisor_with_seat(
 uuid,uuid,uuid,uuid,smallint,uuid[],text,text) from public,anon;
grant execute on function public.owner_enroll_supervisor_with_seat(
 uuid,uuid,uuid,uuid,smallint,uuid[],text,text) to authenticated,service_role;
