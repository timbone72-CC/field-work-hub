-- Phase 6F: exact pre-Auth -> Auth identity handoff on the existing invite owner.
-- Source-only; no account is created, no Auth link sent, no work enabled.
-- An uncertain external Auth result retains its reservation until reconciled.
alter table private.scoped_admin_invitation_reservations
  add column auth_user_id uuid unique references auth.users(id) on delete restrict,
  add column issuing_at timestamptz,
  add column bound_at timestamptz,
  add column problem_at timestamptz;

alter table private.scoped_admin_invitation_reservations
  drop constraint scoped_admin_invitation_reservations_state_check;
alter table private.scoped_admin_invitation_reservations
  add constraint scoped_admin_invitation_state_valid
  check (state in ('RESERVED','ISSUING','BOUND','PROBLEM','RELEASED'));
alter table private.scoped_admin_invitation_reservations
  drop constraint scoped_admin_invitation_reservations_check;
alter table private.scoped_admin_invitation_reservations
  add constraint scoped_admin_invitation_lifecycle_valid
  check (
    (state='RESERVED' and issuing_at is null and bound_at is null
      and problem_at is null and released_at is null and auth_user_id is null)
    or (state='ISSUING' and issuing_at is not null and bound_at is null
      and problem_at is null and released_at is null and auth_user_id is null)
    or (state='BOUND' and issuing_at is not null and bound_at is not null
      and problem_at is null and released_at is null and auth_user_id is not null)
    or (state='PROBLEM' and issuing_at is not null and bound_at is null
      and problem_at is not null and released_at is null)
    or (state='RELEASED' and issuing_at is null and bound_at is null
      and problem_at is null and released_at is not null and auth_user_id is null)
  );
drop index private.scoped_admin_pending_email_unique;
create unique index scoped_admin_pending_email_unique
  on private.scoped_admin_invitation_reservations(organization_id,invite_email)
  where state in ('RESERVED','ISSUING','BOUND','PROBLEM');

