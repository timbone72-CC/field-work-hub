-- Rolled-back synthetic photo metadata only. Never upload fixture image bytes.
begin;
set local timezone='UTC';
do $gate$
declare
 admin_id uuid; a uuid; b uuid; org uuid; wo uuid; run uuid; instance uuid; wo2 uuid; run2 uuid; instance2 uuid;
 start_id uuid:=gen_random_uuid(); finish_id uuid:=gen_random_uuid(); set_id uuid:=gen_random_uuid();
 during_id uuid:=gen_random_uuid(); wide_id uuid:=gen_random_uuid(); revision uuid; old_revision uuid;
 cfg jsonb; off_cfg jsonb; photos jsonb; missing jsonb; r jsonb; saved jsonb; t jsonb;
 claims_a text; claims_b text; claims_admin text; denied boolean; item jsonb; n integer; bad integer;
 start_time text:=to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 photo_time text:=to_char(now()-interval '30 seconds','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 finish_time text:=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
begin
 select id,(raw_app_meta_data->>'organization_id')::uuid into admin_id,org from auth.users where raw_app_meta_data->>'role'='ADMIN' and deleted_at is null order by created_at limit 1;
 select id into a from auth.users where private.is_assignable_contractor(id,org) order by created_at,id limit 1;
 select id into b from auth.users where private.is_assignable_contractor(id,org) and id<>a order by created_at,id limit 1;
 if a is null or b is null or admin_id is null then raise exception 'Existing test actors required'; end if;
 claims_admin:=jsonb_build_object('sub',admin_id,'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text;
 claims_a:=jsonb_build_object('sub',a,'role','authenticated','app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text;
 claims_b:=jsonb_build_object('sub',b,'role','authenticated','app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text;
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',true,'minimum',5),'items',jsonb_build_array(
 jsonb_build_object('id',during_id,'label','During','enabled',true,'minimum',2,'instruction','Test instruction','stage','DURING','framing','NORMAL','order',1),
 jsonb_build_object('id',wide_id,'label','Front wide','enabled',true,'minimum',2,'instruction','','stage','NONE','framing','WIDE','order',0)));
 off_cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 if has_function_privilege('authenticated','private.accept_field_action_legacy_v3(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
 or has_table_privilege('authenticated','public.photo_finish_sets','INSERT')
 or has_table_privilege('authenticated','public.photo_templates','UPDATE')
 or has_function_privilege('anon','public.register_photo_finish_set(uuid,uuid,uuid,uuid,uuid,jsonb,text,text)','EXECUTE') then raise exception 'Broad phase 4 grants'; end if;
 perform set_config('request.jwt.claims',claims_admin,true);execute 'set local role authenticated';
 select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(false,'FWH-P4-'||gen_random_uuid(),'FWH TEST','TEST','',current_date,a,cfg) j;
 select current_run_id into run from public.work_orders where id=wo;
 select id into instance from public.work_order_assignments where run_id=run and assignment_ended_at is null;
 select (j->'requirement_snapshot'->>'revision')::uuid into old_revision from public.field_assignments() j where j->>'id'=wo::text;
 r:=public.admin_set_photo_requirements(wo,old_revision,jsonb_set(cfg,'{total,minimum}','6'));
 revision:=(r->>'revision')::uuid;
 denied:=false;begin perform public.admin_set_photo_requirements(wo,old_revision,cfg);exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale requirement edit accepted';end if;
 r:=public.admin_set_photo_requirements(wo,revision,cfg);revision:=(r->>'revision')::uuid;
 t:=public.admin_save_photo_template(gen_random_uuid(),'TEST TEMPLATE','TEST',cfg,true,true,null);
 saved:=public.admin_save_photo_template((t->>'id')::uuid,'TEST TEMPLATE RENAMED','TEST',off_cfg,false,false,(t->>'revision')::uuid);
 if saved->>'active'<>'false' then raise exception 'Template archive failed';end if;
 if not exists(select 1 from public.field_assignments() j where j->>'id'=wo::text and (j->'requirement_snapshot'->>'revision')::uuid=revision) then raise exception 'Template edit altered run';end if;
 perform set_config('request.jwt.claims',claims_a,true);
 r:=public.accept_field_action_v4(start_id,wo,run,instance,'START',start_time,old_revision,null,'');
 if r->>'reason'<>'REQUIREMENTS_CHANGED' then raise exception 'Stale offline Start accepted';end if;
 r:=public.accept_field_action(gen_random_uuid(),wo,run,instance,'START',start_time);
 if r->>'reason'<>'UPDATE_REQUIRED' then raise exception 'Old action bypassed requirements';end if;
 denied:=false;begin perform public.start_work(wo);exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Legacy Start bypassed revision';end if;
 r:=public.accept_field_action_v4(start_id,wo,run,instance,'START',start_time,revision,null,'');
 if r->>'outcome'<>'APPLIED' then raise exception 'Configured Start failed: %',r;end if;
 if public.accept_field_action_v4(start_id,wo,run,instance,'START',start_time,revision,null,'')<>r then raise exception 'Start replay changed';end if;
 perform set_config('request.jwt.claims',claims_admin,true);
 denied:=false;begin perform public.admin_set_photo_requirements(wo,revision,off_cfg);exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Started snapshot changed';end if;
 perform set_config('request.jwt.claims',claims_a,true);
 denied:=false;begin perform public.complete_field_work(wo);exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Legacy Finish bypass';end if;
 r:=public.accept_field_action_v4(finish_id,wo,run,instance,'COMPLETE',finish_time,revision,null,'');
 if r->>'reason'<>'PHOTO_SET_REQUIRED' then raise exception 'Completion before metadata';end if;
 photos:='[]'::jsonb;
 for n in 1..5 loop photos:=photos||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'item_id',case when n<=2 then during_id when n<=4 then wide_id else null end,'captured_at',photo_time));end loop;
 missing:=photos-4;
 r:=public.register_photo_finish_set(set_id,wo,run,instance,revision,missing,encode(sha256(convert_to(missing::text,'UTF8')),'hex'),missing::text);
 if r->>'reason'<>'PHOTO_REQUIREMENTS_UNMET' then raise exception 'Total not enforced';end if;
 missing:=jsonb_set(photos,'{0,item_id}',to_jsonb(wide_id::text));
 r:=public.register_photo_finish_set(set_id,wo,run,instance,revision,missing,encode(sha256(convert_to(missing::text,'UTF8')),'hex'),missing::text);
 if r->>'reason'<>'PHOTO_REQUIREMENTS_UNMET' then raise exception 'One photo credited to multiple items';end if;
 missing:=jsonb_set(photos,'{4,id}',photos->0->'id');
 r:=public.register_photo_finish_set(set_id,wo,run,instance,revision,missing,encode(sha256(convert_to(missing::text,'UTF8')),'hex'),missing::text);
 if r->>'reason'<>'INVALID_PHOTO_METADATA' then raise exception 'Duplicate UUID counted';end if;
 perform set_config('request.jwt.claims',claims_b,true);
 r:=public.register_photo_finish_set(set_id,wo,run,instance,revision,photos,repeat('0',64),photos::text);
 if r->>'reason'<>'PHOTO_SET_DIGEST_MISMATCH' then raise exception 'Bad metadata digest accepted';end if;
 r:=public.register_photo_finish_set(set_id,wo,run,instance,revision,photos,encode(sha256(convert_to(photos::text,'UTF8')),'hex'),photos::text);
 if r->>'reason'<>'ASSIGNMENT_UNAVAILABLE' then raise exception 'Wrong actor registered';end if;
 perform set_config('request.jwt.claims',claims_a,true);
 denied:=false;begin insert into public.photos(id,work_order_id,run_id,captured_by,captured_at) values(gen_random_uuid(),wo,run,a,now());exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Direct photo insert bypassed frozen set';end if;
 r:=public.register_photo_finish_set(set_id,wo,run,instance,revision,photos,encode(sha256(convert_to(photos::text,'UTF8')),'hex'),photos::text);
 if r->>'outcome'<>'APPLIED' then raise exception 'Valid metadata rejected: %',r;end if;
 if public.register_photo_finish_set(set_id,wo,run,instance,revision,photos,encode(sha256(convert_to(photos::text,'UTF8')),'hex'),photos::text)->>'outcome'<>'ALREADY_APPLIED' then raise exception 'Metadata replay duplicate';end if;
 if public.register_photo_finish_set(set_id,wo,run,instance,revision,missing,encode(sha256(convert_to(missing::text,'UTF8')),'hex'),missing::text)->>'reason'<>'PHOTO_SET_PAYLOAD_MISMATCH' then raise exception 'Frozen payload altered';end if;
 r:=public.accept_field_action_v4(finish_id,wo,run,instance,'COMPLETE',finish_time,revision,set_id,encode(sha256(convert_to(photos::text,'UTF8')),'hex'));
 if r->>'outcome'<>'APPLIED' then raise exception 'Validated Finish rejected: %',r;end if;
 if public.accept_field_action_v4(finish_id,wo,run,instance,'COMPLETE',finish_time,revision,set_id,encode(sha256(convert_to(photos::text,'UTF8')),'hex'))<>r then raise exception 'Finish replay changed';end if;
 if public.accept_field_action_v4(finish_id,wo,run,instance,'COMPLETE',finish_time,revision,gen_random_uuid(),encode(sha256(convert_to(photos::text,'UTF8')),'hex'))->>'reason'<>'ACTION_PAYLOAD_MISMATCH' then raise exception 'Finish payload changed';end if;
 if (select count(*) from public.photos where finish_set_id=set_id)<>5 or exists(select 1 from public.photos where finish_set_id=set_id and (sync_status<>'WAITING' or remote_file_id is not null or uploaded_at is not null)) then raise exception 'Capture metadata claimed delivery';end if;
 -- All-off remains configured, requiring revision and a stable empty Finish set.
 perform set_config('request.jwt.claims',claims_admin,true);
 select (j->>'work_order_id')::uuid into wo2 from public.admin_create_work_order_v4(false,'FWH-P4-OFF-'||gen_random_uuid(),'FWH TEST','TEST','',current_date,a,off_cfg) j;
 select current_run_id into run2 from public.work_orders where id=wo2;
 select id into instance2 from public.work_order_assignments where run_id=run2 and assignment_ended_at is null;
 select (j->'requirement_snapshot'->>'revision')::uuid into revision from public.field_assignments() j where j->>'id'=wo2::text;
 perform set_config('request.jwt.claims',claims_a,true);
 r:=public.accept_field_action_v4(gen_random_uuid(),wo2,run2,instance2,'START',start_time,revision,null,'');
 if r->>'outcome'<>'APPLIED' then raise exception 'All-off Start failed';end if;
 set_id:=gen_random_uuid();r:=public.register_photo_finish_set(set_id,wo2,run2,instance2,revision,'[]',encode(sha256(convert_to('[]'::text,'UTF8')),'hex'),'[]'::text);
 if r->>'outcome'<>'APPLIED' then raise exception 'All-off empty set failed';end if;
 r:=public.accept_field_action_v4(gen_random_uuid(),wo2,run2,instance2,'COMPLETE',finish_time,revision,set_id,encode(sha256(convert_to('[]','UTF8')),'hex'));
 if r->>'outcome'<>'APPLIED' then raise exception 'All-off Finish failed';end if;
 execute 'reset role';
 -- Validator matrix, including redundant smaller Total and unsupported schema.
 perform private.validate_photo_requirements(jsonb_set(cfg,'{total,minimum}','1'));
 for bad in 1..5 loop
 denied:=false;
 begin
 perform private.validate_photo_requirements(case bad when 1 then jsonb_set(cfg,'{schema}','2') when 2 then jsonb_set(cfg,'{items,0,minimum}','0')
 when 3 then jsonb_set(cfg,'{items,1,id}',cfg->'items'->0->'id') when 4 then jsonb_set(cfg,'{items,0,minimum}','1.5') else cfg||'{"walking_required":true}' end);
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Malformed requirements accepted: %',bad;end if;
 end loop;
end; $gate$;
rollback;
