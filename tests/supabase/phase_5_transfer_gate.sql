-- Synthetic rollback-only content observations, not real JPEG/Storage verification.
begin;
set local timezone='UTC';
create function pg_temp.recovery_fixture_photo(p_admin uuid,p_org uuid,p_team uuid,p_actor uuid,p_complete boolean)
returns uuid language plpgsql as $$
declare wo uuid; run uuid; instance uuid; rev uuid; set_id uuid:=gen_random_uuid(); photo uuid:=gen_random_uuid();
  cfg jsonb; photos jsonb; digest text; result jsonb;
begin
  cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_admin,'session_id',p_admin,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',p_org))::text,true);
  select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(false,'RECOVERY-'||photo,'TEST','TEST','',current_date,p_actor,cfg) j;
  update public.work_orders set responsible_team_id=p_team where id=wo;
  select current_run_id into run from public.work_orders where id=wo;
  select id into instance from public.work_order_assignments where run_id=run and assignment_ended_at is null;
  select (requirement_snapshot->>'revision')::uuid into rev from public.work_order_runs where id=run;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'session_id',p_actor,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',p_org))::text,true);
  result:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'START',to_char(now()-interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),rev,null,'');
  if result->>'outcome'<>'APPLIED' then raise exception 'Fixture Start failed: %',result;end if;
  photos:=jsonb_build_array(jsonb_build_object('id',photo,'item_id',null,'captured_at',to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  digest:=encode(sha256(convert_to(photos::text,'UTF8')),'hex');
  result:=public.register_photo_finish_set(set_id,wo,run,instance,rev,photos,digest,photos::text);
  if result->>'outcome'<>'APPLIED' then raise exception 'Fixture metadata failed: %',result;end if;
  if p_complete then
    result:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'COMPLETE',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),rev,set_id,digest);
    if result->>'outcome'<>'APPLIED' then raise exception 'Fixture Finish failed: %',result;end if;
  end if;
  return photo;
end;
$$;
do $gate$
declare
  org uuid:=gen_random_uuid(); team uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); contractor uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid();
  p1 uuid; p2 uuid; unfinished uuid; other_photo uuid; action uuid:=gen_random_uuid(); recovery_action uuid:=gen_random_uuid(); receipt_action uuid:=gen_random_uuid();
  object_id uuid:=gen_random_uuid(); alias_action uuid:=gen_random_uuid(); actor uuid; access_rev uuid; response jsonb; prior jsonb;
  t private.photo_transfers%rowtype; t2 private.photo_transfers%rowtype; fs public.photo_finish_sets%rowtype;
  denied boolean;