-- The original pre-Auth cancellation may NEVER free a seat after issuance
-- begins. A link might already exist even if the network timed out.
create or replace function public.release_scoped_admin_invitation(
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
  if prior.state<>'RESERVED' then
    raise exception 'Started invitation requires exact Auth reconciliation before cancellation'
      using errcode='42501';
  end if;
  update private.scoped_admin_invitation_reservations
    set state='RELEASED',released_at=clock_timestamp()
    where action_id=p_action and state='RESERVED';
  update private.office_seat_reservations
    set state='RELEASED' where action_id=p_action
      and organization_id=p_org and requested_role='ADMIN' and state='RESERVED';
  if not found then
    raise exception 'Linked office reservation unavailable' using errcode='40001';
  end if;
  return jsonb_build_object('action_id',p_action,'status','RELEASED');
end;
$release$;

-- Only the immutable original actor can begin issuance. Exactly one
-- transition reserves authority to call Auth. Any repeat MUST reconcile,
-- never call generateLink a second time from an ambiguous outcome.
create function public.begin_scoped_admin_invitation_issue(
  p_action uuid,p_org uuid,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $begin_issue$
declare
  request private.scoped_admin_invitation_reservations%rowtype;
  seat private.office_seat_reservations%rowtype;
  mode text;
begin
  if p_action is null or p_org is null or p_environment is null
    or p_environment not in ('TEST','PRODUCTION')
    or not private.current_identity_valid() then
    raise exception 'Verified invitation actor required' using errcode='42501';
  end if;
  perform private.lock_account_lifecycle();
  select * into request from private.scoped_admin_invitation_reservations
    where action_id=p_action and organization_id=p_org for update;
  if not found or request.actor_id is distinct from auth.uid()
    or request.environment is distinct from p_environment
    or not private.may_reserve_admin_for_team(p_org,request.team_id,p_environment)
    or not exists(select 1 from public.admin_teams t where t.id=request.team_id
      and t.organization_id=p_org and t.active) then
    raise exception 'Current scoped invitation authority unavailable' using errcode='42501';
  end if;
  select * into seat from private.office_seat_reservations
    where action_id=p_action and organization_id=p_org for update;
  if not found or seat.requested_role<>'ADMIN'
    or seat.actor_id is distinct from auth.uid() or seat.state<>'RESERVED' then
    raise exception 'Exact office seat reservation unavailable' using errcode='42501';
  end if;
  if request.state='RESERVED' then
    update private.scoped_admin_invitation_reservations
      set state='ISSUING', issuing_at=clock_timestamp()
      where action_id=p_action;
    mode:='CREATE_ONCE';
  elsif request.state in ('ISSUING','BOUND','PROBLEM') then
    mode:='RECONCILE';
  else
    raise exception 'Invitation no longer eligible for issuance' using errcode='42501';
  end if;
  return jsonb_build_object('action_id',p_action,'organization_id',p_org,
    'team_id',request.team_id,'invite_email',request.invite_email,
    'display_name',request.display_name,'status',
    case when mode='CREATE_ONCE' then 'ISSUING' else request.state end,
    'instruction',mode);
end;
$begin_issue$;
revoke all on function public.begin_scoped_admin_invitation_issue(uuid,uuid,text)
  from public,anon;
grant execute on function public.begin_scoped_admin_invitation_issue(uuid,uuid,text)
  to authenticated,service_role;

-- The existing trusted Auth inviter invokes this ONLY after reconciling the
-- real Auth identity and immutable invitation marker; no client may assert it.
-- BOUND is a metadata/link outcome, NOT verified email or active work.
create function public.team_finalize_scoped_admin_issue(
  p_action uuid,p_org uuid,p_auth_user uuid,p_outcome text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $finish_issue$
declare
  request private.scoped_admin_invitation_reservations%rowtype;
  valid_identity boolean;
begin
  if p_action is null or p_org is null or p_outcome not in ('BOUND','PROBLEM')
    or p_outcome is null then
    raise exception 'Invalid trusted invitation outcome' using errcode='22023';
  end if;
  perform private.lock_account_lifecycle();
  select * into request from private.scoped_admin_invitation_reservations
    where action_id=p_action and organization_id=p_org for update;
  if not found or request.state not in ('ISSUING','BOUND','PROBLEM')
    or not exists(select 1 from private.office_seat_reservations seat
      where seat.action_id=p_action and seat.organization_id=p_org
        and seat.requested_role='ADMIN' and seat.state='RESERVED') then
    raise exception 'Exact in-flight invitation unavailable' using errcode='42501';
  end if;
  -- Caller supplies immutable UUID, not trustable email or role claims.
  select exists(
    select 1 from auth.users u
    where u.id=p_auth_user and u.deleted_at is null
      and lower(btrim(u.email))=request.invite_email
      and u.raw_app_meta_data->>'organization_id'=p_org::text
      and u.raw_app_meta_data->>'role'='ADMIN'
      and u.raw_user_meta_data->>'scoped_admin_invitation_id'=p_action::text
  ) into valid_identity;
  if p_outcome='BOUND' and (p_auth_user is null or not valid_identity) then
    raise exception 'Trusted Auth identity did not match exact invitation'
      using errcode='42501';
  end if;
  if request.state='BOUND' then
    if p_outcome<>'BOUND' or request.auth_user_id is distinct from p_auth_user then
      raise exception 'Immutable Auth binding cannot be changed'
        using errcode='42501';
    end if;
    return jsonb_build_object('action_id',p_action,'status','BOUND',
      'auth_user_id',request.auth_user_id);
  end if;
  if request.state='PROBLEM' then
    if p_outcome<>'PROBLEM' or request.auth_user_id is distinct from p_auth_user then
      raise exception 'Problem requires independent reconciliation' using errcode='42501';
    end if;
    return jsonb_build_object('action_id',p_action,'status','PROBLEM');
  end if;
  if p_outcome='BOUND' then
    -- A revoked/moved inviter or inactive team must never activate an Auth link.
    if not exists(select 1 from public.admin_teams t
        where t.id=request.team_id and t.organization_id=p_org and t.active)
      or not (
        exists(select 1 from private.platform_owner_capabilities c
          join auth.users u on u.id=c.user_id
          where c.user_id=request.actor_id and c.active
            and c.environment=request.environment and u.deleted_at is null
            and u.email_confirmed_at is not null)
        or private.team_capability_for_user(
          request.actor_id,p_org,request.team_id,'MANAGE_ADMIN')
      ) then
      raise exception 'Original inviter scope revoked before Auth binding'
        using errcode='42501';
    end if;
    update private.scoped_admin_invitation_reservations
      set state='BOUND',auth_user_id=p_auth_user,bound_at=clock_timestamp()
      where action_id=p_action and state='ISSUING';
  else
    update private.scoped_admin_invitation_reservations
      set state='PROBLEM',auth_user_id=p_auth_user,problem_at=clock_timestamp()
      where action_id=p_action and state='ISSUING';
  end if;
  return jsonb_build_object('action_id',p_action,'status',p_outcome,
    'auth_user_id',p_auth_user);
end;
$finish_issue$;
revoke all on function public.team_finalize_scoped_admin_issue(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.team_finalize_scoped_admin_issue(uuid,uuid,uuid,text)
  to service_role;

-- Never allow the privileged client to write reservation state directly;
-- only the audited narrow function owner transitions the existing ledger.
revoke insert,update,delete on private.scoped_admin_invitation_reservations from service_role;
