-- Phase 6C one owner for explicit cancellation and replacement of untouched
-- same-WO follow-ups. No undo of Finish, private photo, Accept, remote delivery
-- or committed work. An unresolved correction remains OPEN after cancellation.
create table private.followup_management_actions(
 action_id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 operation text not null check(operation in ('CANCEL_UNTOUCHED','REPLACE_CANCELLED')),
 original_run_id uuid not null,
 fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.followup_management_actions enable row level security;
revoke all on private.followup_management_actions from public,anon,authenticated,service_role;
grant select on private.followup_management_actions to service_role;
create trigger followup_management_actions_immutable before update or delete
 on private.followup_management_actions for each row
 execute function private.protect_photo_transfer_ledger();

create function private.untouched_followup_guard(p_wo uuid,p_run uuid)
returns void language plpgsql security definer set search_path='' as $guard$
declare w public.work_orders%rowtype; r public.work_order_runs%rowtype;
begin
 select * into w from public.work_orders where id=p_wo;
 select * into r from public.work_order_runs where id=p_run and work_order_id=p_wo;
 if w.id is null or w.current_run_id is distinct from p_run
  or w.current_run_sequence<=1 or r.id is null
  or w.field_status<>'ASSIGNED' or r.field_status<>'ASSIGNED'
  or w.assignment_received_at is not null or r.assignment_received_at is not null
  or w.started_at is not null or r.started_at is not null
  or exists(select 1 from public.work_order_assignments a where a.run_id=p_run
     and (a.assignment_received_at is not null or a.acknowledgment_received_at is not null
       or a.assignment_ended_at is not null))
  or exists(select 1 from public.field_actions a where a.run_id=p_run)
  or exists(select 1 from public.photos p where p.run_id=p_run)
  or exists(select 1 from public.photo_finish_sets f where f.run_id=p_run)
  or exists(select 1 from private.photo_transfers t where t.run_id=p_run)
  or exists(select 1 from private.client_packages k
     where k.work_order_id=p_wo and k.run_id=p_run)
 then raise exception 'Follow-up is not untouched; preserve field/photos and resolve protected conflict'
    using errcode='40001';end if;
end;$guard$;
-- Internal SECURITY DEFINER helper must never expose work existence or
-- protected phone evidence by direct authenticated invocation.
revoke all on function private.untouched_followup_guard(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.untouched_followup_guard(uuid,uuid) to service_role;

create function private.admin_followup_management_state(p_wo uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $state$
declare w public.work_orders%rowtype; obl private.correction_obligations%rowtype;
begin
 if p_wo is null or not private.current_identity_valid()
   or not private.can_work_order(p_wo)
 then raise exception 'Current scoped office work required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo;
 if w.id is null then raise exception 'Work unavailable' using errcode='42501';end if;
 select * into obl from private.correction_obligations o where
   o.work_order_id=p_wo and o.replacement_run_id=w.current_run_id and o.status='OPEN';
 if obl.id is null then return jsonb_build_object('work_order_id',p_wo,'available',false);end if;
 return jsonb_build_object('work_order_id',p_wo,'available',true,
   'run_id',w.current_run_id,'status',w.field_status,
   'wo_number',w.wo_number,'company_id',w.client_company_id,
   'expected_wo_updated_at',w.updated_at,
   'obligation_id',obl.id,'kind',obl.kind,'reason',obl.reason,
   'assigned_user_id',w.assigned_user_id,'due_date',w.due_date,
   'can_cancel',w.field_status='ASSIGNED' and w.assignment_received_at is null
     and not exists(select 1 from public.field_actions a where a.run_id=w.current_run_id)
     and not exists(select 1 from public.photos p where p.run_id=w.current_run_id)
     and not exists(select 1 from public.work_order_assignments a
       where a.run_id=w.current_run_id and
         (a.acknowledgment_received_at is not null or a.assignment_received_at is not null)),
   'can_replace',w.field_status='CANCELLED',
   'historical_run_id',obl.origin_run_id);
end;$state$;
create function public.admin_followup_management_state(p_wo uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_followup_management_state(p_wo)
$$;

create function private.admin_cancel_untouched_followup(
 p_action uuid,p_wo uuid,p_run uuid,p_expected_updated_at timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $cancel$
declare w public.work_orders%rowtype; obl private.correction_obligations%rowtype;
 prior private.followup_management_actions%rowtype; fingerprint text; result jsonb; org uuid;
begin
 if p_action is null or p_wo is null or p_run is null or p_expected_updated_at is null
   or coalesce(length(btrim(p_reason)) between 1 and 2000,false)=false
 then raise exception 'Exact cancelled follow-up and reason required' using errcode='22023';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(
   p_wo,p_run,p_expected_updated_at,btrim(p_reason))::text,'UTF8')),'hex');
 perform private.lock_account_lifecycle();
 org:=private.phase4_admin_org();
 if not private.current_identity_valid() or not private.can_work_order(p_wo)
 then raise exception 'Current scoped office cancellation authority required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo for update;
 select * into prior from private.followup_management_actions where action_id=p_action;
 if prior.action_id is not null then
   if row(prior.actor_id,prior.organization_id,prior.work_order_id,prior.original_run_id,
       prior.operation,prior.fingerprint)
      is distinct from row(auth.uid(),org,p_wo,p_run,'CANCEL_UNTOUCHED',fingerprint)
   then raise exception 'Changed cancellation replay forbidden' using errcode='40001';end if;
   return prior.result;
 end if;
 if w.id is null or w.organization_id is distinct from org
   or w.current_run_id is distinct from p_run
   or w.updated_at is distinct from p_expected_updated_at
 then raise exception 'Follow-up revision changed' using errcode='40001';end if;
 select * into obl from private.correction_obligations o
   where o.work_order_id=p_wo and o.replacement_run_id=p_run and o.status='OPEN' for update;
 if obl.id is null then raise exception 'Open follow-up obligation required' using errcode='40001';end if;
 perform private.untouched_followup_guard(p_wo,p_run);
 if exists(select 1 from private.client_packages k where k.work_order_id=p_wo
   and k.status in ('APPROVED','QUEUED','DELIVERING','FAILED','UNCERTAIN'))
 then raise exception 'Unresolved package blocks cancellation' using errcode='40001';end if;
 update public.work_orders set field_status='CANCELLED'
   where id=p_wo;
 -- Canonical work-order/run sync trigger closes the assignment with CANCELLED.
 result:=jsonb_build_object('work_order_id',p_wo,'run_id',p_run,
   'status','CANCELLED','obligation_id',obl.id,'obligation_status','OPEN');
 insert into private.followup_management_actions(
   action_id,organization_id,work_order_id,actor_id,operation,original_run_id,fingerprint,result)
 values(p_action,org,p_wo,auth.uid(),'CANCEL_UNTOUCHED',p_run,fingerprint,result);
 return result;
end;$cancel$;
create function public.admin_cancel_untouched_followup(
 p_action uuid,p_wo uuid,p_run uuid,p_expected_updated_at timestamptz,p_reason text
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_cancel_untouched_followup(p_action,p_wo,p_run,p_expected_updated_at,p_reason)
$$;

create function private.admin_replace_cancelled_followup(
 p_action uuid,p_wo uuid,p_cancelled_run uuid,p_expected_updated_at timestamptz,
 p_reason text,p_assigned_user uuid,p_due_date date,p_instructions text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $replace$
declare w public.work_orders%rowtype; cancelled public.work_order_runs%rowtype;
 obl private.correction_obligations%rowtype; prior private.followup_management_actions%rowtype;
 fresh uuid:=gen_random_uuid(); fresh_assignment uuid:=gen_random_uuid();
 new_obligation uuid:=gen_random_uuid(); fingerprint text; result jsonb; org uuid;
begin
 if p_action is null or p_wo is null or p_cancelled_run is null
  or p_expected_updated_at is null or p_assigned_user is null or p_due_date is null
  or coalesce(length(btrim(p_reason)) between 1 and 2000,false)=false
  or p_instructions is null or length(p_instructions)>4000
 then raise exception 'Explicit bounded correction replacement required' using errcode='22023';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(
   p_wo,p_cancelled_run,p_expected_updated_at,btrim(p_reason),
   p_assigned_user,p_due_date,p_instructions)::text,'UTF8')),'hex');
 perform private.lock_account_lifecycle();
 org:=private.phase4_admin_org();
 if not private.current_identity_valid() or not private.can_work_order(p_wo)
 then raise exception 'Current scoped office replacement authority required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo for update;
 select * into prior from private.followup_management_actions where action_id=p_action;
 if prior.action_id is not null then
   if row(prior.actor_id,prior.organization_id,prior.work_order_id,prior.original_run_id,
       prior.operation,prior.fingerprint) is distinct from
      row(auth.uid(),org,p_wo,p_cancelled_run,'REPLACE_CANCELLED',fingerprint)
   then raise exception 'Changed replacement replay forbidden' using errcode='40001';end if;
   return prior.result;
 end if;
 if w.id is null or w.organization_id is distinct from org
   or w.current_run_id is distinct from p_cancelled_run
   or w.updated_at is distinct from p_expected_updated_at
   or w.field_status<>'CANCELLED'
 then raise exception 'Cancelled follow-up revision changed' using errcode='40001';end if;
 select * into cancelled from public.work_order_runs
   where id=p_cancelled_run and work_order_id=p_wo for update;
 select * into obl from private.correction_obligations o
   where o.work_order_id=p_wo and o.replacement_run_id=p_cancelled_run and o.status='OPEN' for update;
 if cancelled.id is null or cancelled.field_status<>'CANCELLED' or obl.id is null
   or not exists(select 1 from private.followup_management_actions a
      where a.work_order_id=p_wo and a.original_run_id=p_cancelled_run
        and a.operation='CANCEL_UNTOUCHED')
   or exists(select 1 from public.photos ph where ph.run_id=p_cancelled_run)
   or exists(select 1 from public.field_actions fa where fa.run_id=p_cancelled_run)
   or exists(select 1 from private.photo_transfers t where t.run_id=p_cancelled_run)
   or exists(select 1 from public.work_order_assignments a where a.run_id=p_cancelled_run
      and (a.assignment_received_at is not null or a.acknowledgment_received_at is not null))
 then raise exception 'Only explicitly cancelled untouched correction may be replaced'
   using errcode='40001';end if;
 if exists(select 1 from private.client_packages k where k.work_order_id=p_wo
   and k.status in ('APPROVED','QUEUED','DELIVERING','FAILED','UNCERTAIN'))
 then raise exception 'Unresolved package blocks replacement' using errcode='40001';end if;
 if not private.is_assignable_contractor(p_assigned_user,org)
   or private.contractor_current_team(p_assigned_user,org)
      is distinct from w.responsible_team_id
 then raise exception 'Replacement contractor not eligible for this team'
   using errcode='42501';end if;
 insert into public.work_order_runs(
   id,work_order_id,organization_id,run_sequence,current_assignee_user_id,
   field_status,requirement_snapshot,reopen_reason)
 values(fresh,p_wo,org,w.current_run_sequence+1,p_assigned_user,
   'ASSIGNED',cancelled.requirement_snapshot,btrim(p_reason));
 -- First advance the current WO; the existing run-sync trigger may create
 -- the new assignment automatically if the contractor changes. Only create
 -- one explicitly when no active assignment was created by that owner.
 update public.work_orders set current_run_id=fresh,
   current_run_sequence=w.current_run_sequence+1,assigned_user_id=p_assigned_user,
   field_status='ASSIGNED',assignment_received_at=null,started_at=null,
   field_completed_at=null,pending_assignee_user_id=null,reassignment_requested_at=null,
   instructions=nullif(btrim(p_instructions),''),due_date=p_due_date
 where id=p_wo;
 select id into fresh_assignment from public.work_order_assignments
    where run_id=fresh and assigned_user_id=p_assigned_user
      and assignment_ended_at is null;
 if fresh_assignment is null then
   fresh_assignment:=gen_random_uuid();
   insert into public.work_order_assignments(id,run_id,organization_id,
     assigned_user_id,assignment_started_at)
   values(fresh_assignment,fresh,org,p_assigned_user,clock_timestamp());
 end if;
 insert into private.correction_obligations(id,organization_id,work_order_id,
   origin_run_id,replacement_run_id,kind,reason,prior_photo_ids,item_mapping,
   capture_requirements,release_requirements,release_revision,actor_id)
 values(new_obligation,org,p_wo,p_cancelled_run,fresh,obl.kind,btrim(p_reason),
   obl.prior_photo_ids,obl.item_mapping,obl.capture_requirements,
   obl.release_requirements,obl.release_revision,auth.uid());
 update private.correction_obligations set status='SUPERSEDED',
   superseded_by=new_obligation where id=obl.id;
 result:=jsonb_build_object('work_order_id',p_wo,'run_id',fresh,
   'assignment_instance_id',fresh_assignment,'run_sequence',w.current_run_sequence+1,
   'status','ASSIGNED','superseded_obligation_id',obl.id,
   'new_obligation_id',new_obligation);
 insert into private.followup_management_actions(
   action_id,organization_id,work_order_id,actor_id,operation,original_run_id,fingerprint,result)
 values(p_action,org,p_wo,auth.uid(),'REPLACE_CANCELLED',p_cancelled_run,fingerprint,result);
 return result;
end;$replace$;
create function public.admin_replace_cancelled_followup(
 p_action uuid,p_wo uuid,p_cancelled_run uuid,p_expected_updated_at timestamptz,
 p_reason text,p_assigned_user uuid,p_due_date date,p_instructions text
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_replace_cancelled_followup(p_action,p_wo,p_cancelled_run,
   p_expected_updated_at,p_reason,p_assigned_user,p_due_date,p_instructions)
$$;
revoke all on function private.admin_followup_management_state(uuid),public.admin_followup_management_state(uuid),
 private.admin_cancel_untouched_followup(uuid,uuid,uuid,timestamptz,text),
 public.admin_cancel_untouched_followup(uuid,uuid,uuid,timestamptz,text),
 private.admin_replace_cancelled_followup(uuid,uuid,uuid,timestamptz,text,uuid,date,text),
 public.admin_replace_cancelled_followup(uuid,uuid,uuid,timestamptz,text,uuid,date,text)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_followup_management_state(uuid),public.admin_followup_management_state(uuid),
 private.admin_cancel_untouched_followup(uuid,uuid,uuid,timestamptz,text),
 public.admin_cancel_untouched_followup(uuid,uuid,uuid,timestamptz,text),
 private.admin_replace_cancelled_followup(uuid,uuid,uuid,timestamptz,text,uuid,date,text),
 public.admin_replace_cancelled_followup(uuid,uuid,uuid,timestamptz,text,uuid,date,text)
 to authenticated,service_role;
