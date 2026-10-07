-- Complete invitation/capacity lock ordering within the existing owners.
-- Source-only additive continuation; no Auth/network request occurs in SQL.
create function private.lock_account_lifecycle() returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 -- Strong first lock prevents two invitation/activation transactions from
 -- simultaneously taking shared reads and deadlocking on their write upgrades.
 lock table private.photo_recovery_grants in share row exclusive mode;
 lock table auth.users,auth.sessions,private.account_work_access,
  private.admin_team_memberships,private.contractor_team_memberships,
  private.supervisor_grants,private.supervisor_team_scopes,private.org_work_settings,
  public.admin_teams,public.contractor_invitations,private.org_office_allowances,
  private.platform_owner_capabilities in share mode;
end; $$;
revoke all on function private.lock_account_lifecycle() from public,anon,authenticated;
grant execute on function private.lock_account_lifecycle() to service_role;

create function private.protect_invitation_team() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.team_id is not null and row(new.team_id,new.organization_id) is distinct from row(old.team_id,old.organization_id) then
  raise exception 'Invitation team identity is immutable' using errcode='42501';end if;
 return new;
end; $$;
revoke all on function private.protect_invitation_team() from public,anon,authenticated;
create trigger contractor_invitation_team_immutable before update on public.contractor_invitations
 for each row execute function private.protect_invitation_team();

create function private.admin_reserve_contractor_invitation_for_team(p_team uuid,p_email text,p_display_name text)
returns table(invitation_id uuid,email text,display_name text,status text,organization_id uuid,seat_limit integer,used_seats integer,available_seats integer)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare org uuid; result record;
begin
 perform private.lock_account_lifecycle();
 org:=private.legacy_work_org('ADMIN');
 if not private.has_team_capability(org,p_team,'INVITE_CONTRACTOR') then
  raise exception 'Recruitment team unavailable' using errcode='42501';end if;
 select * into result from private.admin_reserve_contractor_invitation_legacy_engine(p_email,p_display_name);
 update public.contractor_invitations i set team_id=p_team
   where i.id=result.invitation_id and i.organization_id=org and i.team_id is null;
 if not found then raise exception 'Reserved invitation team binding failed' using errcode='40001';end if;
 return query select result.invitation_id::uuid,result.email::text,result.display_name::text,result.status::text,
  result.organization_id::uuid,result.seat_limit::integer,result.used_seats::integer,result.available_seats::integer;
end; $$;
create function public.admin_reserve_contractor_invitation_for_team(p_team uuid,p_email text,p_display_name text)
returns table(invitation_id uuid,email text,display_name text,status text,organization_id uuid,seat_limit integer,used_seats integer,available_seats integer)
language sql security invoker set search_path='' as $$
 select * from private.admin_reserve_contractor_invitation_for_team(p_team,p_email,p_display_name)
$$;
revoke all on function private.admin_reserve_contractor_invitation_for_team(uuid,text,text),public.admin_reserve_contractor_invitation_for_team(uuid,text,text) from public,anon,authenticated;
grant execute on function private.admin_reserve_contractor_invitation_for_team(uuid,text,text),public.admin_reserve_contractor_invitation_for_team(uuid,text,text) to authenticated,service_role;

create or replace function private.admin_reserve_contractor_invitation(p_email text,p_display_name text)
returns table(invitation_id uuid,email text,display_name text,status text,organization_id uuid,seat_limit integer,used_seats integer,available_seats integer)
language sql security definer set search_path='' as $$
 select * from private.admin_reserve_contractor_invitation_for_team(
  private.legacy_admin_invite_team(private.legacy_work_org('ADMIN')),p_email,p_display_name)
$$;

create or replace function private.admin_get_contractor_seat_summary()
returns table(seat_limit integer,active_contractors integer,pending_invitations integer,used_seats integer,available_seats integer)
language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 org:=private.legacy_work_org('ADMIN');
 if not exists(select 1 from public.admin_teams t where t.organization_id=org and private.has_team_capability(org,t.id,'INVITE_CONTRACTOR')) then
  raise exception 'Current recruitment authority required' using errcode='42501';end if;
 return query select * from private.admin_get_contractor_seat_summary_legacy_engine();
end; $$;

