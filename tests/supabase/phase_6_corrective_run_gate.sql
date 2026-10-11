-- Synthetic native PostgreSQL Phase 6B protected follow-up transaction; rolled back.
begin;
do $gate$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 admin_id uuid:='00000000-0000-0000-0000-000000000010';
 photographer uuid:='00000000-0000-0000-0000-000000000011';
 company uuid:=gen_random_uuid(); wo uuid; oldrun uuid; newrun uuid;
 oldinstance uuid; newinstance uuid; oldrev timestamptz; action uuid:=gen_random_uuid();
 cfg jsonb; m jsonb:='[]'::jsonb; response jsonb; replay jsonb; denied boolean;
 start_time text:=to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 end_time text:=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 set_id uuid:=gen_random_uuid(); digest text:=encode(sha256(convert_to('[]','UTF8')),'hex');
 old_snapshot jsonb; old_number text; old_company uuid;
 claims_admin text; claims_contractor text; revision uuid;
begin
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
  'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 claims_admin:=jsonb_build_object('sub',admin_id,'session_id',admin_id,
   'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text;
 claims_contractor:=jsonb_build_object('sub',photographer,'session_id',photographer,
   'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text;
 insert into private.client_companies(id,organization_id,name)
 values(company,org,'SYNTHETIC-CORRECTIVE-CLIENT');
 perform set_config('request.jwt.claims',claims_admin,true);
 execute 'set local role authenticated';
 select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(
   false,'CORRECT-'||gen_random_uuid(),'Synthetic correction address',
   'INSPECTION','Initial task',current_date,photographer,cfg) j;
 select current_run_id,review_policy_revision into oldrun,revision
 from public.work_orders where id=wo;
 perform public.admin_assign_client_company(gen_random_uuid(),wo,company,revision);
 select id into oldinstance from public.work_order_assignments
  where run_id=oldrun and assignment_ended_at is null;
 select (requirement_snapshot->>'revision')::uuid into revision
  from public.work_order_runs where id=oldrun;
 perform set_config('request.jwt.claims',claims_contractor,true);
 if public.accept_field_action_v4(gen_random_uuid(),wo,oldrun,oldinstance,
    'START',start_time,revision,null,'')->>'outcome'<>'APPLIED'
 then raise exception 'Fixture Start failed';end if;
 if public.register_photo_finish_set(set_id,wo,oldrun,oldinstance,
    revision,'[]'::jsonb,digest,'[]')->>'outcome'<>'APPLIED'
 then raise exception 'Fixture finish-set failed';end if;
 if public.accept_field_action_v4(gen_random_uuid(),wo,oldrun,oldinstance,
    'COMPLETE',end_time,revision,set_id,digest)->>'outcome'<>'APPLIED'
 then raise exception 'Fixture accepted Finish failed';end if;
 perform set_config('request.jwt.claims',claims_admin,true);
 select updated_at,wo_number,client_company_id,release_requirement_snapshot into
 oldrev,old_number,old_company,old_snapshot from public.work_orders where id=wo;
 denied:=false;
 begin perform public.admin_create_followup(gen_random_uuid(),wo,oldrun,oldrev,
   'CLIENT_RETURN','Synthetic wrong kind',array[]::uuid[],photographer,
   current_date,'New work',cfg,m,null);
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Undelivered package classified as return';end if;
 response:=public.admin_create_followup(action,wo,oldrun,oldrev,
   'INTERNAL_CORRECTION','New inspection required',array[]::uuid[],photographer,
   current_date,'Take follow-up photos',cfg,m,null);
 replay:=public.admin_create_followup(action,wo,oldrun,oldrev,
   'INTERNAL_CORRECTION','New inspection required',array[]::uuid[],photographer,
   current_date,'Take follow-up photos',cfg,m,null);
 if response is distinct from replay then raise exception 'Retry created different correction';end if;
 newrun:=(response->>'run_id')::uuid;
 newinstance:=(response->>'assignment_instance_id')::uuid;
 -- Server-private correction ledgers are not directly readable by office clients.
 execute 'reset role';
 if newrun=oldrun or newinstance=oldinstance
 or (select current_run_id from public.work_orders where id=wo)<>newrun
 or (select current_run_sequence from public.work_orders where id=wo)<>2
 or (select field_status from public.work_orders where id=wo)<>'ASSIGNED'
 or (select client_company_id from public.work_orders where id=wo)<>old_company
 or (select wo_number from public.work_orders where id=wo)<>old_number
 or (select release_requirement_snapshot from public.work_orders where id=wo)
    is distinct from (select requirement_snapshot from public.work_order_runs where id=oldrun)
 or (select field_status from public.work_order_runs where id=oldrun)<>'FIELD_COMPLETE'
 or (select count(*) from public.field_actions where work_order_id=wo and run_id=oldrun
   and action_kind='COMPLETE')<>1
 or (select count(*) from private.correction_obligations where work_order_id=wo)<>1
 or (select count(*) from public.work_order_assignments where id=newinstance
   and assignment_received_at is null and acknowledgment_received_at is null)<>1
 then raise exception 'Correction identity/history/new fresh assignment mismatch';end if;
 execute 'set local role authenticated';
 denied:=false;
 begin perform public.admin_create_followup(action,wo,oldrun,oldrev,
   'INTERNAL_CORRECTION','Changed action replay',array[]::uuid[],photographer,
   current_date,'Take follow-up photos',cfg,m,null);
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Changed correction action reused';end if;
 denied:=false;
 begin perform public.admin_create_followup(gen_random_uuid(),wo,oldrun,oldrev,
   'INTERNAL_CORRECTION','Another correction',array[]::uuid[],photographer,
   current_date,'Take follow-up photos',cfg,m,null);
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Second open correction created';end if;
 perform set_config('request.jwt.claims',claims_contractor,true);
 denied:=false;
 begin perform public.admin_create_followup(gen_random_uuid(),wo,newrun,
   (select updated_at from public.work_orders where id=wo),
   'INTERNAL_CORRECTION','Contractor forged correction',array[]::uuid[],
   photographer,current_date,'Wrong',cfg,m,null);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor could dispatch correction';end if;
 execute 'reset role';
 if has_table_privilege('authenticated','private.correction_obligations','UPDATE')
 or has_function_privilege('anon',
 'public.admin_create_followup(uuid,uuid,uuid,timestamptz,text,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb)','EXECUTE')
 then raise exception 'Unscoped correction write';end if;
 raise notice 'Phase 6B same-WO correction and isolated new-run PASS';
end;
$gate$;
rollback;
