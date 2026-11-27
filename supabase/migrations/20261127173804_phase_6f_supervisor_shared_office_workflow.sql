-- Phase 6F-T01: selective Supervisor authority for the existing office
-- workflow owners. Admin/staffing/owner authority remains separate.

do $preflight$
begin
  if to_regprocedure('private.phase4_admin_org()') is null
     or to_regprocedure('private.admin_create_work_order(boolean,text,text,text,text,date,uuid)') is null
     or to_regprocedure('private.admin_update_work_order_phase4_engine(uuid,text,text,text,text,date,uuid)') is null
     or to_regprocedure('private.admin_job_draft(uuid,text,jsonb,uuid,timestamptz,uuid)') is null
  then raise exception 'Expected office workflow owners are missing; stop upgrade'; end if;
end;
$preflight$;

-- This is the only new common helper. It is deliberately not phase4_admin_org
-- and is used only by the listed shared office workflow functions below.
create function private.shared_office_work_org() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare o uuid; role_name text;
begin
  select a.organization_id into o from private.account_work_access a
   where a.user_id=auth.uid() and a.active and a.disabled_at is null;
  role_name:=private.current_work_role(o);
  if o is null or role_name not in ('ADMIN','SUPERVISOR')
     or auth.jwt()->'app_metadata'->>'role' is distinct from role_name
     or auth.jwt()->'app_metadata'->>'organization_id' is distinct from o::text
     or not exists(select 1 from public.admin_teams t
       where t.organization_id=o and private.has_team_capability(o,t.id,'WORK'))
  then raise exception 'Current scoped office work required' using errcode='42501'; end if;
  return o;
end; $$;
revoke all on function private.shared_office_work_org() from public,anon,authenticated,service_role;
grant execute on function private.shared_office_work_org() to service_role;

