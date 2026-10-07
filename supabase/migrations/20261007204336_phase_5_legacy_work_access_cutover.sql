-- Compatible current-work gates; no hosted grants, guessed mappings or Supervisor activation.
-- Recovery/transfer authority stays in its separate exact-evidence ledger.
create function private.legacy_work_org(p_role text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare o uuid;
begin
  select organization_id into o from private.account_work_access where user_id=auth.uid();
  if p_role is null or p_role not in ('ADMIN','CONTRACTOR') or o is null or private.current_work_role(o) is distinct from p_role
    or auth.jwt()->'app_metadata'->>'role' is distinct from p_role
    or auth.jwt()->'app_metadata'->>'organization_id' is distinct from o::text then
    raise exception 'Current work authorization required' using errcode='42501';end if;
  return o;
end; $$;

create or replace function private.phase4_admin_org() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare o uuid:=private.legacy_work_org('ADMIN');
begin
  if not exists(select 1 from public.admin_teams t where t.organization_id=o
    and private.has_team_capability(o,t.id,'WORK')) then
    raise exception 'Active office scope required' using errcode='42501';end if;
  return o;
end; $$;

create function private.contractor_current_team(p_user uuid,p_org uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select m.team_id from private.contractor_team_memberships m join public.admin_teams t
    on t.id=m.team_id and t.organization_id=m.organization_id
  where m.user_id=p_user and m.organization_id=p_org and m.active and t.active
    and private.work_role_for_user(p_user,p_org)='CONTRACTOR';
$$;

create function private.current_operational_identity(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_identity_valid() and private.current_work_role(p_org) is not null
    and auth.jwt()->'app_metadata'->>'role'=private.current_work_role(p_org)
    and auth.jwt()->'app_metadata'->>'organization_id'=p_org::text;
$$;
create function private.can_read_office_work_order(p_work_order uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.work_orders w where w.id=p_work_order
    and private.current_operational_identity(w.organization_id) and private.can_work_order(w.id));
$$;
revoke all on function private.current_operational_identity(uuid),private.can_read_office_work_order(uuid) from public,anon,authenticated;
grant execute on function private.current_operational_identity(uuid),private.can_read_office_work_order(uuid) to authenticated,service_role;

create function private.can_read_work_order(p_work_order uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_identity_valid() and exists(select 1 from public.work_orders w
    join public.admin_teams t on t.id=w.responsible_team_id and t.organization_id=w.organization_id and t.active
    where w.id=p_work_order and private.current_operational_identity(w.organization_id) and (
      private.has_team_capability(w.organization_id,w.responsible_team_id,'WORK')
      or (private.current_work_role(w.organization_id)='CONTRACTOR' and w.assigned_user_id=auth.uid()
        and private.contractor_current_team(auth.uid(),w.organization_id)=w.responsible_team_id)));
$$;

create function private.can_read_own_evidence(p_work_order uuid,p_captured_by uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_identity_valid() and exists(select 1 from public.work_orders w
    join public.admin_teams t on t.id=w.responsible_team_id and t.organization_id=w.organization_id and t.active
    where w.id=p_work_order and private.current_operational_identity(w.organization_id) and p_captured_by=auth.uid()
      and private.current_work_role(w.organization_id)='CONTRACTOR');
$$;

-- Same ordering as the existing recovery cutoff. These locks live only for a short
-- SQL transaction, never a network upload. A queued mutation rereads committed access.
create function private.lock_legacy_work_authority() returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  lock table private.photo_recovery_grants in row exclusive mode;
  lock table auth.users,auth.sessions,private.account_work_access,private.admin_team_memberships,
    private.contractor_team_memberships,private.supervisor_grants,private.supervisor_team_scopes,
    private.org_work_settings,public.admin_teams,public.contractor_invitations in share mode;
end; $$;

create function private.legacy_dispatch_team(p_org uuid,p_contractor uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare t uuid:=private.contractor_current_team(p_contractor,p_org);
begin
  if t is null or not private.has_team_capability(p_org,t,'WORK') then
    raise exception 'Assignee unavailable in this office scope' using errcode='42501';end if;
  return t;
end; $$;

create function private.guard_legacy_work_order(p_work_order uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$
declare o uuid; w public.work_orders%rowtype;
begin
  perform private.lock_legacy_work_authority();
  o:=private.legacy_work_org(p_role);
  select * into w from public.work_orders where id=p_work_order for update;
  if not found or w.organization_id is distinct from o or w.responsible_team_id is null
    or not exists(select 1 from public.admin_teams t where t.id=w.responsible_team_id and t.organization_id=o and t.active)
    or (p_role='ADMIN' and not private.has_team_capability(o,w.responsible_team_id,'WORK'))
    or (p_role='CONTRACTOR' and private.contractor_current_team(auth.uid(),o) is distinct from w.responsible_team_id) then
    raise exception 'Work order unavailable in current scope' using errcode='42501';end if;
end; $$;

revoke all on function private.legacy_work_org(text),private.contractor_current_team(uuid,uuid),
  private.can_read_work_order(uuid),private.can_read_own_evidence(uuid,uuid),
  private.lock_legacy_work_authority(),private.legacy_dispatch_team(uuid,uuid),
  private.guard_legacy_work_order(uuid,text) from public,anon,authenticated;
grant execute on function private.can_read_work_order(uuid),private.can_read_own_evidence(uuid,uuid),
  private.can_work_order(uuid) to authenticated;
grant execute on function private.legacy_work_org(text),private.contractor_current_team(uuid,uuid),
  private.can_read_work_order(uuid),private.can_read_own_evidence(uuid,uuid),
  private.lock_legacy_work_authority(),private.legacy_dispatch_team(uuid,uuid),
  private.guard_legacy_work_order(uuid,text) to service_role;

-- Only guarded server dispatch can create/edit work; no new direct mutation grant.
drop policy if exists work_orders_admin_insert on public.work_orders;
drop policy if exists work_orders_admin_update on public.work_orders;
revoke insert,update on public.work_orders from authenticated;
alter policy organizations_select_own on public.organizations using (
  private.current_operational_identity(id));
grant execute on function private.current_work_role(uuid) to authenticated;
alter policy work_orders_select_allowed on public.work_orders using(private.can_read_work_order(id));
alter policy work_order_runs_select_allowed on public.work_order_runs using(
  private.can_read_office_work_order(work_order_id) or (private.can_read_work_order(work_order_id)
    and exists(select 1 from public.work_orders w where w.id=work_order_id and w.current_run_id=work_order_runs.id)));
alter policy work_order_assignments_select_allowed on public.work_order_assignments using(
  exists(select 1 from public.work_order_runs r where r.id=work_order_assignments.run_id
    and (private.can_read_office_work_order(r.work_order_id) or (assigned_user_id=(select auth.uid()) and private.can_read_work_order(r.work_order_id)))));
alter policy field_actions_select_allowed on public.field_actions using(
  private.can_read_office_work_order(work_order_id) or (actor_user_id=(select auth.uid()) and private.can_read_work_order(work_order_id)));
alter policy photo_finish_sets_read on public.photo_finish_sets using(
  private.can_read_office_work_order(work_order_id) or private.can_read_own_evidence(work_order_id,actor_user_id));
alter policy photos_select_allowed on public.photos using(
  private.can_read_office_work_order(work_order_id) or private.can_read_own_evidence(work_order_id,captured_by));
create function private.legacy_photo_insert_allowed(p_work_order uuid) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare o uuid;
begin
  lock table auth.users,auth.sessions,private.account_work_access,
    private.contractor_team_memberships,public.admin_teams,public.contractor_invitations in share mode;
  o:=private.legacy_work_org('CONTRACTOR');
  return private.can_read_work_order(p_work_order);
end; $$;
revoke all on function private.legacy_photo_insert_allowed(uuid) from public,anon,authenticated;
grant execute on function private.legacy_photo_insert_allowed(uuid) to authenticated,service_role;
-- Retain Phase 4's empty-snapshot, current-run and waiting-only constraints.
create policy photos_current_work_insert on public.photos as restrictive for insert to authenticated with check(
  private.legacy_photo_insert_allowed(work_order_id) and captured_by=(select auth.uid()));

-- Retain reviewed Phase 4 accept_field_action behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.accept_field_action(uuid,uuid,uuid,uuid,text,text)'::regprocedure) is distinct from 'bc8237af3ec972525fdb8e63afb64af0' then raise exception 'Mutation source drift: accept_field_action';end if;end; $parity$;
alter function private.accept_field_action(uuid,uuid,uuid,uuid,text,text) rename to accept_field_action_phase4_engine;
revoke all on function private.accept_field_action_phase4_engine(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.accept_field_action_phase4_engine(uuid,uuid,uuid,uuid,text,text) to service_role;
create function private.accept_field_action(p_action_id uuid, p_work_order_id uuid, p_run_id uuid, p_assignment_instance_id uuid, p_action_kind text, p_event_time text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
  return private.accept_field_action_phase4_engine(p_action_id,p_work_order_id,p_run_id,p_assignment_instance_id,p_action_kind,p_event_time);
end; $$;
revoke all on function private.accept_field_action(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.accept_field_action(uuid,uuid,uuid,uuid,text,text) to authenticated,service_role;

-- Retain reviewed Phase 4 accept_field_action_v4 behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.accept_field_action_v4(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text)'::regprocedure) is distinct from 'f8b4593699dc702a33f86034f79b5385' then raise exception 'Mutation source drift: accept_field_action_v4';end if;end; $parity$;
alter function private.accept_field_action_v4(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text) rename to accept_field_action_v4_phase4_engine;
revoke all on function private.accept_field_action_v4_phase4_engine(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.accept_field_action_v4_phase4_engine(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text) to service_role;
create function private.accept_field_action_v4(p_action_id uuid, p_work_order_id uuid, p_run_id uuid, p_assignment_instance_id uuid, p_action_kind text, p_event_time text, p_requirement_revision uuid, p_finish_set_id uuid, p_finish_digest text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
  return private.accept_field_action_v4_phase4_engine(p_action_id,p_work_order_id,p_run_id,p_assignment_instance_id,p_action_kind,p_event_time,p_requirement_revision,p_finish_set_id,p_finish_digest);
end; $$;
revoke all on function private.accept_field_action_v4(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.accept_field_action_v4(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text) to authenticated,service_role;

-- Retain reviewed Phase 4 register_photo_finish_set behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.register_photo_finish_set(uuid,uuid,uuid,uuid,uuid,jsonb,text,text)'::regprocedure) is distinct from '254e29796696e6ba3756568dce3878e5' then raise exception 'Mutation source drift: register_photo_finish_set';end if;end; $parity$;
alter function private.register_photo_finish_set(uuid,uuid,uuid,uuid,uuid,jsonb,text,text) rename to register_photo_finish_set_phase4_engine;
revoke all on function private.register_photo_finish_set_phase4_engine(uuid,uuid,uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.register_photo_finish_set_phase4_engine(uuid,uuid,uuid,uuid,uuid,jsonb,text,text) to service_role;
create function private.register_photo_finish_set(p_set_id uuid, p_work_order_id uuid, p_run_id uuid, p_assignment_instance_id uuid, p_requirement_revision uuid, p_photos jsonb, p_digest text, p_payload text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
  return private.register_photo_finish_set_phase4_engine(p_set_id,p_work_order_id,p_run_id,p_assignment_instance_id,p_requirement_revision,p_photos,p_digest,p_payload);
end; $$;
revoke all on function private.register_photo_finish_set(uuid,uuid,uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.register_photo_finish_set(uuid,uuid,uuid,uuid,uuid,jsonb,text,text) to authenticated,service_role;

-- Retain reviewed Phase 4 acknowledge_assignment_received behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.acknowledge_assignment_received(uuid)'::regprocedure) is distinct from 'a63b6f8cc75c9d9a3a2d208eb51f83c1' then raise exception 'Mutation source drift: acknowledge_assignment_received';end if;end; $parity$;
alter function private.acknowledge_assignment_received(uuid) rename to acknowledge_assignment_received_phase4_engine;
revoke all on function private.acknowledge_assignment_received_phase4_engine(uuid) from public,anon,authenticated;
grant execute on function private.acknowledge_assignment_received_phase4_engine(uuid) to service_role;
create function private.acknowledge_assignment_received(p_work_order_id uuid) returns TABLE(work_order_id uuid, assignment_received_at timestamp with time zone)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
  return query select * from private.acknowledge_assignment_received_phase4_engine(p_work_order_id);
end; $$;
revoke all on function private.acknowledge_assignment_received(uuid) from public,anon,authenticated;
grant execute on function private.acknowledge_assignment_received(uuid) to authenticated,service_role;

-- Retain reviewed Phase 4 start_work behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.start_work(uuid)'::regprocedure) is distinct from '99deef85934b417c48bf1ab04b23787c' then raise exception 'Mutation source drift: start_work';end if;end; $parity$;
alter function private.start_work(uuid) rename to start_work_phase4_engine;
revoke all on function private.start_work_phase4_engine(uuid) from public,anon,authenticated;
grant execute on function private.start_work_phase4_engine(uuid) to service_role;
create function private.start_work(p_work_order_id uuid) returns TABLE(work_order_id uuid, field_status text, started_at timestamp with time zone, field_completed_at timestamp with time zone)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
  return query select * from private.start_work_phase4_engine(p_work_order_id);
end; $$;
revoke all on function private.start_work(uuid) from public,anon,authenticated;
grant execute on function private.start_work(uuid) to authenticated,service_role;

-- Retain reviewed Phase 4 complete_field_work behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.complete_field_work(uuid)'::regprocedure) is distinct from 'f3a04aeedfe0dff1855b8b33423e02d1' then raise exception 'Mutation source drift: complete_field_work';end if;end; $parity$;
alter function private.complete_field_work(uuid) rename to complete_field_work_phase4_engine;
revoke all on function private.complete_field_work_phase4_engine(uuid) from public,anon,authenticated;
grant execute on function private.complete_field_work_phase4_engine(uuid) to service_role;
create function private.complete_field_work(p_work_order_id uuid) returns TABLE(work_order_id uuid, field_status text, started_at timestamp with time zone, field_completed_at timestamp with time zone)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
  return query select * from private.complete_field_work_phase4_engine(p_work_order_id);
end; $$;
revoke all on function private.complete_field_work(uuid) from public,anon,authenticated;
grant execute on function private.complete_field_work(uuid) to authenticated,service_role;

-- Retain reviewed Phase 4 respond_reassignment behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.respond_reassignment(uuid,boolean)'::regprocedure) is distinct from '2c4e92f68606158f2f6abf2301bba7f1' then raise exception 'Mutation source drift: respond_reassignment';end if;end; $parity$;
alter function private.respond_reassignment(uuid,boolean) rename to respond_reassignment_phase4_engine;
revoke all on function private.respond_reassignment_phase4_engine(uuid,boolean) from public,anon,authenticated;
grant execute on function private.respond_reassignment_phase4_engine(uuid,boolean) to service_role;
create function private.respond_reassignment(p_work_order_id uuid, p_accept boolean) returns TABLE(work_order_id uuid, accepted boolean, assigned_user_id uuid, field_status text)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
  if p_accept and exists(select 1 from public.work_orders w where w.id=p_work_order_id and private.contractor_current_team(w.pending_assignee_user_id,w.organization_id) is distinct from w.responsible_team_id) then
    raise exception 'Pending Contractor unavailable in responsible team' using errcode='42501';end if;
  return query select * from private.respond_reassignment_phase4_engine(p_work_order_id,p_accept);
end; $$;
revoke all on function private.respond_reassignment(uuid,boolean) from public,anon,authenticated;
grant execute on function private.respond_reassignment(uuid,boolean) to authenticated,service_role;

-- Retain reviewed Phase 4 admin_update_work_order behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.admin_update_work_order(uuid,text,text,text,text,date,uuid)'::regprocedure) is distinct from '308745dc2d56025918e299882ded051d' then raise exception 'Mutation source drift: admin_update_work_order';end if;end; $parity$;
alter function private.admin_update_work_order(uuid,text,text,text,text,date,uuid) rename to admin_update_work_order_phase4_engine;
revoke all on function private.admin_update_work_order_phase4_engine(uuid,text,text,text,text,date,uuid) from public,anon,authenticated;
grant execute on function private.admin_update_work_order_phase4_engine(uuid,text,text,text,text,date,uuid) to service_role;
create function private.admin_update_work_order(p_work_order_id uuid, p_wo_number text, p_property_address text, p_work_type text, p_instructions text, p_due_date date, p_assigned_user_id uuid) returns TABLE(work_order_id uuid, organization_id uuid, assigned_user_id uuid, pending_assignee_user_id uuid, reassignment_requested_at timestamp with time zone, wo_number text, property_address text, work_type text, instructions text, due_date date, field_status text, updated_at timestamp with time zone)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'ADMIN');
  if p_assigned_user_id is distinct from (select w.assigned_user_id from public.work_orders w where w.id=p_work_order_id) then
    if private.legacy_dispatch_team(private.phase4_admin_org(),p_assigned_user_id) is distinct from (select w.responsible_team_id from public.work_orders w where w.id=p_work_order_id) then
      raise exception 'Reassignment must retain responsible team' using errcode='42501';end if;
  elsif private.work_role_for_user(p_assigned_user_id,private.phase4_admin_org())='CONTRACTOR' then
    if private.contractor_current_team(p_assigned_user_id,private.phase4_admin_org()) is distinct from (select w.responsible_team_id from public.work_orders w where w.id=p_work_order_id) then
      raise exception 'Current Contractor unavailable in responsible team' using errcode='42501';end if;
  end if;
  return query select * from private.admin_update_work_order_phase4_engine(p_work_order_id,p_wo_number,p_property_address,p_work_type,p_instructions,p_due_date,p_assigned_user_id);
end; $$;
revoke all on function private.admin_update_work_order(uuid,text,text,text,text,date,uuid) from public,anon,authenticated;
grant execute on function private.admin_update_work_order(uuid,text,text,text,text,date,uuid) to authenticated,service_role;

-- Retain reviewed Phase 4 admin_update_work_order_v4 behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb)'::regprocedure) is distinct from '873a2f72408b0c03224bcf5d4a38f06d' then raise exception 'Mutation source drift: admin_update_work_order_v4';end if;end; $parity$;
alter function private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb) rename to admin_update_work_order_v4_phase4_engine;
revoke all on function private.admin_update_work_order_v4_phase4_engine(uuid,text,text,text,text,date,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_update_work_order_v4_phase4_engine(uuid,text,text,text,text,date,uuid,uuid,jsonb) to service_role;
create function private.admin_update_work_order_v4(p_work_order_id uuid, p_wo_number text, p_property_address text, p_work_type text, p_instructions text, p_due_date date, p_assigned_user_id uuid, p_expected_revision uuid, p_requirements jsonb) returns SETOF jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'ADMIN');
  if p_assigned_user_id is distinct from (select w.assigned_user_id from public.work_orders w where w.id=p_work_order_id) then
    if private.legacy_dispatch_team(private.phase4_admin_org(),p_assigned_user_id) is distinct from (select w.responsible_team_id from public.work_orders w where w.id=p_work_order_id) then
      raise exception 'Reassignment must retain responsible team' using errcode='42501';end if;
  elsif private.work_role_for_user(p_assigned_user_id,private.phase4_admin_org())='CONTRACTOR' then
    if private.contractor_current_team(p_assigned_user_id,private.phase4_admin_org()) is distinct from (select w.responsible_team_id from public.work_orders w where w.id=p_work_order_id) then
      raise exception 'Current Contractor unavailable in responsible team' using errcode='42501';end if;
  end if;
  return query select * from private.admin_update_work_order_v4_phase4_engine(p_work_order_id,p_wo_number,p_property_address,p_work_type,p_instructions,p_due_date,p_assigned_user_id,p_expected_revision,p_requirements);
end; $$;
revoke all on function private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb) to authenticated,service_role;

-- Retain reviewed Phase 4 admin_set_photo_requirements behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.admin_set_photo_requirements(uuid,uuid,jsonb)'::regprocedure) is distinct from 'd91ff5f2b5eeda06129171ae057b715c' then raise exception 'Mutation source drift: admin_set_photo_requirements';end if;end; $parity$;
alter function private.admin_set_photo_requirements(uuid,uuid,jsonb) rename to admin_set_photo_requirements_phase4_engine;
revoke all on function private.admin_set_photo_requirements_phase4_engine(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_set_photo_requirements_phase4_engine(uuid,uuid,jsonb) to service_role;
create function private.admin_set_photo_requirements(p_work_order_id uuid, p_expected_revision uuid, p_requirements jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'ADMIN');
  return private.admin_set_photo_requirements_phase4_engine(p_work_order_id,p_expected_revision,p_requirements);
end; $$;
revoke all on function private.admin_set_photo_requirements(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_set_photo_requirements(uuid,uuid,jsonb) to authenticated,service_role;

-- Retain reviewed Phase 4 admin_save_photo_template behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.admin_save_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid)'::regprocedure) is distinct from '2275728371f6cfd9ea204b8dc507ec2a' then raise exception 'Mutation source drift: admin_save_photo_template';end if;end; $parity$;
alter function private.admin_save_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid) rename to admin_save_photo_template_phase4_engine;
revoke all on function private.admin_save_photo_template_phase4_engine(uuid,text,text,jsonb,boolean,boolean,uuid) from public,anon,authenticated;
grant execute on function private.admin_save_photo_template_phase4_engine(uuid,text,text,jsonb,boolean,boolean,uuid) to service_role;
create function private.admin_save_photo_template(p_id uuid, p_name text, p_work_type text, p_requirements jsonb, p_active boolean, p_is_default boolean, p_expected_revision uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.lock_legacy_work_authority();
  perform private.phase4_admin_org();
  return private.admin_save_photo_template_phase4_engine(p_id,p_name,p_work_type,p_requirements,p_active,p_is_default,p_expected_revision);
end; $$;
revoke all on function private.admin_save_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid) from public,anon,authenticated;
grant execute on function private.admin_save_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid) to authenticated,service_role;

-- Retain reviewed Phase 4 admin_create_work_order_v4 behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb)'::regprocedure) is distinct from '6704e6dccbdf1387cbcb27249aefed37' then raise exception 'Mutation source drift: admin_create_work_order_v4';end if;end; $parity$;
alter function private.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb) rename to admin_create_work_order_v4_phase4_engine;
revoke all on function private.admin_create_work_order_v4_phase4_engine(boolean,text,text,text,text,date,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_create_work_order_v4_phase4_engine(boolean,text,text,text,text,date,uuid,jsonb) to service_role;
create function private.admin_create_work_order_v4(p_generate_wo_number boolean, p_wo_number text, p_property_address text, p_work_type text, p_instructions text, p_due_date date, p_assigned_user_id uuid, p_requirements jsonb) returns SETOF jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.lock_legacy_work_authority();
  perform private.phase4_admin_org();
  return query select * from private.admin_create_work_order_v4_phase4_engine(p_generate_wo_number,p_wo_number,p_property_address,p_work_type,p_instructions,p_due_date,p_assigned_user_id,p_requirements);
end; $$;
revoke all on function private.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb) to authenticated,service_role;

-- Retain reviewed Phase 4 admin_list_assignable_users behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.admin_list_assignable_users()'::regprocedure) is distinct from 'af810ddfc075bcccb2ac334bbd3f8b29' then raise exception 'Mutation source drift: admin_list_assignable_users';end if;end; $parity$;
alter function private.admin_list_assignable_users() rename to admin_list_assignable_users_phase4_engine;
revoke all on function private.admin_list_assignable_users_phase4_engine() from public,anon,authenticated;
grant execute on function private.admin_list_assignable_users_phase4_engine() to service_role;
create function private.admin_list_assignable_users() returns TABLE(user_id uuid, email text, role text)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.phase4_admin_org();
  return query select u.* from private.admin_list_assignable_users_phase4_engine() u where exists(select 1 from private.contractor_team_memberships m where m.user_id=u.user_id and m.organization_id=private.phase4_admin_org() and m.active and private.work_role_for_user(m.user_id,m.organization_id)='CONTRACTOR' and private.has_team_capability(m.organization_id,m.team_id,'WORK'));
end; $$;
revoke all on function private.admin_list_assignable_users() from public,anon,authenticated;
grant execute on function private.admin_list_assignable_users() to authenticated,service_role;

-- Retain reviewed Phase 4 field_assignments behavior; fail migration on source drift.
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.field_assignments()'::regprocedure) is distinct from '92ff93c1f1775ada89f62a6fc25dda3f' then raise exception 'Mutation source drift: field_assignments';end if;end; $parity$;
alter function private.field_assignments() rename to field_assignments_phase4_engine;
revoke all on function private.field_assignments_phase4_engine() from public,anon,authenticated;
grant execute on function private.field_assignments_phase4_engine() to service_role;
create function private.field_assignments() returns SETOF jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.legacy_work_org(auth.jwt()->'app_metadata'->>'role');
  return query select j from private.field_assignments_phase4_engine() j where private.can_read_work_order((j->>'id')::uuid);
end; $$;
revoke all on function private.field_assignments() from public,anon,authenticated;
grant execute on function private.field_assignments() to authenticated,service_role;

do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.admin_create_work_order(boolean,text,text,text,text,date,uuid)'::regprocedure) is distinct from '4f8e32953268d8e890dfd988493758d6' then raise exception 'Mutation source drift: admin_create_work_order';end if;end; $parity$;
CREATE OR REPLACE FUNCTION private.admin_create_work_order(p_generate_wo_number boolean, p_wo_number text, p_property_address text, p_work_type text, p_instructions text, p_due_date date, p_assigned_user_id uuid)
 RETURNS TABLE(work_order_id uuid, organization_id uuid, assigned_user_id uuid, wo_number text, property_address text, work_type text, instructions text, due_date date, field_status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_row public.work_orders%rowtype;
  v_wo_number text;
begin
  perform private.lock_legacy_work_authority();
  perform private.phase4_admin_org();
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_role <> 'ADMIN' or v_org is null then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;

  if btrim(coalesce(p_property_address, '')) = '' then
    raise exception 'Property address is required' using errcode = '22023';
  end if;

  if btrim(coalesce(p_work_type, '')) = '' then
    raise exception 'Work type is required' using errcode = '22023';
  end if;

  if p_due_date is null then
    raise exception 'Due date is required' using errcode = '22023';
  end if;

  if p_assigned_user_id is null then
    raise exception 'Assignee is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = p_assigned_user_id
      and u.deleted_at is null
      and u.raw_app_meta_data ->> 'organization_id' = v_org::text
      and u.raw_app_meta_data ->> 'role' = 'CONTRACTOR'
  ) then
    raise exception 'Assignee is not an active Contractor in this organization' using errcode = '42501';
  end if;

  if coalesce(p_generate_wo_number, true) then
    v_wo_number := 'FPP-' || lpad(nextval('public.work_order_number_seq')::text, 6, '0');
  else
    v_wo_number := btrim(coalesce(p_wo_number, ''));
    if v_wo_number = '' then
      raise exception 'Work-order number is required when using a custom number' using errcode = '22023';
    end if;
  end if;

  insert into public.work_orders (
    organization_id,
    responsible_team_id,
    assigned_user_id,
    wo_number,
    property_address,
    work_type,
    instructions,
    due_date,
    field_status
  ) values (
    v_org,
    private.legacy_dispatch_team(v_org,p_assigned_user_id),
    p_assigned_user_id,
    v_wo_number,
    btrim(p_property_address),
    btrim(p_work_type),
    nullif(btrim(coalesce(p_instructions, '')), ''),
    p_due_date,
    'ASSIGNED'
  )
  returning * into v_row;

  return query
  select
    v_row.id,
    v_row.organization_id,
    v_row.assigned_user_id,
    v_row.wo_number,
    v_row.property_address,
    v_row.work_type,
    v_row.instructions,
    v_row.due_date,
    v_row.field_status,
    v_row.created_at;
exception
  when unique_violation then
    raise exception 'That work-order number already exists in this organization' using errcode = '23505';
end;
$function$
;

-- Compatibility: an unchanged historical Admin assignment can be edited, not dispatched.
CREATE OR REPLACE FUNCTION private.admin_update_work_order_phase4_engine(p_work_order_id uuid, p_wo_number text, p_property_address text, p_work_type text, p_instructions text, p_due_date date, p_assigned_user_id uuid)
 RETURNS TABLE(work_order_id uuid, organization_id uuid, assigned_user_id uuid, pending_assignee_user_id uuid, reassignment_requested_at timestamp with time zone, wo_number text, property_address text, work_type text, instructions text, due_date date, field_status text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_row public.work_orders%rowtype;
  v_assignment_changed boolean;
begin
  if v_role='ADMIN' then perform private.phase4_admin_org();
  elsif v_role='CONTRACTOR' and not private.is_assignable_contractor(v_uid,v_org) then
    raise exception 'Active Contractor required' using errcode='42501'; end if;
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_role <> 'ADMIN' or v_org is null then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;

  select * into v_row
  from public.work_orders
  where id = p_work_order_id for update;

  if not found or v_row.organization_id is distinct from v_org then
    raise exception 'Work order not available to this Admin' using errcode = '42501';
  end if;

  if btrim(coalesce(p_wo_number, '')) = ''
     or btrim(coalesce(p_property_address, '')) = ''
     or btrim(coalesce(p_work_type, '')) = ''
     or p_due_date is null
     or p_assigned_user_id is null then
    raise exception 'Required work-order field is missing' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = p_assigned_user_id
      and u.deleted_at is null
      and u.raw_app_meta_data ->> 'organization_id' = v_org::text
      and (u.raw_app_meta_data ->> 'role' = 'CONTRACTOR'
        or (p_assigned_user_id=v_row.assigned_user_id and u.raw_app_meta_data ->> 'role'='ADMIN'))
  ) then
    raise exception 'Assignee is not an active Contractor in this organization' using errcode = '42501';
  end if;

  v_assignment_changed := p_assigned_user_id is distinct from v_row.assigned_user_id;

  if v_row.field_status = 'ASSIGNED' then
    update public.work_orders
       set wo_number = btrim(p_wo_number),
           property_address = btrim(p_property_address),
           work_type = btrim(p_work_type),
           instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
           due_date = p_due_date,
           assigned_user_id = p_assigned_user_id,
           assignment_received_at = case when v_assignment_changed then null else assignment_received_at end,
           pending_assignee_user_id = null,
           reassignment_requested_at = null
     where id = p_work_order_id
     returning * into v_row;
  elsif v_row.field_status = 'IN_PROGRESS' then
    update public.work_orders
       set wo_number = btrim(p_wo_number),
           property_address = btrim(p_property_address),
           work_type = btrim(p_work_type),
           instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
           due_date = p_due_date,
           pending_assignee_user_id = case when v_assignment_changed then p_assigned_user_id else null end,
           reassignment_requested_at = case when v_assignment_changed then now() else null end
     where id = p_work_order_id
     returning * into v_row;
  elsif v_row.field_status in ('FIELD_COMPLETE', 'CANCELLED') then
    if v_assignment_changed then
      raise exception 'Completed or cancelled work cannot be reassigned' using errcode = '22023';
    end if;

    update public.work_orders
       set wo_number = btrim(p_wo_number),
           property_address = btrim(p_property_address),
           work_type = btrim(p_work_type),
           instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
           due_date = p_due_date,
           pending_assignee_user_id = null,
           reassignment_requested_at = null
     where id = p_work_order_id
     returning * into v_row;
  else
    raise exception 'Invalid work order state' using errcode = '22023';
  end if;

  return query
  select
    v_row.id,
    v_row.organization_id,
    v_row.assigned_user_id,
    v_row.pending_assignee_user_id,
    v_row.reassignment_requested_at,
    v_row.wo_number,
    v_row.property_address,
    v_row.work_type,
    v_row.instructions,
    v_row.due_date,
    v_row.field_status,
    v_row.updated_at;
end;
$function$
;
do $parity$ begin if (select md5(prosrc) from pg_proc where oid='private.enforce_work_order_assignable_contractors()'::regprocedure) is distinct from '6e8ffc1f71ecdd450e421e16f06be549' then raise exception 'Mutation source drift: assignment trigger';end if;end; $parity$;
CREATE OR REPLACE FUNCTION private.enforce_work_order_assignable_contractors()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (tg_op='INSERT' or new.assigned_user_id is distinct from old.assigned_user_id)
     and new.assigned_user_id is not null
     and not private.is_assignable_contractor(new.assigned_user_id, new.organization_id) then
    raise exception 'Assignee is not an active accepted Contractor in this organization'
      using errcode = '42501';
  end if;

  if (tg_op='INSERT' or new.pending_assignee_user_id is distinct from old.pending_assignee_user_id)
     and new.pending_assignee_user_id is not null
     and not private.is_assignable_contractor(new.pending_assignee_user_id, new.organization_id) then
    raise exception 'Pending assignee is not an active accepted Contractor in this organization'
      using errcode = '42501';
  end if;

  return new;
end;
$function$
;
