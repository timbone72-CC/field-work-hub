-- Disposable Phase 5C review transaction. No hosted storage bytes, dashboard access or Send.
begin;
create function pg_temp.review_fixture_photo(p_admin uuid,p_org uuid,p_team uuid,p_actor uuid)
returns uuid language plpgsql as $fixture$
declare wo uuid; run uuid; instance uuid; rev uuid; set_id uuid:=gen_random_uuid(); photo uuid:=gen_random_uuid();
  cfg jsonb; photos jsonb; digest text; result jsonb; company uuid:=gen_random_uuid(); client_revision uuid;
begin
  cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_admin,'session_id',p_admin,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',p_org))::text,true);
  select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(false,'REVIEW-'||photo,'TEST','TEST','',current_date,p_actor,cfg) j;
  update public.work_orders set responsible_team_id=p_team where id=wo;
  insert into private.client_companies(id,organization_id,name)
    values(company,p_org,'FIXTURE REVIEW CLIENT '||company::text);
  select review_policy_revision into client_revision from public.work_orders where id=wo;
  perform public.admin_assign_client_company(gen_random_uuid(),wo,company,client_revision);
  select current_run_id into run from public.work_orders where id=wo;
  select id into instance from public.work_order_assignments where run_id=run and assignment_ended_at is null;
  select (requirement_snapshot->>'revision')::uuid into rev from public.work_order_runs where id=run;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'session_id',p_actor,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',p_org))::text,true);
  result:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'START',
    to_char(now()-interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),rev,null,'');
  if result->>'outcome'<>'APPLIED' then raise exception 'Fixture Start failed: %',result;end if;
  photos:=jsonb_build_array(jsonb_build_object('id',photo,'item_id',null,
    'captured_at',to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  digest:=encode(sha256(convert_to(photos::text,'UTF8')),'hex');
  result:=public.register_photo_finish_set(set_id,wo,run,instance,rev,photos,digest,photos::text);
  if result->>'outcome'<>'APPLIED' then raise exception 'Fixture photo set failed: %',result;end if;
  result:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'COMPLETE',
    to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),rev,set_id,digest);
  if result->>'outcome'<>'APPLIED' then raise exception 'Fixture Finish failed: %',result;end if;
  return photo;
end;
$fixture$;
create function pg_temp.expect_photo_review_error(p_state text,p_statement text)
returns void language plpgsql as $expect$
declare caught boolean:=false;
begin
  begin execute p_statement;exception when others then
    if sqlstate<>p_state then raise exception 'Expected %, got %: %',p_state,sqlstate,sqlerrm;end if;
    caught:=true;
  end;
  if not caught then raise exception 'Unexpected success: %',p_statement;end if;
end;
$expect$;
do $gate$
declare
  org uuid:=gen_random_uuid(); team uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid();
  other_admin uuid:=gen_random_uuid(); contractor uuid:=gen_random_uuid();
  actor uuid; photo uuid; wo uuid; object_id uuid:=gen_random_uuid();
  register jsonb; gallery jsonb; response jsonb; replay jsonb; target jsonb; expected_revision uuid; action uuid:=gen_random_uuid();
  pkg_draft jsonb; pkg_preview jsonb; pkg_approval jsonb; pkg_send jsonb; pkg_state jsonb;
  pkg_id uuid; send_action uuid:=gen_random_uuid(); company uuid;
  delivery_worker uuid:=gen_random_uuid(); delivery_claim jsonb; delivery_done jsonb;
  delivery_gen bigint; folder_id text; photo_file_id text; manifest_file_id text; frozen_size bigint;
  t private.photo_transfers%rowtype; denied boolean;
