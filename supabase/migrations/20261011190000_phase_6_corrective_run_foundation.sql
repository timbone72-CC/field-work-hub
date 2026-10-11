-- Phase 6B+6D governed source candidate. No hosted Team deployment.
-- Historical Run/Finish/photo and client-provider receipt identities are immutable.
alter table public.work_orders
 add column release_requirement_snapshot jsonb,
 add column release_requirement_revision uuid not null default gen_random_uuid();
update public.work_orders w set release_requirement_snapshot =
  case when r.requirement_snapshot='{}'::jsonb then
   jsonb_build_object('schema',1,'revision',gen_random_uuid(),
    'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb)
  else r.requirement_snapshot end
from public.work_order_runs r where r.id=w.current_run_id;
alter table public.work_orders alter column release_requirement_snapshot set not null;
alter table public.work_orders add constraint wo_release_snapshot_object_chk
 check(jsonb_typeof(release_requirement_snapshot)='object');
-- Later initial WO inserts acquire their own canonical Run 1 goal snapshot.
create function private.initial_release_snapshot() returns trigger language plpgsql
security definer set search_path='' as $$
begin
 if new.release_requirement_snapshot is null then
   new.release_requirement_snapshot:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
   'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 end if;
 return new;
end;$$;
create trigger work_orders_initial_release before insert on public.work_orders
for each row execute function private.initial_release_snapshot();
revoke all on function private.initial_release_snapshot() from public,anon,authenticated;

-- A frozen approved-but-unsent draft is superseded, never erased or sent by a later click.
alter table private.client_packages drop constraint client_packages_status_check;
alter table private.client_packages add constraint client_packages_status_check
 check(status in ('DRAFT','APPROVED','SUPERSEDED','QUEUED','DELIVERING',
                  'FAILED','UNCERTAIN','DELIVERED'));
create table private.correction_obligations(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 origin_run_id uuid not null,
 replacement_run_id uuid not null unique,
 kind text not null check(kind in ('INTERNAL_CORRECTION','CLIENT_RETURN')),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 prior_photo_ids uuid[] not null default '{}',
 item_mapping jsonb not null check(jsonb_typeof(item_mapping)='array'),
 capture_requirements jsonb not null check(jsonb_typeof(capture_requirements)='object'),
 release_requirements jsonb not null check(jsonb_typeof(release_requirements)='object'),
 release_revision uuid not null,
 status text not null default 'OPEN' check(status in ('OPEN','SATISFIED','SUPERSEDED')),
 superseded_by uuid references private.correction_obligations(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(origin_run_id,work_order_id) references public.work_order_runs(id,work_order_id) on delete restrict,
 foreign key(replacement_run_id,work_order_id) references public.work_order_runs(id,work_order_id) on delete restrict,
 check(origin_run_id<>replacement_run_id)
);
create index correction_obligations_wo_idx on private.correction_obligations(work_order_id,status);
create table private.correction_followup_actions(
 action_id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create trigger correction_followup_actions_immutable
 before update or delete on private.correction_followup_actions
 for each row execute function private.protect_photo_transfer_ledger();
alter table private.correction_obligations enable row level security;
alter table private.correction_followup_actions enable row level security;
revoke all on private.correction_obligations,private.correction_followup_actions
 from public,anon,authenticated,service_role;
grant select on private.correction_obligations,private.correction_followup_actions to service_role;

-- Accept explicit release-item IDs; text labels never map photos to goals.
-- Existing enabled release requirements cannot be relaxed or removed.
create function private.validate_correction_mapping(
 p_capture jsonb,p_release_prior jsonb,p_release_next jsonb,p_mapping jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; prior_item jsonb; pair jsonb; target uuid;
begin
 perform private.validate_photo_requirements(p_capture);
 perform private.validate_photo_requirements(p_release_prior);
 perform private.validate_photo_requirements(p_release_next);
 if jsonb_typeof(p_mapping) is distinct from 'array'
  or jsonb_array_length(p_mapping)<>jsonb_array_length(p_capture->'items')
 then raise exception 'Every capture item needs one explicit release goal or Extra' using errcode='22023';end if;
 if (p_release_prior->'total'->>'enabled')::boolean
   and (not (p_release_next->'total'->>'enabled')::boolean
    or (p_release_next->'total'->>'minimum')::int <
       (p_release_prior->'total'->>'minimum')::int)
 then raise exception 'Original total release goal cannot be relaxed' using errcode='22023';end if;
 for prior_item in select value from jsonb_array_elements(p_release_prior->'items') loop
  if (prior_item->>'enabled')::boolean and not exists(
   select 1 from jsonb_array_elements(p_release_next->'items') j
    where j->>'id'=prior_item->>'id' and (j->>'enabled')::boolean
      and (j->>'minimum')::int >= (prior_item->>'minimum')::int)
  then raise exception 'Original named release goal cannot be relaxed' using errcode='22023';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_mapping) m
   where jsonb_typeof(m.value)<>'object'
     or (select count(*) from jsonb_object_keys(m.value))<>2
     or not (m.value ? 'capture_item_id' and m.value ? 'release_item_id')
     or jsonb_typeof(m.value->'capture_item_id')<>'string'
     or jsonb_typeof(m.value->'release_item_id') not in ('string','null'))
 then raise exception 'Invalid explicit correction item mapping' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_mapping) m
    group by m.value->>'capture_item_id' having count(*)<>1)
 then raise exception 'Duplicate capture item mapping' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_capture->'items') loop
  select m.value into pair from jsonb_array_elements(p_mapping) m
   where m.value->>'capture_item_id'=item->>'id';
  if pair is null then raise exception 'Missing capture item mapping' using errcode='22023';end if;
  if jsonb_typeof(pair->'release_item_id')='string' then
   target:=(pair->>'release_item_id')::uuid;
   if not exists(select 1 from jsonb_array_elements(p_release_next->'items') g
     where (g->>'id')::uuid=target and (g->>'enabled')::boolean)
   then raise exception 'Unknown release goal UUID' using errcode='22023';end if;
  end if;
 end loop;
