-- Phase 6F: scoped Admin invitation PRE-ALLOCATION only.
-- No Auth identity, setup link, email, work grant, or team creation is made here.
-- Later trusted invitation steps must reconcile the exact reservation before any
-- remote/Auth side effect; a RESERVED row is not a delivered invitation.
create table private.scoped_admin_invitation_reservations (
  action_id uuid primary key references private.office_seat_reservations(action_id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  team_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  expected_allowance_revision uuid not null,
  invite_email text not null check (char_length(invite_email) between 3 and 320),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  environment text not null check (environment in ('TEST','PRODUCTION')),
  state text not null default 'RESERVED' check (state in ('RESERVED','RELEASED')),
  created_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  foreign key (organization_id,team_id)
    references public.admin_teams(organization_id,id) on delete restrict,
  check ((state='RESERVED' and released_at is null)
    or (state='RELEASED' and released_at is not null))
);
create unique index scoped_admin_pending_email_unique
  on private.scoped_admin_invitation_reservations(organization_id,invite_email)
  where state='RESERVED';
create index scoped_admin_reservation_team_idx
  on private.scoped_admin_invitation_reservations(organization_id,team_id,state);
alter table private.scoped_admin_invitation_reservations enable row level security;
revoke all on private.scoped_admin_invitation_reservations
  from public,anon,authenticated,service_role;
grant select,insert,update on private.scoped_admin_invitation_reservations to service_role;

-- A supervisor can use only currently granted MANAGE_ADMIN team capability;
-- a current verified Product Owner may provision office seats but gets no
-- customer/WO/photo access from the platform entitlement.
create function private.may_reserve_admin_for_team(
  p_org uuid,p_team uuid,p_environment text
) returns boolean
language sql stable security definer set search_path='' as $guard$
  select p_environment in ('TEST','PRODUCTION')
    and exists(select 1 from public.admin_teams t
      where t.organization_id=p_org and t.id=p_team and t.active)
    and (private.is_current_platform_owner(p_environment)
      or private.has_team_capability(p_org,p_team,'MANAGE_ADMIN'))
$guard$;
revoke all on function private.may_reserve_admin_for_team(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function private.may_reserve_admin_for_team(uuid,uuid,text) to service_role;

create function public.reserve_scoped_admin_invitation(
  p_action uuid,p_org uuid,p_team uuid,p_email text,p_name text,
  p_expected_allowance_revision uuid,p_reason text,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $reserve$
declare
  normalized_email text:=lower(btrim(p_email));
  normalized_name text:=btrim(p_name);
  normalized_reason text:=btrim(p_reason);
  prior private.scoped_admin_invitation_reservations%rowtype;
  quota private.org_office_allowances%rowtype;
  active_count bigint;
  reserved_count bigint;
begin
  if p_action is null or p_org is null or p_team is null
    or p_expected_allowance_revision is null
    or p_email is null or p_name is null or p_reason is null
    or p_environment is null or p_environment not in ('TEST','PRODUCTION')
    or char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or char_length(normalized_reason) not between 1 and 1000 then
    raise exception 'Invalid scoped Admin invitation request' using errcode='22023';
  end if;
  if not private.may_reserve_admin_for_team(p_org,p_team,p_environment) then
    raise exception 'Admin invitation not permitted for this team' using errcode='42501';
  end if;
  perform private.lock_account_lifecycle();
  if not private.may_reserve_admin_for_team(p_org,p_team,p_environment) then
    raise exception 'Admin invitation authority changed' using errcode='42501';
  end if;
  select * into prior from private.scoped_admin_invitation_reservations
    where action_id=p_action for update;
  if found then
    if row(prior.organization_id,prior.team_id,prior.actor_id,prior.invite_email,
      prior.display_name,prior.expected_allowance_revision,prior.reason,prior.environment)
      is distinct from row(p_org,p_team,auth.uid(),normalized_email,
        normalized_name,p_expected_allowance_revision,normalized_reason,p_environment) then
      raise exception 'Invitation action reused with changed inputs' using errcode='22023';
    end if;
    if prior.state<>'RESERVED' then
      raise exception 'Released invitation cannot reserve another seat' using errcode='42501';
    end if;
    return jsonb_build_object('action_id',p_action,'organization_id',p_org,
      'team_id',p_team,'status','RESERVED');
  end if;
  select * into quota from private.org_office_allowances
    where organization_id=p_org for update;
  if not found then
    raise exception 'Office allowance must be configured' using errcode='42501';
  end if;
  if quota.revision is distinct from p_expected_allowance_revision then
    raise exception 'Stale office allowance revision' using errcode='40001';
  end if;
  if exists(select 1 from auth.users u
    where lower(btrim(u.email))=normalized_email and u.deleted_at is null)
    or exists(select 1 from private.scoped_admin_invitation_reservations i
      where i.organization_id=p_org and i.invite_email=normalized_email
        and i.state='RESERVED') then
    raise exception 'Identity or invitation already pending' using errcode='23505';
  end if;
  select count(*) into active_count from private.account_work_access a
    where a.organization_id=p_org and a.work_role='ADMIN' and a.active
      and a.disabled_at is null;
  select count(*) into reserved_count from private.office_seat_reservations s
    where s.organization_id=p_org and s.requested_role='ADMIN'
      and s.state='RESERVED';
  if active_count+reserved_count>=quota.admin_limit then
    raise exception 'Admin office allowance exhausted' using errcode='23514';
  end if;
  insert into private.office_seat_reservations(
    action_id,organization_id,requested_role,actor_id,reason)
  values(p_action,p_org,'ADMIN',auth.uid(),normalized_reason);
  insert into private.scoped_admin_invitation_reservations(
    action_id,organization_id,team_id,actor_id,expected_allowance_revision,invite_email,
    display_name,reason,environment)
  values(p_action,p_org,p_team,auth.uid(),p_expected_allowance_revision,normalized_email,
    normalized_name,normalized_reason,p_environment);
  return jsonb_build_object('action_id',p_action,'organization_id',p_org,
    'team_id',p_team,'status','RESERVED');
end;
$reserve$;
revoke all on function public.reserve_scoped_admin_invitation(
  uuid,uuid,uuid,text,text,uuid,text,text) from public,anon;
grant execute on function public.reserve_scoped_admin_invitation(
  uuid,uuid,uuid,text,text,uuid,text,text) to authenticated,service_role;

-- Release is ONLY safe while this is a pre-Auth reservation. No external
-- setup link may be emitted by this migration or its caller.
create function public.release_scoped_admin_invitation(
  p_action uuid,p_org uuid,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $release$
declare prior private.scoped_admin_invitation_reservations%rowtype;
begin
  if p_action is null or p_org is null
    or p_environment is null or p_environment not in ('TEST','PRODUCTION') then
    raise exception 'Invalid invitation cancellation' using errcode='22023';
  end if;
  perform private.lock_account_lifecycle();
  select * into prior from private.scoped_admin_invitation_reservations
    where action_id=p_action and organization_id=p_org for update;
  if not found or prior.environment is distinct from p_environment
    or not private.may_reserve_admin_for_team(p_org,prior.team_id,p_environment) then
    raise exception 'Scoped invitation cancellation denied' using errcode='42501';
  end if;
  if prior.state='RELEASED' then
    return jsonb_build_object('action_id',p_action,'status','RELEASED');
  end if;
  update private.scoped_admin_invitation_reservations
    set state='RELEASED',released_at=clock_timestamp() where action_id=p_action;
  update private.office_seat_reservations set state='RELEASED'
    where action_id=p_action and organization_id=p_org
      and requested_role='ADMIN' and state='RESERVED';
  if not found then
    raise exception 'Linked office reservation no longer available'
      using errcode='40001';
  end if;
  return jsonb_build_object('action_id',p_action,'status','RELEASED');
end;
$release$;
revoke all on function public.release_scoped_admin_invitation(
  uuid,uuid,text) from public,anon;
grant execute on function public.release_scoped_admin_invitation(
  uuid,uuid,text) to authenticated,service_role;
