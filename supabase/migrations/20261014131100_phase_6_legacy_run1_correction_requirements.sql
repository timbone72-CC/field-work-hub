-- Phase 6C approved legacy Run 1 read compatibility, not an evidence backfill.
-- Preserve completed legacy '{}' Run 1 snapshots and existing photo actions.
-- Stop on any unexpected installed source/authority drift.
do $preflight$
declare p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid='private.admin_correction_basis(uuid)'::regprocedure;
 if p.oid is null or md5(p.prosrc)<>'72fb67b7296dab77ce634442284eee33'
   or p.proowner<>'postgres'::regrole or not p.prosecdef
   or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
   or p.proacl is distinct from
      '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
 then raise exception 'Run 1 legacy correction: unexpected authority/source drift';end if;
end;
$preflight$;

CREATE OR REPLACE FUNCTION private.admin_correction_basis(p_wo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare w public.work_orders%rowtype; oldrun public.work_order_runs%rowtype;
    req jsonb; kind text; refs jsonb;
begin
 if p_wo is null or not private.current_identity_valid()
   or not private.can_work_order(p_wo)
   or private.phase4_admin_org() is null
 then raise exception 'Current scoped office work required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo;
 if w.id is null or w.field_status<>'FIELD_COMPLETE'
    or w.client_company_id is null or w.responsible_team_id is null
 then raise exception 'Current completed client work required' using errcode='PT409';end if;
 select * into oldrun from public.work_order_runs
    where id=w.current_run_id and work_order_id=w.id;
 if oldrun.id is null or oldrun.field_status<>'FIELD_COMPLETE'
   or oldrun.field_completed_at is null or
   not exists(select 1 from public.field_actions a where a.run_id=oldrun.id
      and a.work_order_id=w.id and a.action_kind='COMPLETE')
 then raise exception 'Accepted Finish required before correction' using errcode='PT409';end if;
 if exists(select 1 from public.photos p where p.work_order_id=w.id
    and p.run_id=w.current_run_id and not exists(
       select 1 from private.photo_transfers t
       join private.photo_transfer_receipts r
         on r.photo_id=t.photo_id and r.transfer_version=t.version
       where t.photo_id=p.id and t.run_id=p.run_id and t.state='RECEIVED'))
 then raise exception 'Private photo transfers still pending' using errcode='PT409';end if;
 if exists(select 1 from private.client_packages k where k.work_order_id=w.id
   and k.status in ('QUEUED','DELIVERING','FAILED','UNCERTAIN'))
 then raise exception 'Unresolved client delivery blocks correction' using errcode='PT409';end if;
 -- Original Run 1 '{}' is an explicit historic migration/backfill state,
 -- not a photo rule the Admin can edit. For exactly this old snapshot, use
 -- the already persisted validated release backfill on the same WO.
 -- Non-empty malformed/foreign snapshots still fail validation; do not
 -- rewrite the completed run, accepted Finish or historical photo minima.
 req:=case
    when w.current_run_sequence=1 and oldrun.requirement_snapshot='{}'::jsonb
      then w.release_requirement_snapshot
    when w.current_run_sequence=1 then oldrun.requirement_snapshot
    else w.release_requirement_snapshot end;
 perform private.validate_photo_requirements(req);
 kind:=case when exists(select 1 from private.client_packages k
    where k.work_order_id=w.id and k.status='DELIVERED')
    then 'CLIENT_RETURN' else 'INTERNAL_CORRECTION' end;
 return jsonb_build_object('work_order_id',w.id,'client_wo_number',w.wo_number,
   'client_company_id',w.client_company_id,'work_type',w.work_type,
   'origin_run_id',w.current_run_id,'expected_wo_updated_at',w.updated_at,
   'kind',kind,'release_requirements',req,'release_revision',w.release_requirement_revision,
   'current_assignee',w.assigned_user_id,'current_due_date',w.due_date);
end;$function$;

do $postflight$
declare p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid='private.admin_correction_basis(uuid)'::regprocedure;
 if p.oid is null or p.proowner<>'postgres'::regrole or not p.prosecdef
   or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
   or p.proacl is distinct from
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
   or position('oldrun.requirement_snapshot=''{}''::jsonb' in p.prosrc)=0
   or position('private.validate_photo_requirements(req)' in p.prosrc)=0
   or position('private.can_work_order(p_wo)' in p.prosrc)=0
 then raise exception 'Run 1 correction source or protected authorization changed';end if;
end;
$postflight$;

-- Preserve exactly the same legacy baseline in the read and dispatch paths.
-- Do not relax validated requirements, customer identity or photo protections.
do $followup_preflight$
declare p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid=
 'private.admin_create_followup(uuid,uuid,uuid,timestamp with time zone,text,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb)'::regprocedure;
 if p.oid is null or md5(p.prosrc)<>'b3d7f1f48229a3c38ac4d71ca2fcd5b4'
 or p.proowner<>'postgres'::regrole or not p.prosecdef
 or p.proconfig is distinct from array['search_path=""','lock_timeout=5s']
 or p.proacl is distinct from
   '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
 then raise exception 'Legacy run correction dispatch source/ACL drift';end if;
end;
$followup_preflight$;

CREATE OR REPLACE FUNCTION private.admin_create_followup(p_action uuid, p_wo uuid, p_expected_run uuid, p_expected_updated_at timestamp with time zone, p_kind text, p_reason text, p_reference_photos uuid[], p_assigned_user uuid, p_due_date date, p_instructions text, p_capture_requirements jsonb, p_item_mapping jsonb, p_release_requirements jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
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
   if oldrun.requirement_snapshot='{}'::jsonb then
     -- Historic Run 1 is immutable. Use only same-WO validated backfill.
     perform private.validate_photo_requirements(w.release_requirement_snapshot);
     newgoal:=coalesce(p_release_requirements,w.release_requirement_snapshot);
     perform private.validate_correction_mapping(
       p_capture_requirements,w.release_requirement_snapshot,newgoal,p_item_mapping);
   else
     newgoal:=coalesce(p_release_requirements,oldrun.requirement_snapshot);
     perform private.validate_correction_mapping(
       p_capture_requirements,oldrun.requirement_snapshot,newgoal,p_item_mapping);
   end if;
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
end;$function$;

do $followup_postflight$
declare p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid=
 'private.admin_create_followup(uuid,uuid,uuid,timestamp with time zone,text,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb)'::regprocedure;
 if p.oid is null or p.proowner<>'postgres'::regrole or not p.prosecdef
 or p.proconfig is distinct from array['search_path=""','lock_timeout=5s']
 or p.proacl is distinct from
 '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
 or position('oldrun.requirement_snapshot=''{}''::jsonb' in p.prosrc)=0
 or position('private.validate_correction_mapping(' in p.prosrc)=0
 or position('private.can_work_order(p_wo)' in p.prosrc)=0
 then raise exception 'Legacy run followup dispatch protected state drift';end if;
end;
$followup_postflight$;