end;$$;
revoke all on function private.validate_correction_mapping(jsonb,jsonb,jsonb,jsonb)
 from public,anon,authenticated;
grant execute on function private.validate_correction_mapping(jsonb,jsonb,jsonb,jsonb)
 to authenticated,service_role;

-- The only new-run mutation. Once admitted, a single WO lock makes the new
-- identity, exact fresh assignment, old package supersession, mapping and audit atomic.
create function private.admin_create_followup(
 p_action uuid,p_wo uuid,p_expected_run uuid,p_expected_updated_at timestamptz,
 p_kind text,p_reason text,p_reference_photos uuid[],
 p_assigned_user uuid,p_due_date date,p_instructions text,
 p_capture_requirements jsonb,p_item_mapping jsonb,p_release_requirements jsonb
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $followup$
declare
 w public.work_orders%rowtype; oldrun public.work_order_runs%rowtype;
 existing private.correction_followup_actions%rowtype;
 current_kind text; newrun uuid:=gen_random_uuid();
 newassign uuid:=gen_random_uuid(); newgoal jsonb;
 prior_id uuid; fingerprint text; result jsonb; org uuid;
begin
 if p_action is null or p_wo is null or p_expected_run is null
   or p_expected_updated_at is null or p_assigned_user is null or p_due_date is null
   or p_kind not in ('INTERNAL_CORRECTION','CLIENT_RETURN')
   or coalesce(length(btrim(p_reason)) between 1 and 2000,false) is false
   or coalesce(length(p_instructions)<=4000,false) is false
   or p_reference_photos is null or cardinality(p_reference_photos)>200
   or array_position(p_reference_photos,null) is not null
 then raise exception 'Explicit bounded follow-up details required' using errcode='22023';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(
   p_wo,p_expected_run,p_expected_updated_at,p_kind,p_reason,
   p_reference_photos,p_assigned_user,p_due_date,p_instructions,
   p_capture_requirements,p_item_mapping,p_release_requirements)::text,'UTF8')),'hex');
 perform private.lock_account_lifecycle();
 org:=private.phase4_admin_org();
 if not private.current_identity_valid() or not private.can_work_order(p_wo)
 then raise exception 'Scoped office correction authority required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo for update;
 select * into existing from private.correction_followup_actions where action_id=p_action;
 if existing.action_id is not null then
   if existing.actor_id is distinct from auth.uid() or
      existing.work_order_id is distinct from p_wo or
      existing.organization_id is distinct from org or
      existing.fingerprint is distinct from fingerprint
   then raise exception 'Changed follow-up action identity' using errcode='40001';end if;
   return existing.result;
 end if;
 if w.id is null or w.organization_id is distinct from org or
    w.current_run_id is distinct from p_expected_run or
    w.updated_at is distinct from p_expected_updated_at or
    w.field_status<>'FIELD_COMPLETE' or w.client_company_id is null or
    w.responsible_team_id is null
 then raise exception 'Current completed work or revision changed' using errcode='40001';end if;
 select * into oldrun from public.work_order_runs
   where id=p_expected_run and work_order_id=p_wo for update;
 if oldrun.id is null or oldrun.field_status<>'FIELD_COMPLETE'
    or oldrun.field_completed_at is null or
    oldrun.run_sequence<>w.current_run_sequence or
    not exists(select 1 from public.field_actions a where a.work_order_id=p_wo
      and a.run_id=p_expected_run and a.action_kind='COMPLETE')
 then raise exception 'Accepted completed current run required' using errcode='40001';end if;
 if exists(select 1 from public.work_order_runs r where r.work_order_id=p_wo
   and r.run_sequence>w.current_run_sequence)
 then raise exception 'Another corrective run exists' using errcode='40001';end if;
 -- A later request must explicitly supersede an unresolved correction and
 -- identify its replacement obligation. Silently stacking new runs would
 -- leave the previous required new-photo minimum enforceable without review.
 if exists(select 1 from private.correction_obligations co
    where co.work_order_id=p_wo and co.status='OPEN')
 then raise exception 'Existing correction obligation unresolved; explicit reviewed supersession is required'
   using errcode='40001';end if;
 if not private.is_assignable_contractor(p_assigned_user,org) or
    private.contractor_current_team(p_assigned_user,org) is distinct from w.responsible_team_id
 then raise exception 'Active contractor for responsible team required' using errcode='42501';end if;
 -- Older Finish-bound photos must not be stranded by advancing the current-run
 -- pointer while an original-owner private transfer is still unconfirmed.
 -- This is not client delivery; it is the private evidence-protection gate.
 if exists(select 1 from public.photos ph
   where ph.work_order_id=p_wo and ph.run_id=p_expected_run
     and not exists(select 1 from private.photo_transfers t
       join private.photo_transfer_receipts receipt
         on receipt.photo_id=t.photo_id and receipt.transfer_version=t.version
       where t.photo_id=ph.id and t.work_order_id=p_wo
         and t.run_id=p_expected_run and t.state='RECEIVED'))
 then raise exception 'Prior-run protected photos still require verified private receipts'
   using errcode='40001';end if;
 if exists(select 1 from private.client_packages k where k.work_order_id=p_wo
   and k.status in ('QUEUED','DELIVERING','FAILED','UNCERTAIN'))
 then raise exception 'Unresolved package delivery blocks follow-up' using errcode='40001';end if;
 current_kind:=case when exists(select 1 from private.client_packages k
   where k.work_order_id=p_wo and k.status='DELIVERED')
   then 'CLIENT_RETURN' else 'INTERNAL_CORRECTION' end;
 if p_kind is distinct from current_kind then
   raise exception 'Follow-up type disagrees with confirmed delivery history' using errcode='40001';end if;
 -- Run 1's frozen capture snapshot is the first client release baseline;
 -- the initial WO placeholder is not allowed to relax its actual requirements.
 -- Subsequent corrections use the already explicit revisioned release goals.
 if w.current_run_sequence=1 then
   newgoal:=coalesce(p_release_requirements,oldrun.requirement_snapshot);
   perform private.validate_correction_mapping(
     p_capture_requirements,oldrun.requirement_snapshot,newgoal,p_item_mapping);
 else
   newgoal:=coalesce(p_release_requirements,w.release_requirement_snapshot);
   perform private.validate_correction_mapping(
     p_capture_requirements,w.release_requirement_snapshot,newgoal,p_item_mapping);
 end if;
 if exists(select 1 from unnest(p_reference_photos) photo
   group by photo having count(*)>1)
 then raise exception 'Repeated reference photo' using errcode='22023';end if;
 foreach prior_id in array p_reference_photos loop
   if not exists(select 1 from public.photos ph
      join private.photo_transfers t on t.photo_id=ph.id
      join private.photo_transfer_receipts r
        on r.photo_id=t.photo_id and r.transfer_version=t.version
    where ph.id=prior_id and ph.work_order_id=p_wo
       and t.run_id=ph.run_id and t.state='RECEIVED')
      or not private.photo_has_accepted_finish(prior_id)
   then raise exception 'Reference photo must be accepted within this work order'
       using errcode='42501';end if;
 end loop;
 -- Approved-unsent historical manifests become ineligible without deletion.
 update private.client_packages set status='SUPERSEDED',revision=gen_random_uuid()
    where work_order_id=p_wo and status='APPROVED';
 insert into public.work_order_runs(
   id,work_order_id,organization_id,run_sequence,current_assignee_user_id,
   field_status,requirement_snapshot,reopen_reason)
 values(newrun,p_wo,org,w.current_run_sequence+1,p_assigned_user,
    'ASSIGNED',p_capture_requirements,btrim(p_reason));
 insert into public.work_order_assignments(id,run_id,organization_id,
   assigned_user_id,assignment_started_at)
 values(newassign,newrun,org,p_assigned_user,clock_timestamp());
 update public.work_orders set
   current_run_id=newrun,current_run_sequence=w.current_run_sequence+1,
   assigned_user_id=p_assigned_user,field_status='ASSIGNED',
   assignment_received_at=null,started_at=null,field_completed_at=null,
   pending_assignee_user_id=null,reassignment_requested_at=null,
   instructions=nullif(btrim(p_instructions),''),
   due_date=p_due_date,
   release_requirement_snapshot=newgoal,
   release_requirement_revision=gen_random_uuid()
 where id=p_wo;
 insert into private.correction_obligations(
   organization_id,work_order_id,origin_run_id,replacement_run_id,
   kind,reason,prior_photo_ids,item_mapping,capture_requirements,
   release_requirements,release_revision,actor_id)
 select org,p_wo,p_expected_run,newrun,p_kind,btrim(p_reason),
   p_reference_photos,p_item_mapping,p_capture_requirements,
   newgoal,w2.release_requirement_revision,auth.uid()
 from public.work_orders w2 where w2.id=p_wo;
 result:=jsonb_build_object('work_order_id',p_wo,'run_id',newrun,
    'run_sequence',w.current_run_sequence+1,'assignment_instance_id',newassign,
    'kind',current_kind,'status','ASSIGNED');
 insert into private.correction_followup_actions(
    action_id,organization_id,work_order_id,actor_id,fingerprint,result)
 values(p_action,org,p_wo,auth.uid(),fingerprint,result);
 return result;
end;$followup$;

create function public.admin_create_followup(
 p_action uuid,p_wo uuid,p_expected_run uuid,p_expected_updated_at timestamptz,
 p_kind text,p_reason text,p_reference_photos uuid[],
 p_assigned_user uuid,p_due_date date,p_instructions text,
 p_capture_requirements jsonb,p_item_mapping jsonb,p_release_requirements jsonb
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_create_followup(p_action,p_wo,p_expected_run,p_expected_updated_at,
  p_kind,p_reason,p_reference_photos,p_assigned_user,p_due_date,
  p_instructions,p_capture_requirements,p_item_mapping,p_release_requirements)
$$;
revoke all on function private.admin_create_followup(uuid,uuid,uuid,timestamptz,text,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb),
 public.admin_create_followup(uuid,uuid,uuid,timestamptz,text,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_create_followup(uuid,uuid,uuid,timestamptz,text,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb),
 public.admin_create_followup(uuid,uuid,uuid,timestamptz,text,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb)
 to authenticated,service_role;