begin
  insert into public.organizations(id,name) values(org,'PHOTO REVIEW TEST');
  insert into public.admin_teams(id,organization_id,name) values(team,org,'REVIEW');
  foreach actor in array array[admin_id,other_admin,contractor] loop
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(actor,'review@example.invalid',now(),
      jsonb_build_object('organization_id',org,'role',case when actor=contractor then 'CONTRACTOR' else 'ADMIN' end));
    insert into auth.sessions(id,user_id) values(actor,actor);
    insert into private.account_work_access(organization_id,user_id,work_role,active)
      values(org,actor,case when actor=contractor then 'CONTRACTOR' else 'ADMIN' end,true);
  end loop;
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(org,team,admin_id,true);
  insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values(org,team,contractor,true);
  photo:=pg_temp.review_fixture_photo(admin_id,org,team,contractor);
  select work_order_id into wo from public.photos where id=photo;

  -- Accepted Finish or registered metadata by itself is never gallery evidence.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  execute 'set local role authenticated';
  gallery:=public.admin_list_private_review_photos(wo);
  if jsonb_array_length(gallery->'photos')<>0 then raise exception 'Unverified photo appeared in gallery';end if;
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  execute 'set local role authenticated';
  register:=public.begin_photo_transfer(gen_random_uuid(),photo,repeat('a',64),250000);
  execute 'reset role';
  select * into t from private.photo_transfers where photo_id=photo;
  -- Synthetic catalog/ledger entries are not physical private JPEG bytes.
  insert into storage.objects(id,bucket_id,name,owner_id,version)
    values(object_id,t.bucket,t.object_key,contractor::text,'REVIEW-TEST-V1');
  insert into private.photo_transfer_receipts(action_id,photo_id,transfer_version,
    owner_user_id,owner_session_id,object_id,object_version,bucket,object_key,observed_sha256,observed_size)
  values(gen_random_uuid(),photo,t.version,contractor,contractor,object_id,'REVIEW-TEST-V1',
    t.bucket,t.object_key,repeat('a',64),250000);
  update private.photo_transfers set state='RECEIVED' where photo_id=photo;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  execute 'set local role authenticated';
  gallery:=public.admin_list_private_review_photos(wo);
  if jsonb_array_length(gallery->'photos')<>1 or gallery->'photos'->0->>'photo_id'<>photo::text
    or gallery->'photos'->0->>'decision'<>'PENDING' or gallery ? 'object_key'
    or gallery->'photos'->0 ? 'object_key' or gallery->'photos'->0 ? 'url'
    or gallery->>'next_photo' is not null then
    raise exception 'Exact private gallery omitted receipt, leaked object URL or fabricated review: %',gallery;end if;
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_list_private_review_photos(%L,10)',wo));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_list_private_review_photos(%L,null)',wo));
  perform pg_temp.expect_photo_review_error('22023',format(
    'select public.admin_review_photo(%L,%L,%L,%L,null,null,%L)',
    gen_random_uuid(),wo,photo,t.version,''));
  perform pg_temp.expect_photo_review_error('22023',format(
    'select public.admin_review_photo(%L,%L,%L,%L,null,%L,%L)',
    gen_random_uuid(),wo,photo,t.version,'REJECTED',''));
  perform pg_temp.expect_photo_review_error('22023',format(
    'select public.admin_review_photo(%L,%L,%L,%L,null,%L,%L)',
    gen_random_uuid(),wo,photo,gen_random_uuid(),'APPROVED',''));
  response:=public.admin_review_photo(action,wo,photo,t.version,null,'APPROVED','');
  replay:=public.admin_review_photo(action,wo,photo,t.version,null,'APPROVED','');
  if response<>replay or response->>'decision'<>'APPROVED' then raise exception 'Review replay changed evidence';end if;

  -- Controlled-only provider declaration; NO real Drive, real photos or live Send.
  execute 'reset role';
  select client_company_id into company from public.work_orders where id=wo;
  insert into private.client_delivery_destinations(organization_id,company_id,provider,
    provider_identity,root_folder_id,verified,verified_at,verification_receipt,active)
  values(org,company,'GOOGLE_DRIVE','sandbox@example.invalid','DISPOSABLE-ONLY',
    true,now(),jsonb_build_object('synthetic_test',true),true);
  insert into private.client_delivery_runtime(organization_id,worker_ready) values(org,false);
  execute 'set local role authenticated';
  pkg_draft:=public.admin_save_package_draft(gen_random_uuid(),wo,null,'Synthetic client description',array[photo]);
  pkg_id:=(pkg_draft->>'id')::uuid;
  if pkg_draft->>'status'<>'DRAFT' then raise exception 'Draft save did not remain unsent';end if;
  pkg_state:=public.admin_package_state(wo);
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_approve_package(%L,%L,%L,%L,%L)',
    gen_random_uuid(),wo,pkg_id,pkg_draft->>'revision',pkg_state->'package'->>'manifest_sha256'));
  pkg_preview:=public.admin_preview_package(wo,pkg_id,(pkg_draft->>'revision')::uuid);
  if pkg_preview->'manifest'->>'client_wo_number' is null
    or jsonb_array_length(pkg_preview->'manifest'->'selected_photos')<>1 then
    raise exception 'Exact preview missed WO, selected receipt or content';end if;
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.admin_approve_package(%L,%L,%L,%L,%L)',
    gen_random_uuid(),wo,pkg_id,pkg_draft->>'revision',repeat('0',64)));
  pkg_approval:=public.admin_approve_package(gen_random_uuid(),wo,pkg_id,
    (pkg_draft->>'revision')::uuid,pkg_preview->>'manifest_sha256');
  if pkg_approval->>'status'<>'APPROVED' then raise exception 'Preview approval not persisted';end if;
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_queue_package(%L,%L,%L,%L,%L)',
    send_action,wo,pkg_id,pkg_approval->>'revision',pkg_preview->>'manifest_sha256'));
  pkg_state:=public.admin_package_state(wo);
  if pkg_state->'package'->>'can_send' is distinct from 'false' then
    raise exception 'Unavailable worker incorrectly showed Send as ready';end if;
  execute 'reset role';
  if exists(select 1 from private.client_delivery_outbox where package_id=pkg_id) then
    raise exception 'Unavailable worker incorrectly queued delivery';end if;
  update private.client_delivery_runtime set worker_ready=true,worker_identity='synthetic-ci-only',
    last_verified_at=now() where organization_id=org;
  execute 'set local role authenticated';
  pkg_state:=public.admin_package_state(wo);
  if pkg_state->'package'->>'can_send'<>'true' then
    raise exception 'Verified synthetic worker readiness not reflected';end if;
  pkg_send:=public.admin_queue_package(send_action,wo,pkg_id,
    (pkg_approval->>'revision')::uuid,pkg_preview->>'manifest_sha256');
  if pkg_send->>'status'<>'QUEUED' then raise exception 'Explicit Send did not queue';end if;
  if pkg_send is distinct from public.admin_queue_package(send_action,wo,pkg_id,
      (pkg_approval->>'revision')::uuid,pkg_preview->>'manifest_sha256') then
    raise exception 'Duplicate Send was not idempotent';end if;
  perform pg_temp.expect_photo_review_error('22023',format(
    'select public.admin_queue_package(%L,%L,%L,%L,%L)',
    send_action,wo,pkg_id,pkg_approval->>'revision',repeat('0',64)));
  execute 'reset role';
  if (select count(*) from private.client_delivery_outbox where package_id=pkg_id)<>1
    or (select status from private.client_packages where id=pkg_id)<>'QUEUED'
    or (select count(*) from private.client_package_actions where package_id=pkg_id
        and action_kind='SEND')<>1 then
    raise exception 'Send created duplicates or alleged delivered receipt';end if;
  -- The browser role cannot claim a trusted delivery attempt.
  execute 'set local role authenticated';
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_claim_delivery(%L)',gen_random_uuid()));
  execute 'reset role';
  execute 'set local role service_role';
  delivery_claim:=public.service_claim_delivery(delivery_worker);
  if delivery_claim->>'claimed'<>'true' or
    (delivery_claim->>'package_id')::uuid<>pkg_id then
    raise exception 'Single trusted claim not fenced';end if;
  delivery_gen:=(delivery_claim->>'generation')::bigint;
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_heartbeat_delivery(%L,%L,%s)',
    pkg_id,gen_random_uuid(),delivery_gen));
  if (public.service_claim_delivery(gen_random_uuid())->>'claimed')<>'false' then
    raise exception 'Leased delivery was claimed twice';end if;
  folder_id:='folder'||replace(pkg_id::text,'-','');
  photo_file_id:='photo'||replace(photo::text,'-','');
  manifest_file_id:='manifest'||replace(pkg_id::text,'-','');
  perform public.service_reserve_delivery_file(pkg_id,delivery_worker,delivery_gen,
    'FOLDER',null,folder_id,'DISPOSABLE-ONLY');
  perform public.service_reserve_delivery_file(pkg_id,delivery_worker,delivery_gen,
    'PHOTO',photo,photo_file_id,folder_id);
  perform public.service_reserve_delivery_file(pkg_id,delivery_worker,delivery_gen,
    'MANIFEST',null,manifest_file_id,folder_id);
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_reserve_delivery_file(%L,%L,%s,%L,%L,%L,%L)',
    pkg_id,delivery_worker,delivery_gen,'PHOTO',photo,'OTHER-GENERATED-ID',folder_id));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_confirm_delivery_file(%L,%L,%s,%L,%L,%L,%L,%L,%L,%s)',
    pkg_id,delivery_worker,delivery_gen,'PHOTO',photo,photo_file_id,folder_id,
    'image/jpeg',repeat('0',64),250000));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_finish_delivery(%L,%L,%s)',
    pkg_id,delivery_worker,delivery_gen));
  perform public.service_confirm_delivery_file(pkg_id,delivery_worker,delivery_gen,
    'FOLDER',null,folder_id,'DISPOSABLE-ONLY','application/vnd.google-apps.folder',null,null);
  perform public.service_confirm_delivery_file(pkg_id,delivery_worker,delivery_gen,
    'PHOTO',photo,photo_file_id,folder_id,'image/jpeg',repeat('a',64),250000);
  frozen_size:=octet_length((delivery_claim->'manifest')::text);
  perform public.service_confirm_delivery_file(pkg_id,delivery_worker,delivery_gen,
    'MANIFEST',null,manifest_file_id,folder_id,'application/json',
    pkg_preview->>'manifest_sha256',frozen_size);
  delivery_done:=public.service_finish_delivery(pkg_id,delivery_worker,delivery_gen);
  if delivery_done->>'status'<>'DELIVERED'
    or (select count(*) from private.client_delivery_final_receipts where package_id=pkg_id)<>1
    or (select count(*) from private.client_delivery_file_plans where package_id=pkg_id and state='VERIFIED')<>3 then
    raise exception 'Synthetic delivery evidence did not finalize exactly once';end if;
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_finish_delivery(%L,%L,%s)',pkg_id,delivery_worker,delivery_gen));
  execute 'reset role';
  if has_function_privilege('authenticated','public.service_claim_delivery(uuid)','execute')
    or has_function_privilege('anon','public.service_finish_delivery(uuid,uuid,bigint)','execute')
    or has_table_privilege('authenticated','private.client_delivery_final_receipts','select') then
    raise exception 'Client could read or claim trusted delivery evidence';end if;
  execute 'set local role authenticated';
  expected_revision:=(response->>'decision_revision')::uuid;
  perform pg_temp.expect_photo_review_error('22023',format(
    'select public.admin_review_photo(%L,%L,%L,%L,null,%L,%L)',
    action,wo,photo,t.version,'REJECTED','different payload'));
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.admin_review_photo(%L,%L,%L,%L,null,%L,%L)',
    gen_random_uuid(),wo,photo,t.version,'REJECTED','Missing side'));
  response:=public.admin_review_photo(gen_random_uuid(),wo,photo,t.version,expected_revision,'REJECTED','Missing side');
  gallery:=public.admin_list_private_review_photos(wo);
  if gallery->'photos'->0->>'decision'<>'REJECTED' then raise exception 'Gallery decision not persisted';end if;
  perform pg_temp.expect_photo_review_error('42501',format(
    'update private.photo_review_actions set decision=%L where action_id=%L','APPROVED',action));
  execute 'reset role';
  if response->>'decision'<>'REJECTED' or (select count(*) from private.photo_review_actions where photo_id=photo)<>2
    or (select reason from private.photo_review_decisions where photo_id=photo)<>'Missing side' then
    raise exception 'Review revision, reason or immutable audit was lost';end if;
  target:=public.admin_private_photo_target_for_session(photo,t.version,admin_id,admin_id);
  if target->>'photo_id'<>photo::text or target->>'bucket'<>'fwh-review-private'
    or target->>'object_key'<>t.object_key then raise exception 'Trusted viewer object identity changed';end if;
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_private_photo_target_for_session(%L,%L,%L,%L)',
    photo,t.version,other_admin,other_admin));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_private_photo_target_for_session(%L,%L,%L,%L)',
    photo,t.version,admin_id,gen_random_uuid()));

  -- Same-organization role alone does not grant a gallery or review capability.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_admin,'session_id',other_admin,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  execute 'set local role authenticated';
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_list_private_review_photos(%L)',wo));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_review_photo(%L,%L,%L,%L,null,%L,%L)',
    gen_random_uuid(),wo,photo,t.version,'APPROVED',''));
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  execute 'set local role authenticated';
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_list_private_review_photos(%L)',wo));
  execute 'reset role';

  update private.account_work_access set active=false,suspension_authority='OWNER',
    suspension_reason='TEST',disabled_at=now() where user_id=admin_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  execute 'set local role authenticated';
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_list_private_review_photos(%L)',wo));
  execute 'reset role';

  if has_table_privilege('authenticated','private.photo_review_actions','select')
    or has_table_privilege('authenticated','private.photo_review_decisions','update')
    or has_function_privilege('anon','public.admin_review_photo(uuid,uuid,uuid,uuid,uuid,text,text)','execute')
    or has_function_privilege('authenticated','public.admin_private_photo_target_for_session(uuid,uuid,uuid,uuid)','execute')
    or (select count(*) from private.photo_transfer_receipts where photo_id=photo)<>1
    or (select count(*) from public.photos where id=photo and sync_status='WAITING')<>1 then
    raise exception 'Review broadened grants or altered protected receipt/field photos';end if;
  raise notice 'Phase 5C scoped verified-photo gallery, revision-safe decisions, immutable audit and wrong-role denial PASS';
end;
$gate$;
rollback;
