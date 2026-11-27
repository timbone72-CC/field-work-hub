-- Phase 6F-T01: permanent Product Owner-only Supervisor invitations.
-- This extends the existing scoped staff invitation ledger and setup-link
-- owner. It does not create a second invitation system or a temporary user.
alter table private.scoped_admin_invitation_reservations
  alter column team_id drop not null;

alter table private.scoped_admin_invitation_reservations
  add column supervisor_tier smallint,
  add column supervisor_team_ids uuid[];

alter table private.scoped_admin_invitation_reservations
  add constraint scoped_staff_supervisor_scope_valid check (
    (supervisor_tier is null and supervisor_team_ids is null and team_id is not null)
    or (supervisor_tier is not null and supervisor_tier between 1 and 3 and team_id is null
      and supervisor_team_ids is not null
      and array_ndims(supervisor_team_ids) <= 1
      and array_position(supervisor_team_ids,null) is null
      and (supervisor_tier=3 and cardinality(supervisor_team_ids)=0
        or supervisor_tier<3 and cardinality(supervisor_team_ids) between 1 and 100))
  );

-- The same trusted staff function owner reserves the Supervisor capacity and
-- records the immutable owner-selected grant before Auth is contacted.
create function public.reserve_scoped_supervisor_invitation(
 p_action uuid,p_org uuid,p_tier smallint,p_team_ids uuid[],p_email text,p_name text,
 p_expected_allowance_revision uuid,p_reason text,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $reserve$
declare
  normalized_email text:=lower(btrim(p_email));
  normalized_name text:=btrim(p_name);
  normalized_reason text:=btrim(p_reason);
  normalized_teams uuid[];
  prior private.scoped_admin_invitation_reservations%rowtype;
  quota private.org_office_allowances%rowtype;
  active_count bigint;
  reserved_count bigint;
begin
  if p_action is null or p_org is null or p_tier is null or p_tier not between 1 and 3
    or p_team_ids is null or array_ndims(p_team_ids)>1
    or array_position(p_team_ids,null) is not null
    or p_expected_allowance_revision is null or p_email is null or p_name is null
    or p_reason is null or p_environment is null or p_environment not in ('TEST','PRODUCTION')
    or char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or char_length(normalized_name) not between 1 and 200
    or char_length(normalized_reason) not between 1 and 1000
  then raise exception 'Invalid Supervisor invitation request' using errcode='22023'; end if;
  select coalesce(array_agg(x order by x),'{}'::uuid[]) into normalized_teams
    from unnest(p_team_ids) x;
  if cardinality(normalized_teams)<>(select count(distinct x) from unnest(normalized_teams) x)
    or (p_tier=3 and cardinality(normalized_teams)<>0)
    or (p_tier<3 and cardinality(normalized_teams) not between 1 and 100)
    or exists(select 1 from unnest(normalized_teams) x where not exists(
      select 1 from public.admin_teams t
      where t.organization_id=p_org and t.id=x and t.active))
  then raise exception 'Supervisor team scope must contain exact active organization teams'
    using errcode='42501'; end if;
  if not private.is_current_platform_owner(p_environment) then
    raise exception 'Recent verified Product Owner authentication required' using errcode='42501'; end if;
  perform private.lock_account_lifecycle();
  if not private.is_current_platform_owner(p_environment) then
    raise exception 'Product Owner authorization changed' using errcode='42501'; end if;
  if exists(select 1 from unnest(normalized_teams) x where not exists(
    select 1 from public.admin_teams t where t.organization_id=p_org and t.id=x and t.active)) then
    raise exception 'Supervisor team scope changed' using errcode='42501'; end if;
  select * into prior from private.scoped_admin_invitation_reservations
    where action_id=p_action for update;
  if found then
    if row(prior.organization_id,prior.actor_id,prior.invite_email,prior.display_name,
      prior.expected_allowance_revision,prior.reason,prior.environment,prior.supervisor_tier,
      prior.supervisor_team_ids) is distinct from row(p_org,auth.uid(),normalized_email,
      normalized_name,p_expected_allowance_revision,normalized_reason,p_environment,p_tier,
      normalized_teams)
    then raise exception 'Invitation action reused with changed inputs' using errcode='22023'; end if;
    if prior.state not in ('RESERVED','ISSUING','BOUND','PROBLEM') then
      raise exception 'Released or consumed invitation cannot reserve another seat' using errcode='42501'; end if;
    return jsonb_build_object('action_id',p_action,'organization_id',p_org,'status',prior.state,
      'tier',prior.supervisor_tier,'team_ids',prior.supervisor_team_ids);
  end if;
  select * into quota from private.org_office_allowances where organization_id=p_org for update;
  if not found or quota.revision is distinct from p_expected_allowance_revision then
    raise exception 'Stale or unavailable office allowance revision' using errcode='40001'; end if;
  if exists(select 1 from auth.users u where lower(btrim(u.email))=normalized_email and u.deleted_at is null)
    or exists(select 1 from private.scoped_admin_invitation_reservations i
      where i.organization_id=p_org and i.invite_email=normalized_email
        and i.state in ('RESERVED','ISSUING','BOUND','PROBLEM')) then
    raise exception 'Identity or invitation already pending' using errcode='23505'; end if;
  select count(*) into active_count from private.account_work_access a
    join private.supervisor_grants g on g.organization_id=a.organization_id and g.user_id=a.user_id
    where a.organization_id=p_org and a.work_role='SUPERVISOR' and a.active
      and a.disabled_at is null and g.active;
  select count(*) into reserved_count from private.office_seat_reservations s
    where s.organization_id=p_org and s.requested_role='SUPERVISOR' and s.state='RESERVED';
  if active_count+reserved_count>=quota.supervisor_limit then
    raise exception 'Supervisor office allowance exhausted' using errcode='23514'; end if;
  insert into private.office_seat_reservations(action_id,organization_id,requested_role,actor_id,reason)
    values(p_action,p_org,'SUPERVISOR',auth.uid(),normalized_reason);
  insert into private.scoped_admin_invitation_reservations(
    action_id,organization_id,team_id,actor_id,expected_allowance_revision,invite_email,
    display_name,reason,environment,supervisor_tier,supervisor_team_ids)
    values(p_action,p_org,null,auth.uid(),p_expected_allowance_revision,normalized_email,
      normalized_name,normalized_reason,p_environment,p_tier,normalized_teams);
  return jsonb_build_object('action_id',p_action,'organization_id',p_org,'status','RESERVED',
    'tier',p_tier,'team_ids',normalized_teams);
end;
$reserve$;
revoke all on function public.reserve_scoped_supervisor_invitation(uuid,uuid,smallint,uuid[],text,text,uuid,text,text)
  from public,anon;
grant execute on function public.reserve_scoped_supervisor_invitation(uuid,uuid,smallint,uuid[],text,text,uuid,text,text)
  to authenticated,service_role;

create function public.begin_scoped_supervisor_invitation_issue(
 p_action uuid,p_org uuid,p_environment text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $begin$
declare request private.scoped_admin_invitation_reservations%rowtype;
begin
  if p_action is null or p_org is null or p_environment is null or p_environment not in ('TEST','PRODUCTION')
    or not private.current_identity_valid()
    or not private.is_current_platform_owner(p_environment) then
    raise exception 'Recent verified Product Owner authentication required' using errcode='42501'; end if;
  perform private.lock_account_lifecycle();
  if not private.is_current_platform_owner(p_environment) then
    raise exception 'Product Owner authorization changed' using errcode='42501'; end if;
  select * into request from private.scoped_admin_invitation_reservations
    where action_id=p_action and organization_id=p_org for update;
  if not found or request.actor_id<>auth.uid() or request.team_id is not null
    or request.environment<>p_environment or request.supervisor_tier is null
    or exists(select 1 from unnest(request.supervisor_team_ids) x where not exists(
      select 1 from public.admin_teams t where t.organization_id=p_org and t.id=x and t.active))
    or not exists(select 1 from private.office_seat_reservations s where s.action_id=p_action
      and s.organization_id=p_org and s.requested_role='SUPERVISOR'
      and s.actor_id=auth.uid() and s.state='RESERVED') then
    raise exception 'Exact Supervisor invitation authority unavailable' using errcode='42501'; end if;
  if request.state='RESERVED' then
    update private.scoped_admin_invitation_reservations set state='ISSUING',issuing_at=clock_timestamp()
      where action_id=p_action;
    return jsonb_build_object('action_id',p_action,'organization_id',p_org,'status','ISSUING',
      'instruction','CREATE_ONCE','invite_email',request.invite_email,'display_name',request.display_name,
      'tier',request.supervisor_tier,'team_ids',request.supervisor_team_ids);
  elsif request.state in ('ISSUING','BOUND','PROBLEM') then
    return jsonb_build_object('action_id',p_action,'organization_id',p_org,'status',request.state,
      'instruction','RECONCILE','invite_email',request.invite_email,'display_name',request.display_name,
      'tier',request.supervisor_tier,'team_ids',request.supervisor_team_ids);
  end if;
  raise exception 'Invitation no longer eligible for issuance' using errcode='42501';
end;
$begin$;
revoke all on function public.begin_scoped_supervisor_invitation_issue(uuid,uuid,text) from public,anon;
grant execute on function public.begin_scoped_supervisor_invitation_issue(uuid,uuid,text) to authenticated,service_role;

create function public.team_finalize_scoped_supervisor_issue(
 p_action uuid,p_org uuid,p_auth_user uuid,p_outcome text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $finish$
declare request private.scoped_admin_invitation_reservations%rowtype;
begin
  if p_action is null or p_org is null or p_outcome is null or p_outcome not in ('BOUND','PROBLEM') then
    raise exception 'Invalid trusted Supervisor invitation outcome' using errcode='22023'; end if;
  perform private.lock_account_lifecycle();
  select * into request from private.scoped_admin_invitation_reservations
    where action_id=p_action and organization_id=p_org for update;
  if not found or request.supervisor_tier is null or request.state not in ('ISSUING','BOUND','PROBLEM')
    or not exists(select 1 from private.office_seat_reservations s
    where s.action_id=p_action and s.organization_id=p_org and s.requested_role='SUPERVISOR' and s.state='RESERVED') then
    raise exception 'Exact in-flight Supervisor invitation unavailable' using errcode='42501'; end if;
  if p_outcome='BOUND' and not exists(select 1 from auth.users u where u.id=p_auth_user
    and u.deleted_at is null and lower(btrim(u.email))=request.invite_email
    and u.raw_app_meta_data->>'organization_id'=p_org::text
    and u.raw_app_meta_data->>'role'='SUPERVISOR'
    and u.raw_user_meta_data->>'scoped_admin_invitation_id'=p_action::text) then
    raise exception 'Trusted Auth identity did not match exact Supervisor invitation' using errcode='42501'; end if;
  if request.state='BOUND' then
    if p_outcome<>'BOUND' or request.auth_user_id is distinct from p_auth_user then
      raise exception 'Immutable Auth binding cannot be changed' using errcode='42501'; end if;
    return jsonb_build_object('action_id',p_action,'status','BOUND','auth_user_id',request.auth_user_id);
  end if;
  if request.state='PROBLEM' then
    raise exception 'Problem requires independent Supervisor invitation reconciliation' using errcode='42501'; end if;
  if p_outcome='BOUND' then
    if exists(select 1 from unnest(request.supervisor_team_ids) x where not exists(
      select 1 from public.admin_teams t where t.organization_id=p_org and t.id=x and t.active)) then
      raise exception 'Supervisor scope revoked before Auth binding' using errcode='42501'; end if;
    if not exists(select 1 from private.platform_owner_capabilities c join auth.users u on u.id=c.user_id
      where c.user_id=request.actor_id and c.active and c.environment=request.environment
        and u.deleted_at is null and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until<=now())) then
      raise exception 'Product Owner authorization was revoked before Auth binding' using errcode='42501'; end if;
    update private.scoped_admin_invitation_reservations set state='BOUND',auth_user_id=p_auth_user,bound_at=clock_timestamp()
      where action_id=p_action and state='ISSUING';
  else
    update private.scoped_admin_invitation_reservations set state='PROBLEM',auth_user_id=p_auth_user,problem_at=clock_timestamp()
      where action_id=p_action and state='ISSUING';
  end if;
  if not found then raise exception 'Supervisor invitation state changed' using errcode='40001'; end if;
  return jsonb_build_object('action_id',p_action,'status',p_outcome,'auth_user_id',p_auth_user);
end;
$finish$;
revoke all on function public.team_finalize_scoped_supervisor_issue(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.team_finalize_scoped_supervisor_issue(uuid,uuid,uuid,text) to service_role;

-- The existing setup page calls this owner-defined enrollment only after the
-- invitee has verified email and chosen a password. It consumes the reserved
-- seat and creates exactly the stored tier/scope grant, once.
create function public.complete_scoped_supervisor_invitation_activation()
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $activate$
declare inv private.scoped_admin_invitation_reservations%rowtype;
begin
  if not private.current_identity_valid() then raise exception 'Verified current invitation session required' using errcode='42501'; end if;
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() then raise exception 'Current Auth session changed' using errcode='42501'; end if;
  select * into inv from private.scoped_admin_invitation_reservations
    where auth_user_id=auth.uid() for update;
  if not found or inv.state not in ('BOUND','CONSUMED') or inv.supervisor_tier is null then
    raise exception 'Exact accepted Supervisor invitation required' using errcode='42501'; end if;
  if not exists(select 1 from auth.users u where u.id=auth.uid() and u.deleted_at is null
    and u.email_confirmed_at is not null and lower(btrim(u.email))=inv.invite_email
    and u.raw_app_meta_data->>'organization_id'=inv.organization_id::text
    and u.raw_app_meta_data->>'role'='SUPERVISOR'
    and u.raw_user_meta_data->>'scoped_admin_invitation_id'=inv.action_id::text) then
    raise exception 'Current verified Supervisor identity mismatched invitation' using errcode='42501'; end if;
  if inv.state='CONSUMED' then
    return jsonb_build_object('status',case when exists(select 1 from private.account_work_access a
      join private.supervisor_grants g on g.organization_id=a.organization_id and g.user_id=a.user_id and g.active
      where a.organization_id=inv.organization_id and a.user_id=auth.uid()
        and a.work_role='SUPERVISOR' and a.active and a.disabled_at is null and a.suspension_authority is null)
      then 'ALREADY_ACTIVATED' else 'WORK_DISABLED' end,'action_id',inv.action_id);
  end if;
  if not exists(select 1 from private.office_seat_reservations s where s.action_id=inv.action_id
    and s.organization_id=inv.organization_id and s.requested_role='SUPERVISOR' and s.state='RESERVED'
    and s.actor_id=inv.actor_id) then raise exception 'Exact reserved Supervisor seat unavailable' using errcode='42501'; end if;
  if exists(select 1 from private.account_work_access a where a.user_id=auth.uid()) then
    raise exception 'Invited identity already holds a work account' using errcode='42501'; end if;
  if not exists(select 1 from private.platform_owner_capabilities c join auth.users u on u.id=c.user_id
    where c.user_id=inv.actor_id and c.active and c.environment=inv.environment
      and u.deleted_at is null and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Product Owner authorization was revoked before activation' using errcode='42501'; end if;
  if inv.supervisor_tier<3 and exists(select 1 from unnest(inv.supervisor_team_ids) x where not exists(
    select 1 from public.admin_teams t where t.organization_id=inv.organization_id and t.id=x and t.active)) then
    raise exception 'Invited Supervisor team scope is no longer active' using errcode='42501'; end if;
  insert into private.account_work_access(organization_id,user_id,work_role,active)
    values(inv.organization_id,auth.uid(),'SUPERVISOR',true);
  insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
    values(inv.organization_id,auth.uid(),inv.supervisor_tier,true,inv.actor_id,inv.reason);
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
    select inv.organization_id,auth.uid(),x from unnest(inv.supervisor_team_ids) x;
  update private.office_seat_reservations set state='CONSUMED'
    where action_id=inv.action_id and state='RESERVED';
  if not found then raise exception 'Reserved Supervisor seat changed during activation' using errcode='40001'; end if;
  update private.scoped_admin_invitation_reservations set state='CONSUMED',activated_at=clock_timestamp()
    where action_id=inv.action_id and state='BOUND';
  if not found then raise exception 'Auth Supervisor invitation changed during activation' using errcode='40001'; end if;
  return jsonb_build_object('status','ACCEPTED','action_id',inv.action_id,
    'organization_id',inv.organization_id,'tier',inv.supervisor_tier,'team_ids',inv.supervisor_team_ids);
end;
$activate$;
revoke all on function public.complete_scoped_supervisor_invitation_activation() from public,anon;
grant execute on function public.complete_scoped_supervisor_invitation_activation() to authenticated,service_role;


-- Preserve the existing seat-release owner; fence the new linked invitation lifecycle.
create or replace function public.owner_release_office_seat(
 p_action uuid,p_org uuid,p_reason text,p_environment text
) returns text
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 reservation private.office_seat_reservations%rowtype;
 invitation private.scoped_admin_invitation_reservations%rowtype;
begin
 if p_action is null or p_org is null or p_reason is null
    or char_length(btrim(p_reason)) not between 1 and 1000
    or p_environment is null or p_environment not in ('TEST','PRODUCTION') then
   raise exception 'Invalid seat release request' using errcode='22023';
 end if;
 if not private.is_current_platform_owner(p_environment) then
   raise exception 'Verified Product Owner required' using errcode='42501';
 end if;
 perform private.lock_account_lifecycle();
 if not private.is_current_platform_owner(p_environment) then
   raise exception 'Product Owner authorization changed' using errcode='42501';
 end if;
 select * into reservation from private.office_seat_reservations
   where action_id=p_action and organization_id=p_org for update;
 if not found then
   raise exception 'Exact seat reservation unavailable' using errcode='42501';
 end if;
 if reservation.state='CONSUMED' then
   raise exception 'Consumed seat cannot be cancelled' using errcode='42501';
 end if;
 if reservation.state='RELEASED' then return 'RELEASED'; end if;
 -- A linked Supervisor invitation must release both records atomically,
 -- and never release capacity after external Auth issuance has begun.
 if reservation.requested_role='SUPERVISOR' then
   select * into invitation from private.scoped_admin_invitation_reservations
     where action_id=p_action and organization_id=p_org for update;
   if found then
     if invitation.supervisor_tier is null or invitation.environment<>p_environment
        or invitation.state<>'RESERVED' then
       raise exception 'Started Supervisor invitation requires exact Auth reconciliation before cancellation' using errcode='42501';
     end if;
     update private.scoped_admin_invitation_reservations set state='RELEASED',released_at=clock_timestamp()
       where action_id=p_action and state='RESERVED';
     if not found then raise exception 'Invitation changed' using errcode='40001'; end if;
   end if;
 end if;
 update private.office_seat_reservations set state='RELEASED'
   where action_id=p_action and organization_id=p_org and state='RESERVED';
 if not found then raise exception 'Reservation changed' using errcode='40001'; end if;
 return 'RELEASED';
end;
$$;