-- Rewrite only the canonical draft/create/template/correction owners. Each
-- source marker is checked before replacement so a deployed/source mismatch
-- fails closed; no hosted migration history is inferred or repaired.
do $rewrite$
declare src text; fn regprocedure;
begin
  foreach fn in array array[
    'private.admin_creation_client_choices()'::regprocedure,
    'private.admin_create_client_company(uuid,text)'::regprocedure,
    'private.admin_job_draft(uuid,text,jsonb,uuid,timestamptz,uuid)'::regprocedure,
    'private.admin_create_work_order_from_draft(uuid)'::regprocedure,
    'private.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb)'::regprocedure,
    'private.admin_create_work_order_v4_phase4_engine(boolean,text,text,text,text,date,uuid,jsonb)'::regprocedure,
    'private.admin_create_work_order(boolean,text,text,text,text,date,uuid)'::regprocedure,
    'private.admin_save_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid)'::regprocedure,
    'private.admin_save_photo_template_phase4_engine(uuid,text,text,jsonb,boolean,boolean,uuid)'::regprocedure,
    'private.admin_set_photo_requirements(uuid,uuid,jsonb)'::regprocedure,
    'private.admin_set_photo_requirements_phase4_engine(uuid,uuid,jsonb)'::regprocedure,
    'private.admin_save_company_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid,uuid,text,text)'::regprocedure,
    'private.admin_correction_basis(uuid)'::regprocedure,
    'private.admin_save_correction_draft(uuid,uuid,timestamptz,uuid,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb)'::regprocedure,
    'private.admin_create_followup(uuid,uuid,uuid,timestamptz,text,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    select pg_get_functiondef(fn) into src;
    if position('private.phase4_admin_org()' in src)=0
    then raise exception 'Unexpected source for %; stop upgrade',fn; end if;
    src:=replace(src,'private.phase4_admin_org()','private.shared_office_work_org()');
    -- The canonical private create owner is not client-callable; its public
    -- historical overloads remain revoked. Permit only the scoped role.
    if fn::text='private.admin_create_work_order(boolean,text,text,text,text,date,uuid)' then
      if position('if v_role <> ''ADMIN'' or v_org is null' in src)=0
      then raise exception 'Unexpected create authorization source; stop upgrade'; end if;
      src:=replace(src,'if v_role <> ''ADMIN'' or v_org is null',
        'if v_role not in (''ADMIN'',''SUPERVISOR'') or v_org is null');
    end if;
    execute src;
  end loop;
end;
$rewrite$;

-- Company-scoped template reads follow the same shared business boundary;
-- staffing and Product Owner controls still use their own private authority.
drop policy if exists photo_templates_admin_read on public.photo_templates;
create policy photo_templates_admin_read on public.photo_templates for select to authenticated
 using(organization_id=(select private.shared_office_work_org()));

-- The old nine-argument/non-CAS update entry points stay revoked. The shared
-- workspace gets a distinct action-bound CAS owner with exact replay identity.
create table private.supervisor_work_order_edit_actions(
 action_id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.supervisor_work_order_edit_actions enable row level security;
revoke all on private.supervisor_work_order_edit_actions from public,anon,authenticated,service_role;
grant select on private.supervisor_work_order_edit_actions to service_role;
create trigger supervisor_work_order_edit_actions_immutable before update or delete
 on private.supervisor_work_order_edit_actions for each row
 execute function private.protect_photo_transfer_ledger();

do $update_source$
declare src text;
begin
  select pg_get_functiondef('private.admin_update_work_order_phase4_engine(uuid,text,text,text,text,date,uuid)'::regprocedure)
    into src;
  if position('if v_role <> ''ADMIN'' or v_org is null' in src)=0
  then raise exception 'Unexpected CAS engine source; stop upgrade'; end if;
  src:=replace(src,'if v_role <> ''ADMIN'' or v_org is null',
    'if v_role not in (''ADMIN'',''SUPERVISOR'') or v_org is null');
  execute src;
end;
$update_source$;

create function public.office_supervisor_update_work_order_v4(
 p_action uuid,p_work_order_id uuid,p_wo_number text,p_property_address text,
 p_work_type text,p_instructions text,p_due_date date,p_assigned_user_id uuid,
 p_expected_revision uuid,p_requirements jsonb,p_expected_updated_at timestamptz
) returns setof jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $update$
declare org uuid; w public.work_orders%rowtype; result jsonb; fingerprint text; prior jsonb;
begin
 if p_action is null or p_work_order_id is null or p_expected_updated_at is null
    or p_expected_revision is null then
   raise exception 'Exact Supervisor work edit identity required' using errcode='22023'; end if;
 perform private.lock_legacy_work_authority();
 org:=private.shared_office_work_org();
 if not private.can_work_order(p_work_order_id) then
   raise exception 'Work order unavailable in current Supervisor scope' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fwh.supervisor.edit.'||p_action::text,0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(
   p_work_order_id,p_wo_number,p_property_address,p_work_type,p_instructions,
   p_due_date,p_assigned_user_id,p_expected_revision,p_requirements,
   p_expected_updated_at)::text,'UTF8')),'hex');
 select a.result into prior from private.supervisor_work_order_edit_actions a
  where a.action_id=p_action;
 if prior is not null then
   if not exists(select 1 from private.supervisor_work_order_edit_actions a
     where a.action_id=p_action and a.actor_id=auth.uid()
       and a.organization_id=org and a.work_order_id=p_work_order_id
       and a.request_fingerprint=fingerprint)
   then raise exception 'Changed Supervisor edit action identity' using errcode='40001'; end if;
   return next prior; return;
 end if;
 select * into w from public.work_orders where id=p_work_order_id for update;
 if w.id is null or w.organization_id is distinct from org
    or w.responsible_team_id is null
    or not private.has_team_capability(org,w.responsible_team_id,'WORK')
    or w.updated_at is distinct from p_expected_updated_at then
   raise exception 'Work order changed or is outside current Supervisor scope' using errcode='40001'; end if;
 if not exists(select 1 from auth.users u join private.account_work_access a on a.user_id=u.id
   where u.id=p_assigned_user_id and a.organization_id=org and a.work_role='CONTRACTOR'
     and a.active and a.disabled_at is null and u.deleted_at is null
     and private.contractor_current_team(u.id,org)=w.responsible_team_id) then
   raise exception 'Assignee is not an active Contractor in the responsible team' using errcode='42501'; end if;
 if p_requirements is not null then
   perform private.admin_set_photo_requirements(p_work_order_id,p_expected_revision,p_requirements);
 end if;
 select to_jsonb(x) into result from private.admin_update_work_order_phase4_engine(
   p_work_order_id,p_wo_number,p_property_address,p_work_type,p_instructions,
   p_due_date,p_assigned_user_id) x;
 insert into private.supervisor_work_order_edit_actions(action_id,organization_id,work_order_id,
   actor_id,request_fingerprint,result)
 values(p_action,org,p_work_order_id,auth.uid(),fingerprint,result);
 return next result;
end;$update$;
revoke all on function public.office_supervisor_update_work_order_v4(
 uuid,uuid,text,text,text,text,date,uuid,uuid,jsonb,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.office_supervisor_update_work_order_v4(
 uuid,uuid,text,text,text,text,date,uuid,uuid,jsonb,timestamptz) to authenticated;

create or replace function public.office_supervisor_assignable_users()
returns table(user_id uuid,email text,role text)
language sql stable security definer set search_path='' as $$
  select distinct u.id,u.email,'CONTRACTOR'::text
    from auth.users u
    join private.account_work_access a on a.user_id=u.id and a.work_role='CONTRACTOR'
      and a.active and a.disabled_at is null
    join private.contractor_team_memberships m on m.user_id=u.id
      and m.organization_id=a.organization_id and m.active
    where private.current_work_role(a.organization_id)='SUPERVISOR'
      and private.has_team_capability(a.organization_id,m.team_id,'WORK')
      and u.deleted_at is null and u.email_confirmed_at is not null
    order by u.email,u.id limit 500;
$$;
revoke all on function public.office_supervisor_assignable_users() from public,anon,authenticated,service_role;
grant execute on function public.office_supervisor_assignable_users() to authenticated;
