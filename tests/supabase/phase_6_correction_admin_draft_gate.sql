-- Phase 6C: disposable Admin correction drafting, save CAS, required preview,
-- deliberate dispatch, identity/replay, denial and immutable previous Finish.
begin;
do $gate$
declare org uuid:='00000000-0000-0000-0000-000000000001';
 office uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011';
 company uuid:=gen_random_uuid(); wo uuid; oldrun uuid; newrun uuid;
 oldinstance uuid; jobtime timestamptz; policyrev uuid; runrev uuid;
 config jsonb; map jsonb:='[]'::jsonb; state jsonb; saved jsonb; preview jsonb;
 dispatched jsonb; repeat jsonb; draftrev uuid; previewhash text;
 adminjwt text; workerjwt text; action uuid:=gen_random_uuid(); denied boolean;
 start_time text:=to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 finish_time text:=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 finish_id uuid:=gen_random_uuid(); digest text:=encode(sha256(convert_to('[]','UTF8')),'hex');
begin
 config:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
  'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 adminjwt:=jsonb_build_object('sub',office,'session_id',office,
  'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text;
 workerjwt:=jsonb_build_object('sub',contractor,'session_id',contractor,
  'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text;
 insert into private.client_companies(id,organization_id,name)
 values(company,org,'SYNTHETIC CORRECTION ADMIN');
 perform set_config('request.jwt.claims',adminjwt,true);execute 'set local role authenticated';
 select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(false,
  'DRAFT-'||gen_random_uuid(),'Synthetic correction review','INSPECT',
  'Original work',current_date,contractor,config) j;
 select current_run_id,review_policy_revision into oldrun,policyrev
   from public.work_orders where id=wo;
 perform public.admin_assign_client_company(gen_random_uuid(),wo,company,policyrev);
 select id into oldinstance from public.work_order_assignments
    where run_id=oldrun and assignment_ended_at is null;
 select (requirement_snapshot->>'revision')::uuid into runrev
    from public.work_order_runs where id=oldrun;
 -- An unfinished job is not offered a persisted correction.
 denied:=false;
 begin perform public.admin_correction_state(wo);
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Unfinished job offered correction';end if;
 perform set_config('request.jwt.claims',workerjwt,true);
 if public.accept_field_action_v4(gen_random_uuid(),wo,oldrun,oldinstance,
    'START',start_time,runrev,null,'')->>'outcome'<>'APPLIED'
 then raise exception 'Old job start fixture failed';end if;
 if public.register_photo_finish_set(finish_id,wo,oldrun,oldinstance,runrev,
    '[]'::jsonb,digest,'[]')->>'outcome'<>'APPLIED'
 then raise exception 'Old job empty finished photo set failed';end if;
 if public.accept_field_action_v4(gen_random_uuid(),wo,oldrun,oldinstance,
    'COMPLETE',finish_time,runrev,finish_id,digest)->>'outcome'<>'APPLIED'
 then raise exception 'Old job Finish failed';end if;
 perform set_config('request.jwt.claims',adminjwt,true);
 state:=public.admin_correction_state(wo);
 if state->>'kind'<>'INTERNAL_CORRECTION' or state->'draft'<>'null'::jsonb
   or state->>'origin_run_id'<>oldrun::text then
   raise exception 'Wrong server correction facts: %',state;end if;
 jobtime:=(state->>'expected_wo_updated_at')::timestamptz;
 saved:=public.admin_save_correction_draft(wo,oldrun,jobtime,null,
  'Take updated exterior photos','{}'::uuid[],contractor,current_date,
  'Follow-up review',config,map,config);
 draftrev:=(saved->>'revision')::uuid;
 -- Compare-and-swap edits create a new revision; old preview is invalid.
 saved:=public.admin_save_correction_draft(wo,oldrun,jobtime,draftrev,
  'Take updated exterior photos','{}'::uuid[],contractor,current_date,
  'Follow-up review',config,map,config);
 if (saved->>'revision')::uuid=draftrev then
   raise exception 'Draft update kept stale revision';end if;
 denied:=false;
 begin perform public.admin_preview_correction_draft(wo,draftrev);
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Old saved correction revision still previewable';end if;
 draftrev:=(saved->>'revision')::uuid;
 if saved->>'status'<>'DRAFT' or
   (public.admin_correction_state(wo)->'draft'->>'reason')
    <>'Take updated exterior photos'
 then raise exception 'Saved correction draft missing';end if;
 denied:=false;
 begin perform public.admin_save_correction_draft(wo,oldrun,jobtime,null,
   'Stale no-revision overwrite','{}'::uuid[],contractor,current_date,
   'Bad',config,map,config);
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale draft overwrote saved data';end if;
 denied:=false;
 begin perform public.admin_dispatch_correction_draft(action,wo,draftrev,repeat('a',64));
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Dispatch without checked preview';end if;
 preview:=public.admin_preview_correction_draft(wo,draftrev);
 previewhash:=preview->>'preview_sha256';
 if previewhash!~'^[a-f0-9]{64}$'
   or preview->'summary'->>'origin_run_id'<>oldrun::text
   or preview->'summary'->>'reason'<>'Take updated exterior photos'
 then raise exception 'Exact correction preview mismatch';end if;
 denied:=false;
 begin perform public.admin_dispatch_correction_draft(action,wo,draftrev,repeat('a',64));
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Changed preview hash dispatched';end if;
 perform set_config('request.jwt.claims',workerjwt,true);
 denied:=false;
 begin perform public.admin_dispatch_correction_draft(action,wo,draftrev,previewhash);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor dispatched office correction';end if;
 perform set_config('request.jwt.claims',adminjwt,true);
 dispatched:=public.admin_dispatch_correction_draft(action,wo,draftrev,previewhash);
 repeat:=public.admin_dispatch_correction_draft(action,wo,draftrev,previewhash);
 denied:=false;
 begin perform public.admin_dispatch_correction_draft(action,wo,draftrev,repeat('b',64));
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Changed accepted preview hash was treated as same request';end if;
 newrun:=(dispatched->>'run_id')::uuid;
 if dispatched is distinct from repeat or newrun=oldrun
 then raise exception 'Exact idempotent correction dispatch failed';end if;
 execute 'reset role';
 if (select status from private.admin_correction_drafts where work_order_id=wo)<>'DISPATCHED'
 or (select dispatched_action_id from private.admin_correction_drafts where work_order_id=wo)<>action
 or (select dispatched_by from private.admin_correction_drafts where work_order_id=wo)<>office
 or (select count(*) from private.correction_obligations where replacement_run_id=newrun)<>1
 or (select field_status from public.work_order_runs where id=oldrun)<>'FIELD_COMPLETE'
 or (select count(*) from public.work_order_assignments where run_id=newrun
       and acknowledged_at is null and assignment_received_at is null)<>1
 then raise exception 'New run, old Finish or audit violated';end if;
 if has_table_privilege('authenticated','private.admin_correction_drafts','UPDATE')
  or has_function_privilege('anon','public.admin_dispatch_correction_draft(uuid,uuid,uuid,text)','EXECUTE')
 then raise exception 'Broad correction draft authority exposed';end if;
 -- The original follow-up remains OPEN until a verified package delivery
 -- or explicit reviewed supersession. A second field Finish must not
 -- silently erase the earlier correction's new-photo obligations.
 select id into oldinstance from public.work_order_assignments
   where run_id=newrun and assignment_ended_at is null;
 select (requirement_snapshot->>'revision')::uuid into runrev
   from public.work_order_runs where id=newrun;
 perform set_config('request.jwt.claims',workerjwt,true);
 execute 'set local role authenticated';
 if public.accept_field_action_v4(gen_random_uuid(),wo,newrun,oldinstance,
   'START',start_time,runrev,null,'')->>'outcome'<>'APPLIED'
 then raise exception 'Follow-up Start fixture failed';end if;
 finish_id:=gen_random_uuid();
 if public.register_photo_finish_set(finish_id,wo,newrun,oldinstance,runrev,
   '[]'::jsonb,digest,'[]')->>'outcome'<>'APPLIED'
 then raise exception 'Follow-up Finish-set fixture failed';end if;
 if public.accept_field_action_v4(gen_random_uuid(),wo,newrun,oldinstance,
   'COMPLETE',finish_time,runrev,finish_id,digest)->>'outcome'<>'APPLIED'
 then raise exception 'Follow-up Finish fixture failed';end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',adminjwt,true);execute 'set local role authenticated';
 select updated_at into jobtime from public.work_orders where id=wo;
 denied:=false;
 begin perform public.admin_create_followup(gen_random_uuid(),wo,newrun,jobtime,
   'INTERNAL_CORRECTION','Silently replace unfinished correction',array[]::uuid[],
   contractor,current_date,'Wrong replacement',config,map,config);
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Unresolved prior correction superseded without review';end if;
 execute 'reset role';
 if (select count(*) from public.work_order_runs where work_order_id=wo)<>2
 then raise exception 'Blocked supersession created extra run';end if;
 raise notice 'Phase 6C controlled server draft, preview and exact Dispatch PASS';
end;$gate$;
rollback;