create or replace function private.admin_list_pending_contractor_invitations()
returns table(invitation_id uuid,email text,display_name text,status text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 org:=private.legacy_work_org('ADMIN');
 if not exists(select 1 from public.admin_teams t where t.organization_id=org and private.has_team_capability(org,t.id,'INVITE_CONTRACTOR')) then
  raise exception 'Current recruitment authority required' using errcode='42501';end if;
 return query select e.invitation_id,e.email,e.display_name,e.status,e.created_at
  from private.admin_list_pending_contractor_invitations_legacy_engine() e join public.contractor_invitations i on i.id=e.invitation_id
  where i.organization_id=org and private.has_team_capability(org,i.team_id,'INVITE_CONTRACTOR');
end; $$;

create or replace function private.admin_begin_contractor_invitation_cancel(p_invitation_id uuid)
returns table(invitation_id uuid,email text,display_name text,status text,auth_user_id uuid,organization_id uuid)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare org uuid; team uuid;
begin
 perform private.lock_account_lifecycle(); org:=private.legacy_work_org('ADMIN');
 select i.team_id into team from public.contractor_invitations i where i.id=p_invitation_id and i.organization_id=org for update;
 if team is null or not private.has_team_capability(org,team,'INVITE_CONTRACTOR') then
  raise exception 'Invitation unavailable in current Admin scope' using errcode='42501';end if;
 return query select * from private.admin_begin_contractor_invitation_cancel_legacy_engine(p_invitation_id);
end; $$;

do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.set_account_work_access(uuid,uuid,uuid,boolean,text,text)'::regprocedure)<>'6cbe574b2f52d80c809f2805a645dc36' then raise exception 'Authority source drift: set_account_work_access';end if;end; $parity$;

CREATE OR REPLACE FUNCTION private.set_account_work_access(p_action uuid, p_target uuid, p_expected_revision uuid, p_active boolean, p_reason text, p_environment text)
 RETURNS TABLE(action_id uuid, target_user_id uuid, active boolean, revision uuid, recovery_grant_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare
  prior private.account_work_access_actions%rowtype;
  access_row private.account_work_access%rowtype;
  authority text;
  removed uuid[];
  new_revision uuid:=gen_random_uuid();
begin
  if p_action is null or p_target is null or p_expected_revision is null or p_active is null
    or not coalesce(p_environment in ('TEST','PRODUCTION'),false)
    or coalesce(char_length(btrim(p_reason)) between 1 and 1000,false)=false then
    raise exception 'Explicit account access action inputs required' using errcode='22023';
  end if;
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() then
    raise exception 'Current verified session required' using errcode='42501';
  end if;

  select * into prior
  from private.account_work_access_actions a
  where a.action_id=p_action;
  if found then
    if row(prior.actor_user_id,prior.target_user_id,prior.requested_active,prior.environment,
           prior.expected_revision,prior.reason)
       is distinct from
       row(auth.uid(),p_target,p_active,p_environment,p_expected_revision,btrim(p_reason)) then
      raise exception 'Account access action UUID reused with changed inputs' using errcode='22023';
    end if;
    return query select prior.action_id,prior.target_user_id,prior.requested_active,
      prior.result_revision,prior.recovery_grant_id;
    return;
  end if;

  -- Same revocation order used by work writes and recovery cutoff. No network work occurs here.
  lock table private.photo_recovery_grants in share row exclusive mode;
  lock table auth.users,auth.sessions,private.account_work_access,private.admin_team_memberships,
    private.contractor_team_memberships,private.supervisor_grants,private.supervisor_team_scopes,
    private.org_work_settings,public.admin_teams,public.contractor_invitations in share mode;

  -- A competing identical request may have committed while this transaction waited
  -- on the revocation lock. Re-read the immutable action before testing revision.
  select * into prior
  from private.account_work_access_actions a
  where a.action_id=p_action;
  if found then
    if row(prior.actor_user_id,prior.target_user_id,prior.requested_active,prior.environment,
           prior.expected_revision,prior.reason)
       is distinct from
       row(auth.uid(),p_target,p_active,p_environment,p_expected_revision,btrim(p_reason)) then
      raise exception 'Account access action UUID reused with changed inputs' using errcode='22023';
    end if;
    return query select prior.action_id,prior.target_user_id,prior.requested_active,
      prior.result_revision,prior.recovery_grant_id;
    return;
  end if;

  select * into access_row
  from private.account_work_access a
  where a.user_id=p_target
  for update;
  if not found then
    raise exception 'Target work access is unavailable' using errcode='42501';
  end if;
  if access_row.revision is distinct from p_expected_revision then
    raise exception 'Work access changed; reload before continuing' using errcode='40001';
  end if;

  authority:=private.account_access_authority(
    access_row.organization_id,p_target,access_row.work_role,p_environment
  );
  if authority is null then
    raise exception 'Account access change is not authorized' using errcode='42501';
  end if;

  if p_active then
    if access_row.active then
      raise exception 'Work access is already active' using errcode='22023';
    end if;
    if access_row.suspension_authority='OWNER' and authority<>'OWNER' then
      raise exception 'Only Product Owner authority can release this suspension' using errcode='42501';
    end if;
    if not private.account_identity_ready(access_row.organization_id,p_target,access_row.work_role) then
      raise exception 'Target Auth identity is not ready for work access' using errcode='42501';
    end if;
    if access_row.work_role='ADMIN' and cardinality(
      private.account_removed_teams(p_target,access_row.organization_id,'ADMIN')
    )=0 then
      raise exception 'Admin has no active team membership' using errcode='42501';
    end if;
    if access_row.work_role='SUPERVISOR' and (
      not exists(select 1 from private.org_work_settings s
        where s.organization_id=access_row.organization_id and s.supervisor_work_ready)
      or not exists(select 1 from private.supervisor_grants g
        where g.organization_id=access_row.organization_id and g.user_id=p_target and g.active)
    ) then
      raise exception 'Supervisor work access is not ready' using errcode='42501';
    end if;
    perform private.ensure_account_restore_capacity(
      access_row.organization_id,p_target,access_row.work_role
    );
    update private.account_work_access
       set active=true,
           suspension_authority=null,
           suspension_reason=null,
           disabled_at=null,
           revision=new_revision
     where organization_id=access_row.organization_id and user_id=p_target;
    removed:='{}'::uuid[];
    insert into private.account_work_access_actions(
      action_id,organization_id,actor_user_id,target_user_id,target_role,requested_active,
      authority,environment,expected_revision,prior_revision,result_revision,removed_team_ids,
      recovery_grant_id,reason
    ) values(
      p_action,access_row.organization_id,auth.uid(),p_target,access_row.work_role,true,
      authority,p_environment,p_expected_revision,access_row.revision,new_revision,removed,
      null,btrim(p_reason)
    );
    return query select p_action,p_target,true,new_revision,null::uuid;
    return;
  end if;

  if not access_row.active then
    raise exception 'Work access is already disabled' using errcode='22023';
  end if;
  removed:=private.account_removed_teams(
    p_target,access_row.organization_id,access_row.work_role
  );
  if access_row.work_role<>'CONTRACTOR' and cardinality(removed)=0 then
    raise exception 'Office scope must be mapped before work access can be disabled' using errcode='42501';
  end if;

  perform private.freeze_photo_recovery_scope(
    p_action,access_row.organization_id,p_target,access_row.revision,removed,btrim(p_reason)
  );

  update private.account_work_access
     set active=false,
         suspension_authority=authority,
         suspension_reason=btrim(p_reason),
         disabled_at=clock_timestamp(),
         revision=new_revision
   where organization_id=access_row.organization_id and user_id=p_target;

  perform private.complete_photo_recovery_grant(p_action);

  insert into private.account_work_access_actions(
    action_id,organization_id,actor_user_id,target_user_id,target_role,requested_active,
    authority,environment,expected_revision,prior_revision,result_revision,removed_team_ids,
    recovery_grant_id,reason
  ) values(
    p_action,access_row.organization_id,auth.uid(),p_target,access_row.work_role,false,
    authority,p_environment,p_expected_revision,access_row.revision,new_revision,removed,
    p_action,btrim(p_reason)
  );
  return query select p_action,p_target,false,new_revision,p_action;
end;
$function$
;

do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.complete_contractor_invitation_activation()'::regprocedure)<>'e0bb1dc4919d65e104f3f02e6082cfab' then raise exception 'Authority source drift: complete_contractor_invitation_activation';end if;end; $parity$;

CREATE OR REPLACE FUNCTION private.complete_contractor_invitation_activation()
 RETURNS TABLE(invitation_id uuid, email text, display_name text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare
  result record;
  invitation public.contractor_invitations%rowtype;
begin
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() then
    raise exception 'Current verified session required' using errcode='42501';
  end if;
  perform private.lock_legacy_work_authority();
  select * into result from private.complete_contractor_invitation_activation_legacy_engine();
  select * into invitation
  from public.contractor_invitations i
  where i.id=result.invitation_id
  for update;
  if invitation.team_id is null or not private.team_capability_for_user(invitation.created_by,invitation.organization_id,invitation.team_id,'INVITE_CONTRACTOR') or not exists(
    select 1 from public.admin_teams t
    where t.id=invitation.team_id and t.organization_id=invitation.organization_id and t.active
  ) then
    raise exception 'Contractor invitation requires a current explicit team' using errcode='42501';
  end if;
  if not exists(
    select 1 from auth.users u
    where u.id=auth.uid()
      and u.deleted_at is null
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
      and u.raw_app_meta_data->>'organization_id'=invitation.organization_id::text
      and u.raw_app_meta_data->>'role'='CONTRACTOR'
  ) then
    raise exception 'Current Contractor Auth identity no longer matches this invitation' using errcode='42501';
  end if;
  if exists(select 1 from private.account_work_access a where a.user_id=auth.uid()) then
    raise exception 'Contractor activation identity already has work access' using errcode='42501';
  end if;
  insert into private.account_work_access(organization_id,user_id,work_role,active)
    values(invitation.organization_id,auth.uid(),'CONTRACTOR',true);
  insert into private.contractor_team_memberships(organization_id,user_id,team_id,active)
    values(invitation.organization_id,auth.uid(),invitation.team_id,true);
  return query select result.invitation_id::uuid,result.email::text,
    result.display_name::text,result.status::text;
end;
$function$
;