begin
  insert into public.organizations(id,name) values(org,'TRANSFER TEST');
  insert into public.admin_teams(id,organization_id,name) values(team,org,'TEST');
  foreach actor in array array[admin_id,contractor,other_user] loop
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(actor,'fixture@example.invalid',now(),
      jsonb_build_object('organization_id',org,'role',case when actor=admin_id then 'ADMIN' else 'CONTRACTOR' end));
    insert into auth.sessions(id,user_id) values(actor,actor);
    insert into private.account_work_access(organization_id,user_id,work_role,active)
      values(org,actor,case when actor=admin_id then 'ADMIN' else 'CONTRACTOR' end,true);
  end loop;
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(org,team,admin_id,true);
  insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values(org,team,contractor,true),(org,team,other_user,true);
  p1:=pg_temp.recovery_fixture_photo(admin_id,org,team,contractor,true);
  p2:=pg_temp.recovery_fixture_photo(admin_id,org,team,contractor,true);
  unfinished:=pg_temp.recovery_fixture_photo(admin_id,org,team,contractor,false);
  other_photo:=pg_temp.recovery_fixture_photo(admin_id,org,team,other_user,true);
  -- Original bytes are deliberately different from the expected prepared JPEG.
  update public.photos set sha256=repeat('a',64),byte_size=8000000 where id=p1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor)::text,true);
  execute 'set local role authenticated';
  denied:=false;
  begin perform public.begin_photo_transfer(gen_random_uuid(),unfinished,repeat('b',64),250000);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unaccepted metadata became transfer eligible';end if;
  denied:=false;
  begin perform public.begin_photo_transfer(gen_random_uuid(),other_photo,repeat('b',64),250000);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Other capturing owner became transfer eligible';end if;
  response:=public.begin_photo_transfer(action,p1,repeat('b',64),250000);
  if response->>'state'<>'WAITING' or (response->>'prepared_size')::bigint<>250000 or response->>'prepared_sha256'<>repeat('b',64)
    or response->>'bucket'<>'fwh-review-private' then raise exception 'Prepared registration fabricated receipt or used original bytes';end if;
  if public.begin_photo_transfer(action,p1,repeat('b',64),250000)<>response then raise exception 'Begin retry changed prior result';end if;
  prior:=public.begin_photo_transfer(gen_random_uuid(),p1,repeat('b',64),250000);
  if prior->>'transfer_version'<>response->>'transfer_version' then raise exception 'Same content created another transfer';end if;
  denied:=false;
  begin perform public.begin_photo_transfer(action,p1,repeat('c',64),250000);exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Changed begin action allowed';end if;
  denied:=false;
  begin perform public.begin_photo_transfer(gen_random_uuid(),p1,repeat('c',64),250000);exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'New action replaced prepared bytes';end if;
  denied:=false;
  begin perform public.begin_photo_transfer(gen_random_uuid(),p1,repeat('b',64),0);exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Empty prepared content allowed';end if;
  execute 'reset role';
  select * into t from private.photo_transfers where photo_id=p1;
  if t.object_key<>org::text||'/'||t.work_order_id::text||'/'||t.run_id::text||'/'||p1::text||'.jpg'
    or (select count(*) from private.photo_transfers where photo_id=p1)<>1 then raise exception 'Object identity not deterministic/unique';end if;
  execute 'set local role authenticated';
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Client asserted trusted receipt';end if;
  execute 'reset role';
  -- Revocation alone without a fixed READY grant cannot upload/reconcile.
  update private.account_work_access set active=false,suspension_authority='OWNER',suspension_reason='TEST',disabled_at=now() where user_id=contractor;
  denied:=false;
  begin perform public.begin_photo_transfer(action,p1,repeat('b',64),250000);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Disabled work replay bypassed recovery grant';end if;
  update private.account_work_access set active=true,suspension_authority=null,suspension_reason=null,disabled_at=null where user_id=contractor;
  select revision into access_rev from private.account_work_access where user_id=contractor;
  perform private.freeze_photo_recovery_scope(recovery_action,org,contractor,access_rev,'{}','TEST');
  perform private.complete_photo_recovery_grant(recovery_action);
  -- Acceptance after cutoff cannot be retroactively uploaded in recovery mode.
  select f.* into fs from public.photo_finish_sets f join public.photos p on p.finish_set_id=f.id where p.id=unfinished;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  response:=public.accept_field_action_v4(gen_random_uuid(),fs.work_order_id,fs.run_id,fs.assignment_instance_id,'COMPLETE',
    to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),fs.requirement_revision,fs.id,fs.digest);
  if response->>'outcome'<>'APPLIED' then raise exception 'Fixture late Finish failed';end if;
  update private.account_work_access set active=false,suspension_authority='OWNER',suspension_reason='TEST',disabled_at=now(),revision=gen_random_uuid() where user_id=contractor;
  execute 'set local role authenticated';
  response:=public.begin_photo_transfer(action,p1,repeat('b',64),250000);
  prior:=public.begin_photo_transfer(gen_random_uuid(),p2,repeat('c',64),300000);
  if prior->>'state'<>'WAITING' then raise exception 'First post-disable expected binding claimed receipt';end if;
  denied:=false;
  begin perform public.begin_photo_transfer(gen_random_uuid(),unfinished,repeat('d',64),100000);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Post-cutoff Finish created recovery upload authority';end if;
  execute 'reset role';
  -- Exact authenticated status is the only authority for replacing an uncertain TUS session.
  execute 'set local role authenticated';
  response:=public.photo_transfer_status(p1,t.version);
  if response->>'state'<>'ABSENT' or response ? 'object_key' then
    raise exception 'Exact transfer status did not prove clean absence narrowly';end if;
  denied:=false;
  begin perform public.photo_transfer_status(p1,gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Wrong transfer version received status';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'session_id',other_user)::text,true);
  denied:=false;
  begin perform public.photo_transfer_status(p1,t.version);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Other owner received transfer status';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor)::text,true);
  execute 'reset role';

  -- Controlled catalog/RLS only, never proof of physical object bytes.
  execute 'set local role authenticated';
  insert into storage.objects(id,bucket_id,name,owner_id,version) values(object_id,t.bucket,t.object_key,contractor::text,'TEST-V1');
  if (select count(*) from storage.objects where id=object_id)<>1 then raise exception 'Exact waiting original-owner catalog not visible';end if;
  response:=public.photo_transfer_status(p1,t.version);
  if response->>'state'<>'PRESENT' or response ? 'object_key' or response ? 'object_id' then
    raise exception 'Exact present status exposed catalog details or missed object';end if;
  denied:=false;
  begin insert into storage.objects(bucket_id,name,owner_id,version) values(t.bucket,'wrong/path.jpg',contractor::text,'TEST');
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Wrong-path direct Storage insert allowed';end if;
  denied:=false;
  begin insert into storage.objects(bucket_id,name,owner_id,version) values(t.bucket,t.object_key||'/wrong',other_user::text,'TEST');
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Wrong-owner direct Storage insert allowed';end if;
  denied:=false;
  begin update storage.objects set version='CLIENT-OVERWRITE' where id=object_id;
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Direct Storage overwrite allowed';end if;
  execute 'reset role';
  execute 'set local role service_role';
  denied:=false;
  begin perform public.photo_object_verification_target(p1,t.version);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unbound latest-session verification target remained exposed';end if;
  prior:=public.photo_verification_target_for_session(p1,t.version,contractor,contractor);
  if prior->>'object_id'<>object_id::text or prior->>'owner_session_id'<>contractor::text or prior->>'state'<>'WAITING' then
    raise exception 'Exact request-bound target missing';end if;
  execute 'reset role';
  update storage.objects set version='REPLACED' where id=object_id;
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000);
    exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Replaced catalog version confirmed';end if;
  update storage.objects set version='TEST-V1',archived_at=now() where id=object_id;
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000);
    exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Archived object confirmed';end if;
  update storage.objects set archived_at=null,is_delete_marker=true where id=object_id;
  denied:=false;
  begin perform public.photo_verification_target_for_session(p1,t.version,contractor,contractor);
    exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Deleted object target returned';end if;
  update storage.objects set is_delete_marker=false,owner_id=other_user::text where id=object_id;
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000);
    exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Wrong catalog owner confirmed';end if;
  update storage.objects set owner_id=contractor::text where id=object_id;
  if exists(select 1 from private.photo_transfer_receipts where photo_id=p1) then raise exception 'Rejected catalog checks created receipt';end if;
  execute 'set local role service_role';
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('a',64),8000000);
    exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Original-byte observations accepted as prepared receipt';end if;
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,'wrong/path.jpg',repeat('b',64),250000);
    exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Wrong object path confirmed';end if;
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,gen_random_uuid(),contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000);
    exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Wrong transfer revision confirmed';end if;
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,t.version,other_user,other_user,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Wrong owner/session confirmed';end if;
  response:=public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000);
  if response->>'state'<>'RECEIVED' or public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000)<>response
    or public.confirm_photo_transfer(alias_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000)<>response then
    raise exception 'Trusted receipt replay duplicated/changed original receipt';end if;
  select * into t2 from private.photo_transfers where photo_id=p2;
  denied:=false;
  begin perform public.confirm_photo_transfer(alias_action,p2,t2.version,contractor,contractor,gen_random_uuid(),'TEST-V1',t2.bucket,t2.object_key,repeat('c',64),300000);
    exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Alias receipt action rebound to another photo';end if;
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,gen_random_uuid(),'TEST-V2',t.bucket,t.object_key,repeat('b',64),250000);
    exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Receipt action replaced observed object';end if;
  execute 'reset role';
  if (select state from private.photo_transfers where photo_id=p1)<>'RECEIVED' or (select count(*) from private.photo_transfer_receipts where photo_id=p1)<>1 then
    raise exception 'Receipt transition not atomic/unique';end if;
  execute 'set local role authenticated';
  if exists(select 1 from storage.objects where id=object_id) then raise exception 'Received catalog remained directly visible';end if;
  response:=public.photo_transfer_status(p1,t.version);
  if response->>'state'<>'RECEIVED' or response->>'receipt_id'<>receipt_action::text
    or response ? 'object_key' or response ? 'object_id' then
    raise exception 'Received transfer status did not return the immutable narrow receipt';end if;
  execute 'reset role';
  response:=public.photo_verification_target_for_session(p1,t.version,contractor,contractor);
  if response->>'state'<>'RECEIVED' or response->>'receipt_id'<>receipt_action::text or response ? 'object_key' then
    raise exception 'Historical receipt replay broadened access';end if;
  insert into auth.sessions(id,user_id) values(gen_random_uuid(),contractor);
  update auth.sessions set not_after=now() where id=contractor;
  denied:=false;
  begin perform public.photo_verification_target_for_session(p1,t.version,contractor,contractor);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Expired incoming session substituted another valid session';end if;
  denied:=false;
  begin perform public.confirm_photo_transfer(receipt_action,p1,t.version,contractor,contractor,object_id,'TEST-V1',t.bucket,t.object_key,repeat('b',64),250000);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Expired original session replayed receipt';end if;
  update auth.sessions set not_after=null where id=contractor;
  update auth.users set banned_until=now()+interval '1 day' where id=contractor;
  denied:=false;
  begin perform public.begin_photo_transfer(action,p1,repeat('b',64),250000);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Security-locked identity resumed transfer';end if;
  update auth.users set banned_until=null where id=contractor;
  denied:=false;
  begin update private.photo_transfers set prepared_sha256=repeat('d',64) where photo_id=p1;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Prepared identity changed';end if;
  denied:=false;
  begin update private.photo_transfers set state='RECEIVED' where photo_id=p2;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Missing receipt bypassed state guard';end if;
  denied:=false;
  begin update private.photo_transfer_receipts set object_version='TEST-V2' where photo_id=p1;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Trusted receipt overwritten';end if;
  if has_table_privilege('authenticated','private.photo_transfers','select') or has_table_privilege('service_role','private.photo_transfer_receipts','insert')
    or has_function_privilege('authenticated','private.photo_transfer_authorized_for_user(uuid,uuid,uuid)','execute')
    or has_function_privilege('service_role','private.confirm_photo_transfer_engine(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint)','execute')
    or has_function_privilege('authenticated','public.photo_verification_target_for_session(uuid,uuid,uuid,uuid)','execute') then raise exception 'Broad direct transfer privileges';end if;
  if exists(select 1 from public.photos where id in (p1,p2,unfinished,other_photo) and (sync_status<>'WAITING' or remote_file_id is not null or uploaded_at is not null))
    or (select sha256 from public.photos where id=p1)<>repeat('a',64) or (select byte_size from public.photos where id=p1)<>8000000 then
    raise exception 'Private receipt fabricated client delivery or rewrote original facts';end if;
  raise notice 'Phase 5 immutable prepared identity, original-owner recovery transfer and service-only receipt ledger PASS';
end;
$gate$;
rollback;
