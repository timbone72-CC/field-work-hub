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
  supervisor uuid:=gen_random_uuid();
  actor uuid; photo uuid; wo uuid; object_id uuid:=gen_random_uuid();
  register jsonb; gallery jsonb; response jsonb; replay jsonb; target jsonb; expected_revision uuid; action uuid:=gen_random_uuid();
  pkg_draft jsonb; pkg_preview jsonb; pkg_approval jsonb; pkg_send jsonb; pkg_state jsonb;
  pkg_id uuid; send_action uuid:=gen_random_uuid(); company uuid;
  delivery_worker uuid:=gen_random_uuid(); delivery_claim jsonb; delivery_done jsonb; atomic_receipt jsonb;
  delivery_gen bigint; folder_id text; photo_file_id text; manifest_file_id text; frozen_size bigint;
  address_folder_id text; wo_folder_id text; address_row jsonb; wo_row jsonb; frozen_address text;
  address_map uuid; wo_map uuid; address_name text; wo_name text; address_proof jsonb; wo_proof jsonb;
  folder_plan uuid; folder_proof jsonb; folder_plan_projection jsonb;
  upload_plan uuid; encrypted_session jsonb:=jsonb_build_object('version',1,'nonce',repeat('A',16),'payload',repeat('B',160));
  trusted_plan jsonb;
  t private.photo_transfers%rowtype; denied boolean;
  pending_oldrun uuid; pending_oldrev timestamptz; pending_capture jsonb;
  issue_draft jsonb; issue_preview jsonb; issue_payload jsonb; issue_capture jsonb;
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
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(
    supervisor,'review-supervisor@example.invalid',now(),
    jsonb_build_object('organization_id',org,'role','SUPERVISOR'));
  insert into auth.sessions(id,user_id) values(supervisor,supervisor);
  insert into private.account_work_access(organization_id,user_id,work_role,active)
    values(org,supervisor,'SUPERVISOR',true);
  insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
    values(org,supervisor,1,true,admin_id,'Disposable scoped review');
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
    values(org,supervisor,team);
  insert into private.org_work_settings(organization_id,supervisor_work_ready)
    values(org,true);
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
  select w.current_run_id,w.updated_at,r.requirement_snapshot
    into pending_oldrun,pending_oldrev,pending_capture
    from public.work_orders w join public.work_order_runs r on r.id=w.current_run_id
    where w.id=wo;
  denied:=false;
  begin perform public.admin_create_followup(gen_random_uuid(),wo,
    pending_oldrun,pending_oldrev,'INTERNAL_CORRECTION',
    'Protected previous photos must finish private transfer',
    '{}'::uuid[],contractor,current_date,'Inspection again',
    pending_capture,'[]'::jsonb,null);
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Unreceived prior photos stranded by follow-up dispatch';end if;
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

  -- Supervisor review reuses the same verified private photo gallery and
  -- exact revision/action owner. Tier 1 is WORK-scoped, not an Admin role.
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisor,
    'session_id',supervisor)::text,true);
  execute 'set local role authenticated';
  gallery:=public.admin_review_photo_page(wo,25,null,null,null,null,false,null,null);
  if gallery->>'work_order_id'<>wo::text
    or jsonb_array_length(gallery->'photos')<>1
    or gallery->'photos'->0->>'photo_id'<>photo::text
    or gallery->'photos'->0->>'decision'<>'APPROVED'
  then raise exception 'Tier 1 Supervisor could not see exact verified team review';end if;
  response:=public.admin_review_photo(gen_random_uuid(),wo,photo,t.version,
    (replay->>'decision_revision')::uuid,'APPROVED','');
  if response->>'decision'<>'APPROVED'
  then raise exception 'Supervisor review did not use shared engine';end if;
  execute 'reset role';
  target:=private.admin_private_photo_target_for_session(photo,t.version,supervisor,supervisor);
  if target->>'photo_id'<>photo::text
  then raise exception 'Current scoped Supervisor image-read target denied';end if;
  delete from private.supervisor_team_scopes where user_id=supervisor and team_id=team;
  execute 'set local role authenticated';
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_review_photo_page(%L,25,null,null,null,null,false,null,null)',wo));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_review_photo(%L,%L,%L,%L,%L,%L,%L)',
    gen_random_uuid(),wo,photo,t.version,response->>'decision_revision','APPROVED',''));
  execute 'reset role';
  perform pg_temp.expect_photo_review_error('42501',format(
    'select private.admin_private_photo_target_for_session(%L,%L,%L,%L)',
    photo,t.version,supervisor,supervisor));
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
    values(org,supervisor,team);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,
    'session_id',admin_id,'app_metadata',jsonb_build_object(
    'role','ADMIN','organization_id',org))::text,true);
  execute 'set local role authenticated';

  -- Controlled-only provider declaration; NO real Drive, real photos or live Send.
  execute 'reset role';
  select client_company_id into company from public.work_orders where id=wo;
  insert into private.client_delivery_destinations(organization_id,company_id,provider,
    provider_identity,root_folder_id,verified,verified_at,verification_receipt,active)
  values(org,company,'GOOGLE_DRIVE','sandbox@example.invalid','DISPOSABLE-ONLY',
    true,now(),jsonb_build_object('synthetic_test',true,'drive_id','client-drive-fixture'),true);
  insert into private.client_delivery_runtime(organization_id,worker_ready) values(org,false);
  execute 'set local role authenticated';
  pkg_draft:=public.admin_save_package_draft(gen_random_uuid(),wo,null,'Synthetic client description',array[photo]);
  pkg_id:=(pkg_draft->>'id')::uuid;
  if pkg_draft->>'status'<>'DRAFT' then raise exception 'Draft save did not remain unsent';end if;
  -- Exact approved Preview must inherit the Admin-chosen company layout and
  -- authoritative verified geography, not a guess from the property address.
  execute 'reset role';
  insert into private.client_delivery_geography(
   organization_id,company_id,work_order_id,state_name,county_name,city_name,
   verification_source,verified_by,verified_at)
  values(org,company,wo,'Oklahoma','Beckham','Elk City',
   'disposable geography fixture',admin_id,now());
  insert into private.client_delivery_folder_layouts(
   destination_id,organization_id,company_id,layout,configured_by)
  select d.id,org,company,'STATE_COUNTY_CITY_ADDRESS',admin_id
    from private.client_delivery_destinations d
    where d.organization_id=org and d.company_id=company and d.active and d.verified;
  trusted_plan:=private.client_package_manifest(pkg_id);
  if trusted_plan->>'folder_layout'<>'STATE_COUNTY_CITY_ADDRESS'
    or trusted_plan->'geographic_path'->>'state'<>'oklahoma'
    or trusted_plan->'geographic_path'->>'county'<>'beckham'
    or trusted_plan->'geographic_path'->>'city'<>'elk city'
    or length(trusted_plan->'geographic_path'->>'state_key')<>64
    or length(trusted_plan->'geographic_path'->>'county_key')<>64
    or length(trusted_plan->'geographic_path'->>'city_key')<>64
    or trusted_plan->'geographic_path'->>'destination_id'
       is distinct from trusted_plan->>'destination_id' then
     raise exception 'Verified geographic Preview manifest identity missing';end if;
  -- Alternate Admin-selected hierarchy skips COUNTY entirely and must
  -- use a distinct path-derived CITY identity beneath STATE.
  update private.client_delivery_folder_layouts set
    layout='STATE_CITY_ADDRESS',revision=gen_random_uuid()
    where company_id=company and organization_id=org;
  folder_proof:=private.client_package_manifest(pkg_id);
  if folder_proof->>'folder_layout'<>'STATE_CITY_ADDRESS'
    or folder_proof->'geographic_path'->>'state_key'
       is distinct from trusted_plan->'geographic_path'->>'state_key'
    or folder_proof->'geographic_path'->>'city_key'
       is not distinct from trusted_plan->'geographic_path'->>'city_key'
    or folder_proof->'geographic_path'->>'layout'<>'STATE_CITY_ADDRESS' then
    raise exception 'State City snapshot did not derive its distinct city parent';
  end if;
  -- Restore the original unconfigured disposable company so the downstream
  -- legacy delivery fixture still proves existing path compatibility.
  delete from private.client_delivery_folder_layouts
   where company_id=company and organization_id=org;
  delete from private.client_delivery_geography where work_order_id=wo;
  execute 'set local role authenticated';

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
  -- New exact disposable TEST claim remains service-only and rejects
  -- this older one-photo package without consuming ANY queued work.
  -- This test complements the later two-photo/rollback-only fixture.
  execute 'set local role authenticated';
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_claim_exact_test_delivery(%L,%L,%L,%L)',
    delivery_worker,pkg_id,
    (select id from private.client_delivery_destinations
       where company_id=company and organization_id=org),'DISPOSABLE-ONLY'));
  execute 'reset role';
  execute 'set local role service_role';
  perform pg_temp.expect_photo_review_error('22023',format(
    'select public.service_claim_exact_test_delivery(null,%L,%L,%L)',
    pkg_id,(select id from private.client_delivery_destinations
      where company_id=company and organization_id=org),'DISPOSABLE-ONLY'));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_claim_exact_test_delivery(%L,%L,%L,%L)',
    delivery_worker,pkg_id,
    (select id from private.client_delivery_destinations
       where company_id=company and organization_id=org),'DISPOSABLE-ONLY'));
  if (select state from private.client_delivery_outbox where package_id=pkg_id)<>'QUEUED'
    or (select attempts from private.client_delivery_outbox where package_id=pkg_id)<>0
    or (select status from private.client_packages where id=pkg_id)<>'QUEUED'
  then raise exception 'Denied exact claim mutated the existing outbox';end if;
  execute 'reset role';
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

  -- Source-only client hierarchy reservation: immutable address group and
  -- permanent WO UUID scoped to this verified company/destination revision.
  select folder_address_snapshot into frozen_address
    from private.client_packages where id=pkg_id;
  if frozen_address is distinct from 'TEST' then
    raise exception 'Approved package did not freeze its authoritative WO address';
  end if;
  address_folder_id:='addr'||replace(pkg_id::text,'-','');
  wo_folder_id:='wofolder'||replace(wo::text,'-','');
  if public.service_read_delivery_parent(pkg_id,delivery_worker,delivery_gen,'ADDRESS')->>'exists'<>'false' then
    raise exception 'Existing address ID fabricated before reservation';end if;
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_reserve_delivery_parent(%L,%L,%s,%L,%L,%L)',
    pkg_id,delivery_worker,delivery_gen,'WORK_ORDER',wo_folder_id,address_folder_id));
  address_row:=public.service_reserve_delivery_parent(pkg_id,delivery_worker,delivery_gen,
     'ADDRESS',address_folder_id,'DISPOSABLE-ONLY');
  if public.service_read_delivery_parent(pkg_id,delivery_worker,delivery_gen,'ADDRESS')->>'remote_folder_id'
       <>address_folder_id then raise exception 'Original address ID lookup failed';end if;
  if address_row->>'state'<>'RESERVED' or address_row->>'remote_folder_id'<>address_folder_id
     or address_row->>'kind'<>'ADDRESS' then
    raise exception 'Address map reservation identity failed: %',address_row;end if;
  if address_row is distinct from public.service_reserve_delivery_parent(
       pkg_id,delivery_worker,delivery_gen,'ADDRESS',address_folder_id,'DISPOSABLE-ONLY') then
    raise exception 'Address retry replaced immutable ID';end if;
  address_map:=(address_row->>'map_id')::uuid;
  select remote_name into address_name from private.client_delivery_parent_maps
    where id=address_map;
  address_proof:=jsonb_build_object('id',address_folder_id,'parent','DISPOSABLE-ONLY',
    'name',address_name,'mime','application/vnd.google-apps.folder',
    'trashed',false,'drive_id','client-drive-fixture',
    'appProperties',jsonb_build_object('fwh_org',org::text,'fwh_company',company::text,
      'fwh_destination',(select destination_id::text from private.client_delivery_parent_maps where id=address_map),
      'fwh_kind','ADDRESS',
      'fwh_key',(select folder_key from private.client_delivery_parent_maps where id=address_map)));
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_confirm_delivery_parent(%L,%L,%s,%L,%L::jsonb)',
    pkg_id,delivery_worker,delivery_gen,address_map,address_proof::text));
  if public.service_begin_delivery_parent_create(pkg_id,delivery_worker,delivery_gen,address_map)->>'state'
       <>'MAY_CREATE' then raise exception 'First address attempt missing';end if;
  if public.service_begin_delivery_parent_create(pkg_id,delivery_worker,delivery_gen,address_map)->>'state'
       <>'VERIFY_EXISTING' then raise exception 'Repeated address attempt offered duplicate POST';end if;
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_confirm_delivery_parent(%L,%L,%s,%L,%L::jsonb)',
    pkg_id,delivery_worker,delivery_gen,address_map,
    (address_proof||jsonb_build_object('parent','other-root'))::text));
  if public.service_confirm_delivery_parent(
      pkg_id,delivery_worker,delivery_gen,address_map,address_proof)->>'state'<>'VERIFIED' then
    raise exception 'Independent address evidence was not committed';end if;
  if public.service_confirm_delivery_parent(
      pkg_id,delivery_worker,delivery_gen,address_map,address_proof)->>'replayed'<>'true' then
    raise exception 'Exact address evidence retry was not idempotent';end if;

  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_reserve_delivery_parent(%L,%L,%s,%L,%L,%L)',
    pkg_id,delivery_worker,delivery_gen,'ADDRESS','different_generated_remote_id','DISPOSABLE-ONLY'));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_reserve_delivery_parent(%L,%L,%s,%L,%L,%L)',
    pkg_id,delivery_worker,delivery_gen,'ADDRESS',address_folder_id,'WRONG-ROOT'));
  wo_row:=public.service_reserve_delivery_parent(pkg_id,delivery_worker,delivery_gen,
    'WORK_ORDER',wo_folder_id,address_folder_id);
  if public.service_read_delivery_parent(pkg_id,delivery_worker,delivery_gen,'WORK_ORDER')->>'remote_folder_id'
       <>wo_folder_id then raise exception 'Original WO folder ID lookup failed';end if;
  if wo_row->>'state'<>'RESERVED' or wo_row->>'remote_folder_id'<>wo_folder_id
    or wo_row->>'parent_remote_id'<>address_folder_id then
    raise exception 'WO map parent identity failed: %',wo_row;end if;
  if wo_row is distinct from public.service_reserve_delivery_parent(
    pkg_id,delivery_worker,delivery_gen,'WORK_ORDER',wo_folder_id,address_folder_id) then
    raise exception 'WO retry replaced immutable ID';end if;
  wo_map:=(wo_row->>'map_id')::uuid;
  select remote_name into wo_name from private.client_delivery_parent_maps
    where id=wo_map;
  wo_proof:=jsonb_build_object('id',wo_folder_id,'parent',address_folder_id,
    'name',wo_name,'mime','application/vnd.google-apps.folder',
    'trashed',false,'drive_id','client-drive-fixture',
    'appProperties',jsonb_build_object('fwh_org',org::text,'fwh_company',company::text,
      'fwh_destination',(select destination_id::text from private.client_delivery_parent_maps where id=wo_map),
      'fwh_kind','WORK_ORDER',
      'fwh_key',wo::text));
  if public.service_begin_delivery_parent_create(pkg_id,delivery_worker,delivery_gen,wo_map)->>'state'
       <>'MAY_CREATE' then raise exception 'First WO attempt missing';end if;
  if public.service_begin_delivery_parent_create(pkg_id,delivery_worker,delivery_gen,wo_map)->>'state'
       <>'VERIFY_EXISTING' then raise exception 'Repeated WO attempt would POST twice';end if;
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_confirm_delivery_parent(%L,%L,%s,%L,%L::jsonb)',
    pkg_id,delivery_worker,delivery_gen,wo_map,
    (wo_proof||jsonb_build_object('drive_id','foreign-drive'))::text));
  if public.service_confirm_delivery_parent(pkg_id,delivery_worker,delivery_gen,wo_map,wo_proof)->>'state'
       <>'VERIFIED' then raise exception 'Trusted WO folder evidence not stored';end if;

  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_reserve_delivery_parent(%L,%L,%s,%L,%L,%L)',
    pkg_id,gen_random_uuid(),delivery_gen,'WORK_ORDER',wo_folder_id,address_folder_id));
  if exists(select 1 from private.client_delivery_parent_maps a
    join private.client_delivery_parent_maps w on w.parent_map_id=a.id
    where a.remote_folder_id=address_folder_id and w.remote_folder_id=wo_folder_id
     and (a.organization_id<>org or a.company_id<>company
       or a.destination_id<>w.destination_id or a.destination_revision<>w.destination_revision
       or a.address_key<>w.address_key or w.work_order_id<>wo)) then
    raise exception 'Cross-company or changed hierarchy parent was allowed';end if;
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_heartbeat_delivery(%L,%L,%s)',
    pkg_id,gen_random_uuid(),delivery_gen));
  if (public.service_claim_delivery(gen_random_uuid())->>'claimed')<>'false' then
    raise exception 'Leased delivery was claimed twice';end if;
  -- A browser/contractor cannot reserve or read service-only folder IDs.
  execute 'set local role authenticated';
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_read_delivery_parent(%L,%L,%s,%L)',
    pkg_id,delivery_worker,delivery_gen,'ADDRESS'));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_reserve_delivery_parent(%L,%L,%s,%L,%L,%L)',
    pkg_id,delivery_worker,delivery_gen,'ADDRESS',address_folder_id,'DISPOSABLE-ONLY'));
  execute 'reset role';
  -- Approved path must stay frozen even if a caller attempts to alter it.
  perform pg_temp.expect_photo_review_error('40001',format(
    'update private.client_packages set folder_address_snapshot=%L where id=%L',
    'FORGED DIFFERENT ADDRESS',pkg_id));
  execute 'set local role service_role';
  folder_id:='folder'||replace(pkg_id::text,'-','');
  photo_file_id:='photo'||replace(photo::text,'-','');
  manifest_file_id:='manifest'||replace(pkg_id::text,'-','');
  -- Even after an independently verified address/WO chain, the old
  -- direct-root path must fail. No package folder can bypass company isolation.
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_reserve_delivery_file_set(%L,%L,%s,%L,%L,%L::jsonb,%L)',
    pkg_id,delivery_worker,delivery_gen,folder_id,'DISPOSABLE-ONLY',
    jsonb_build_array(jsonb_build_object('photo_id',photo,
      'file_id',photo_file_id))::text,manifest_file_id));
  -- Entire immutable package set now commits atomically. A changed
  -- selected photo identity must reject without any partial remote plans.
  perform pg_temp.expect_photo_review_error('22023',format(
    'select public.service_reserve_delivery_file_set(%L,%L,%s,%L,%L,%L::jsonb,%L)',
    pkg_id,delivery_worker,delivery_gen,folder_id,wo_folder_id,
    jsonb_build_array(jsonb_build_object(
      'photo_id',gen_random_uuid(),'file_id',photo_file_id))::text,
    manifest_file_id));
  if exists(select 1 from private.client_delivery_file_plans
      where package_id=pkg_id) then
    raise exception 'Rejected atomic reservation left partial IDs';
  end if;
  atomic_receipt:=public.service_reserve_delivery_file_set(
    pkg_id,delivery_worker,delivery_gen,folder_id,wo_folder_id,
    jsonb_build_array(jsonb_build_object('photo_id',photo,
      'file_id',photo_file_id)),manifest_file_id);
  if atomic_receipt->>'reserved'<>'true' or atomic_receipt->>'reserved_count'<>'3'
    or atomic_receipt->>'folder_id'<>folder_id
    or atomic_receipt->>'manifest_id'<>manifest_file_id
    or (select count(*) from private.client_delivery_file_plans
        where package_id=pkg_id)<>3 then
    raise exception 'Three original Drive IDs did not commit together';
  end if;
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_reserve_delivery_file_set(%L,%L,%s,%L,%L,%L::jsonb,%L)',
    pkg_id,delivery_worker,delivery_gen,'different_generated_folder',
    wo_folder_id,jsonb_build_array(jsonb_build_object(
      'photo_id',photo,'file_id',photo_file_id))::text,manifest_file_id));
  select id into folder_plan from private.client_delivery_file_plans
     where package_id=pkg_id and kind='FOLDER' and photo_id is null;
  folder_plan_projection:=public.service_get_delivery_folder_plan(
     pkg_id,delivery_worker,delivery_gen,folder_plan);
  if folder_plan_projection->>'plan_id'<>folder_plan::text
     or folder_plan_projection->>'parent_id'<>wo_folder_id
     or folder_plan_projection->>'parent_kind'<>'WORK_ORDER'
     or folder_plan_projection->>'name'<>'package-'||pkg_id::text
     or folder_plan_projection->>'state'<>'PREALLOCATED' then
     raise exception 'Untrusted package folder plan projection';end if;
  folder_proof:=jsonb_build_object('id',folder_id,'parent',wo_folder_id,
     'name','package-'||pkg_id::text,
     'mime','application/vnd.google-apps.folder','trashed',false,
     'drive_id','client-drive-fixture','sha256',null,'size',null,
     'appProperties',jsonb_build_object('fwh_package',pkg_id::text,
       'fwh_manifest',pkg_preview->>'manifest_sha256'));
  perform pg_temp.expect_photo_review_error('42501',format(
     'select public.service_confirm_delivery_folder(%L,%L,%s,%L,%L::jsonb)',
     pkg_id,delivery_worker,delivery_gen,folder_plan,folder_proof::text));
  if public.service_begin_delivery_folder_create(
       pkg_id,delivery_worker,delivery_gen,folder_plan)->>'state'<>'MAY_CREATE' then
       raise exception 'First package create journal not durable';end if;
  if public.service_begin_delivery_folder_create(
       pkg_id,delivery_worker,delivery_gen,folder_plan)->>'state'<>'VERIFY_EXISTING' then
       raise exception 'Repeated package create offered duplicate remote POST';end if;
  if public.service_get_delivery_folder_plan(
       pkg_id,delivery_worker,delivery_gen,folder_plan)->>'state'<>'ATTEMPTED' then
       raise exception 'Previously attempted package folder not persisted';end if;
  perform pg_temp.expect_photo_review_error('42501',format(
     'select public.service_confirm_delivery_folder(%L,%L,%s,%L,%L::jsonb)',
     pkg_id,delivery_worker,delivery_gen,folder_plan,
     (folder_proof||jsonb_build_object('drive_id','foreign-drive'))::text));
  -- PHOTO and MANIFEST were included in the same initial SQL transaction.
  if (select count(*) from private.client_delivery_file_plans
       where package_id=pkg_id and kind in ('PHOTO','MANIFEST'))<>2 then
    raise exception 'Atomic file set lost selected photo or manifest';end if;
  -- The retired one-file RPC is no longer a service-role escape hatch.
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_reserve_delivery_file(%L,%L,%s,%L,%L,%L,%L)',
    pkg_id,delivery_worker,delivery_gen,'PHOTO',photo,'OTHER-GENERATED-ID',folder_id));
  select id into upload_plan from private.client_delivery_file_plans
    where package_id=pkg_id and kind='PHOTO' and photo_id=photo;
  perform public.service_store_upload_session(pkg_id,delivery_worker,delivery_gen,upload_plan,encrypted_session);  trusted_plan:=public.service_get_delivery_file_plan(pkg_id,delivery_worker,delivery_gen,upload_plan);
  if trusted_plan->>'plan_id'<>upload_plan::text
     or trusted_plan->>'file_id'<>photo_file_id
     or trusted_plan->>'sha256'<>repeat('a',64)
     or (trusted_plan->>'size')::bigint<>250000
     or trusted_plan->'source'->>'object_key'<>t.object_key
     or trusted_plan->>'parent_id'<>folder_id
     or trusted_plan->>'name'<>'field-photo-'||photo::text||'.jpg' then
     raise exception 'Fenced protected source projection differed from immutable receipt';end if;
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_get_delivery_file_plan(%L,%L,%s,%L)',
    pkg_id,gen_random_uuid(),delivery_gen,upload_plan));

  perform public.service_store_upload_session(pkg_id,delivery_worker,delivery_gen,upload_plan,encrypted_session);
  if public.service_read_upload_session(pkg_id,delivery_worker,delivery_gen,upload_plan)->'encrypted'
      is distinct from encrypted_session then
    raise exception 'Private session cannot be recovered by the fenced worker';end if;
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_read_upload_session(%L,%L,%s,%L)',
    pkg_id,gen_random_uuid(),delivery_gen,upload_plan));
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_store_upload_session(%L,%L,%s,%L,%L::jsonb)',
    pkg_id,delivery_worker,delivery_gen,upload_plan,
    (encrypted_session||jsonb_build_object('payload',repeat('C',160)))::text));
  perform public.service_record_upload_offset(pkg_id,delivery_worker,delivery_gen,upload_plan,131072,false);
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_record_upload_offset(%L,%L,%s,%L,%s,false)',
    pkg_id,delivery_worker,delivery_gen,upload_plan,1));
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_record_upload_offset(%L,%L,%s,%L,%s,false)',
    pkg_id,delivery_worker,delivery_gen,upload_plan,250000));
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.service_record_upload_offset(%L,%L,%s,%L,%s,false)',
    pkg_id,gen_random_uuid(),delivery_gen,upload_plan,140000));
  perform public.service_record_upload_offset(pkg_id,delivery_worker,delivery_gen,upload_plan,250000,true);
  if (select recorded_offset from private.client_delivery_upload_sessions where file_plan_id=upload_plan)<>250000
     or (select state from private.client_delivery_upload_sessions where file_plan_id=upload_plan)<>'VERIFYING'
     or exists(select 1 from private.client_delivery_upload_sessions u
       where u.file_plan_id=upload_plan and u.ciphertext::text like '%googleapis%') then
    raise exception 'Encrypted upload recovery or exact provider offset not persisted';end if;
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_confirm_delivery_file(%L,%L,%s,%L,%L,%L,%L,%L,%L,%s)',
    pkg_id,delivery_worker,delivery_gen,'PHOTO',photo,photo_file_id,folder_id,
    'image/jpeg',repeat('0',64),250000));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_finish_delivery(%L,%L,%s)',
    pkg_id,delivery_worker,delivery_gen));
  perform public.service_confirm_delivery_file(pkg_id,delivery_worker,delivery_gen,
    'FOLDER',null,folder_id,wo_folder_id,'application/vnd.google-apps.folder',null,null);
  perform public.service_confirm_delivery_file(pkg_id,delivery_worker,delivery_gen,
    'PHOTO',photo,photo_file_id,folder_id,'image/jpeg',repeat('a',64),250000);
  frozen_size:=octet_length((delivery_claim->'manifest')::text);
  perform public.service_confirm_delivery_file(pkg_id,delivery_worker,delivery_gen,
    'MANIFEST',null,manifest_file_id,folder_id,'application/json',
    pkg_preview->>'manifest_sha256',frozen_size);
  -- File metadata alone cannot complete delivery without the original
  -- journaled package-folder attempt + independent exact Drive GET.
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.service_finish_delivery(%L,%L,%s)',
    pkg_id,delivery_worker,delivery_gen));
  if public.service_confirm_delivery_folder(pkg_id,delivery_worker,delivery_gen,
     folder_plan,folder_proof)->>'state'<>'VERIFIED' then
    raise exception 'Exact package folder receipt did not persist';end if;
  if public.service_confirm_delivery_folder(pkg_id,delivery_worker,delivery_gen,
     folder_plan,folder_proof)->>'replayed'<>'true' then
    raise exception 'Same package folder receipt not idempotent';end if;
  -- Frozen checked provider plan must carry EVERY verified ancestor,
  -- the originally allocated folder, one selected JPEG and the manifest.
  target:=public.service_delivery_final_provider_snapshot(
    pkg_id,delivery_worker,delivery_gen);
  if target->>'package_id'<>pkg_id::text
    or target->>'root_id'<>'DISPOSABLE-ONLY'
    or jsonb_array_length(target->'ancestors')<>2
    or target->'ancestors'->0->>'id'<>wo_folder_id
    or target->'ancestors'->1->>'id'<>address_folder_id
    or jsonb_array_length(target->'files')<>3
    or target->'files'->0->>'id'<>folder_id
    or target->'files'->1->>'id'<>photo_file_id
    or target->'files'->2->>'id'<>manifest_file_id
    or target->'files'->2->>'sha256'<>(pkg_preview->>'manifest_sha256')
  then raise exception 'Final provider snapshot omitted frozen chain or receipt';end if;
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
    or has_table_privilege('authenticated','private.client_delivery_final_receipts','select')
    or has_function_privilege('authenticated','public.service_get_delivery_file_plan(uuid,uuid,bigint,uuid)','execute')
    or has_function_privilege('authenticated','public.service_read_upload_session(uuid,uuid,bigint,uuid)','execute') then
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
  if response->>'decision'<>'REJECTED' or (select count(*) from private.photo_review_actions where photo_id=photo)<>3
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

  -- Phase 6C: immutable exact selected-page bulk action; an unrelated or
  -- stale review cannot be partly applied, and no unseen photo is selected.
  target:=jsonb_build_array(jsonb_build_object('photo_id',photo,
    'transfer_version',t.version,'expected_revision',response->>'decision_revision'));
  action:=gen_random_uuid();
  response:=public.admin_review_photos_bulk(action,wo,null,target,'APPROVED','');
  replay:=public.admin_review_photos_bulk(action,wo,null,target,'APPROVED','');
  if response is distinct from replay or response->>'outcome'<>'APPLIED'
     or (response->>'applied')::int<>1
     or (select decision from private.photo_review_decisions where photo_id=photo)<>'APPROVED'
  then raise exception 'Bulk selected-page review did not atomically apply/replay';end if;
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.admin_review_photos_bulk(%L,%L,null,%L::jsonb,%L,%L)',
    action,wo,target::text,'REJECTED','Changed input'));
  replay:=public.admin_review_photos_bulk(gen_random_uuid(),wo,null,target,'APPROVED','');
  if replay->>'outcome'<>'CONFLICT' or (replay->>'applied')::int<>0
    or jsonb_array_length(replay->'conflicts')<>1
  then raise exception 'Stale selected photo review was not all-or-none';end if;
  target:=jsonb_build_array(jsonb_build_object('photo_id',photo,
    'transfer_version',t.version,'expected_revision',
    (select revision from private.photo_review_decisions where photo_id=photo)),
    jsonb_build_object('photo_id',gen_random_uuid(),
      'transfer_version',t.version,'expected_revision',null));
  replay:=public.admin_review_photos_bulk(gen_random_uuid(),wo,null,target,'REJECTED','Retake requested');
  if replay->>'outcome'<>'CONFLICT' or (replay->>'applied')::int<>0
     or (select decision from private.photo_review_decisions where photo_id=photo)<>'APPROVED'
  then raise exception 'Partial mutation on conflict with another photo identity';end if;
  target:=public.admin_review_photo_page(wo,25,null,null,null,null,false,null,null);
  if jsonb_array_length(target->'photos')<>1 or
     target->'photos'->0->>'photo_id'<>photo::text or
     target->'photos'->0->>'decision'<>'APPROVED' or
     target->'photos'->0 ? 'object_key' or target->'photos'->0 ? 'url' or
     target->'photos'->0->>'run_sequence'<>'1'
  then raise exception 'Paged review leaked private data or wrong current run: %',target;end if;
  if jsonb_array_length((public.admin_review_photo_page(
       wo,25,null,null,null,null,false,null,'REJECTED'))->'photos')<>0
  then raise exception 'Server-side review decision filter broadened';end if;
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_review_photo_page(%L,10,null,null,null,null,false,null,null)',wo));
  if has_function_privilege('anon',
   'public.admin_review_photos_bulk(uuid,uuid,uuid,jsonb,text,text)','EXECUTE')
   or has_table_privilege('authenticated','private.photo_bulk_review_actions','UPDATE')
  then raise exception 'Bulk review exposed unscoped write';end if;
  -- Restore the deliberately REJECTED baseline used by the following
  -- Phase 6B cross-run client-package review regression. The bulk fixture
  -- itself is isolated and must not pre-approve that historical photo.
  perform public.admin_review_photo(gen_random_uuid(),wo,photo,t.version,
    (select revision from private.photo_review_decisions where photo_id=photo),
    'REJECTED','Missing side');

  -- Phase 6C server-backed issue provenance: a received exact photo is
  -- permitted, an invented/cross-WO photo is denied, and saved issues are
  -- included in the same checked correction preview/hash.
  select w.current_run_id,w.updated_at,r.requirement_snapshot
    into pending_oldrun,pending_oldrev,pending_capture
    from public.work_orders w join public.work_order_runs r on r.id=w.current_run_id
    where w.id=wo;
  issue_capture:=jsonb_set(pending_capture,'{total}',jsonb_build_object(
    'enabled',true,'minimum',1));
  issue_capture:=jsonb_set(issue_capture,'{revision}',to_jsonb(gen_random_uuid()::text));
  issue_draft:=public.admin_save_correction_draft(wo,pending_oldrun,pending_oldrev,
    null,'Correct reviewed photo',array[photo],contractor,current_date,
    'Retake the reviewed photo',issue_capture,'[]'::jsonb,pending_capture);
  issue_payload:=jsonb_build_array(jsonb_build_object(
    'photo_id',photo,'item_id',null,'reason','Blurred front photo',
    'requested_count',1));
  issue_draft:=public.admin_save_correction_issues(wo,
     (issue_draft->>'revision')::uuid,issue_payload);
  -- An Admin's combined Edit+Issues uses a single database transaction.
  -- A bad issue must roll back even the initial general-draft mutation.
  denied:=false;
  begin
    perform public.admin_save_correction_draft_with_issues(
      wo,pending_oldrun,pending_oldrev,(issue_draft->>'revision')::uuid,
      'SHOULD NOT PERSIST',array[photo],contractor,current_date,
      'Retake the reviewed photo',issue_capture,'[]'::jsonb,pending_capture,
      jsonb_build_array(jsonb_build_object('photo_id',gen_random_uuid(),
        'item_id',null,'reason','Foreign photo','requested_count',1)));
  exception when insufficient_privilege then denied:=true;end;
  if not denied or (public.admin_correction_state(wo)->'draft'->>'reason')<>
      'Correct reviewed photo'
  then raise exception 'Partial correction draft survived failed issue validator';end if;
  issue_draft:=public.admin_save_correction_draft_with_issues(
    wo,pending_oldrun,pending_oldrev,(issue_draft->>'revision')::uuid,
    'Correct reviewed photo',array[photo],contractor,current_date,
    'Retake the reviewed photo',issue_capture,'[]'::jsonb,pending_capture,
    issue_payload);
  issue_preview:=public.admin_preview_correction_draft(wo,
     (issue_draft->>'revision')::uuid);
  perform pg_temp.expect_photo_review_error('22023',format(
    'select public.admin_save_correction_issues(%L,%L,%L::jsonb)',
    wo,issue_draft->>'revision',jsonb_build_array(jsonb_build_object(
       'photo_id',photo,'item_id',null,'reason','Too many new photos',
       'requested_count',2))::text));
  if jsonb_array_length(issue_preview->'summary'->'issues')<>1
     or issue_preview->'summary'->'issues'->0->>'photo_id'<>photo::text
     or (public.admin_correction_state(wo)->'draft'->>'revision')<>
       (issue_draft->>'revision')
  then raise exception 'Correction issue lost checked server revision/provenance';end if;
  perform pg_temp.expect_photo_review_error('40001',format(
    'select public.admin_save_correction_issues(%L,%L,%L::jsonb)',
    wo,gen_random_uuid(),issue_payload::text));
  issue_payload:=jsonb_build_array(jsonb_build_object(
    'photo_id',gen_random_uuid(),'item_id',null,'reason','Foreign photo',
    'requested_count',1));
  perform pg_temp.expect_photo_review_error('42501',format(
    'select public.admin_save_correction_issues(%L,%L,%L::jsonb)',
    wo,issue_draft->>'revision',issue_payload::text));
  if has_function_privilege('anon',
    'public.admin_save_correction_issues(uuid,uuid,jsonb)','EXECUTE')
  then raise exception 'Correction issue authorization leaked';end if;

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
-- Geographic approved-manifest regression: verified path contains immutable
-- destination and nested keys; wrong company or missing geography fails closed.
do $geo_manifest_gate$
declare
  k private.client_packages%rowtype;
  g private.client_delivery_geography%rowtype;
  path jsonb;
  county_path jsonb;
  city_path jsonb;
begin
  select * into k from private.client_packages
    where folder_address_key is not null
      and exists(select 1 from private.client_delivery_destinations d
       where d.id=destination_id and d.active and d.verified)
    limit 1;
  if k.id is null then
    raise exception 'Expected approved fixture for geographic manifest gate';
  end if;
  insert into private.client_delivery_geography(
    organization_id,company_id,work_order_id,
    state_name,county_name,city_name,verification_source,
    verified_by,verified_at)
  values(k.organization_id,k.company_id,k.work_order_id,
    'Oklahoma','Beckham','Elk City','verified disposable gate fixture',
    gen_random_uuid(),clock_timestamp())
  returning * into g;
  path:=private.phase_5_expected_geographic_path(k,g);
  if path->>'layout'<>'STATE_COUNTY_CITY_ADDRESS'
    or path->>'destination_id'<>k.destination_id::text
    or path->>'geography_revision'<>g.revision::text
    or path->>'address_key'<>k.folder_address_key
    or length(path->>'state_key')<>64
    or length(path->>'county_key')<>64
    or length(path->>'city_key')<>64 then
    raise exception 'Frozen geographic path did not bind expected scope';
  end if;
  county_path:=path;
  -- The optional approved State -> City layout MUST parent City under
  -- State, not County. Preserve the same company/destination, address,
  -- geography revision and immutable State key; never infer an alternate
  -- path from a folder display name or use an 'Unknown' county.
  k.approved_manifest:=coalesce(k.approved_manifest,'{}'::jsonb)
    ||jsonb_build_object('folder_layout','STATE_CITY_ADDRESS');
  city_path:=private.phase_5_expected_geographic_path(k,g);
  if city_path->>'layout'<>'STATE_CITY_ADDRESS'
    or city_path->>'state_key' is distinct from county_path->>'state_key'
    or city_path->>'county_key' is distinct from county_path->>'county_key'
    or city_path->>'address_key' is distinct from county_path->>'address_key'
    or city_path->>'destination_id' is distinct from county_path->>'destination_id'
    or city_path->>'geography_revision' is distinct from county_path->>'geography_revision'
    or city_path->>'city_key' is distinct from
      private.geo_parent_path_key(city_path->>'state_key','CITY',g.normalized_city)
    or city_path->>'city_key' is not distinct from county_path->>'city_key' then
    raise exception 'State-City hierarchy reused County-City parent or changed frozen scope';
  end if;
  -- The original County layout is unchanged by a new company's explicit
  -- alternate selection. Both routes retain independent exact City keys.
  k.approved_manifest:=coalesce(k.approved_manifest,'{}'::jsonb)
    ||jsonb_build_object('folder_layout','STATE_COUNTY_CITY_ADDRESS');
  if (private.phase_5_expected_geographic_path(k,g))->>'city_key'
      is distinct from county_path->>'city_key' then
    raise exception 'Original State-County-City mapping was changed';
  end if;
  g.company_id:=gen_random_uuid();
  begin
    perform private.phase_5_expected_geographic_path(k,g);
    raise exception 'Foreign-company geography accepted';
  exception when insufficient_privilege then null;
  end;
  raise notice 'Geographic approved-manifest company/destination/key and both State-City / State-County-City derivations PASS';
end;
$geo_manifest_gate$;
-- Client layout configuration is scoped, revisioned, idempotent and never
-- permits a contractor or foreign company to change a destination.
do $folder_layout$
declare
 d private.client_delivery_destinations%rowtype;
 owner_id uuid; contractor_id uuid; action uuid:=gen_random_uuid();
 first jsonb; again jsonb; latest jsonb; destinations jsonb; failed boolean;
 previous_pkg private.client_packages%rowtype; frozen_projection jsonb;
begin
 select * into d from private.client_delivery_destinations
  where verified and active limit 1;
 select m.user_id into owner_id from private.admin_team_memberships m
  where m.organization_id=d.organization_id and m.active limit 1;
 select a.user_id into contractor_id from private.account_work_access a
  where a.organization_id=d.organization_id and a.work_role='CONTRACTOR' limit 1;
 if d.id is null or owner_id is null or contractor_id is null then
  raise exception 'Missing disposable layout authority fixture';end if;
 select * into previous_pkg from private.client_packages
  where destination_id=d.id and status='DELIVERED' limit 1;
 if previous_pkg.id is null or previous_pkg.approved_manifest is null then
   raise exception 'Disposable approved delivery snapshot missing';end if;
 frozen_projection:=previous_pkg.approved_manifest;
 update private.account_work_access set active=true,suspension_authority=null,
  disabled_at=null where user_id=owner_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,
  'session_id',owner_id,'app_metadata',jsonb_build_object(
    'role','ADMIN','organization_id',d.organization_id))::text,true);
 execute 'set local role authenticated';
 destinations:=public.admin_list_client_folder_destinations();
 if not exists(select 1 from jsonb_array_elements(destinations->'destinations') e
     where e->>'destination_id'=d.id::text)
 then raise exception 'Authorized client folder destination hidden';end if;
 first:=public.admin_set_client_folder_layout(action,d.id,null,'ADDRESS_WORK_ORDER');
 again:=public.admin_set_client_folder_layout(action,d.id,null,'ADDRESS_WORK_ORDER');
 if first->>'layout'<>'ADDRESS_WORK_ORDER' or again->>'replayed'<>'true'
  or first->>'revision'<>again->>'revision'
 then raise exception 'Folder config replay or revision changed';end if;
 perform pg_temp.expect_photo_review_error('40001',format(
   'select public.admin_set_client_folder_layout(%L,%L,null,%L)',
   gen_random_uuid(),d.id,'STATE_COUNTY_CITY_ADDRESS'));
 latest:=public.admin_set_client_folder_layout(gen_random_uuid(),d.id,
  (first->>'revision')::uuid,'STATE_COUNTY_CITY_ADDRESS');
 if latest->>'revision'=first->>'revision'
  or (public.admin_get_client_folder_layout(d.id))->>'layout'<>'STATE_COUNTY_CITY_ADDRESS'
 then raise exception 'Revisioned Admin layout preference not saved';end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor_id,
  'session_id',contractor_id,'app_metadata',jsonb_build_object(
    'role','CONTRACTOR','organization_id',d.organization_id))::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect_photo_review_error('42501',format(
  'select public.admin_set_client_folder_layout(%L,%L,%L,%L)',
  gen_random_uuid(),d.id,latest->>'revision','ADDRESS_WORK_ORDER'));
 perform pg_temp.expect_photo_review_error('42501',format(
  'select public.admin_get_client_folder_layout(%L)',d.id));
 execute 'reset role';
 -- A later Admin choice must not retroactively rewrite an approved package.
 if (select approved_manifest from private.client_packages
       where id=previous_pkg.id) is distinct from frozen_projection
   or (select destination_id from private.client_packages
       where id=previous_pkg.id) is distinct from d.id then
   raise exception 'Admin layout change rewrote previously approved delivery';
 end if;
 if has_table_privilege('authenticated','private.client_delivery_folder_layouts','update')
  or has_table_privilege('authenticated','private.client_delivery_folder_layout_actions','select')
 then raise exception 'Direct client layout table access became available';end if;
 raise notice 'Admin layout scope, revision, replay, contractor denial PASS';
end;
$folder_layout$;
-- Geographic reservation service RPCs must remain inaccessible to app JWTs.
do $geo_rpc_gate$
begin
 if has_function_privilege('authenticated',
    'public.service_reserve_geographic_parent(uuid,uuid,bigint,text,text,text)','execute')
  or has_function_privilege('authenticated',
    'public.service_read_geographic_parent(uuid,uuid,bigint,text)','execute')
  or has_function_privilege('authenticated',
    'public.service_reserve_geographic_leaf(uuid,uuid,bigint,text,text,text)','execute')
  or has_function_privilege('anon',
    'public.service_read_geographic_leaf(uuid,uuid,bigint,text)','execute')
  or has_table_privilege('authenticated','private.client_delivery_parent_maps','insert')
 then
  raise exception 'Geographic delivery authority was exposed to a browser/phone';
 end if;
 raise notice 'Geographic reservation RPC service-only boundary PASS';
end;
$geo_rpc_gate$;
-- Phase 6B/6D combined real native SQL fixture: an already DELIVERED
-- original package and its exact private receipt survive client-return
-- dispatch; a new package may select the retained original photo without
-- rebinding it to the replacement run. No real Drive object is touched.
do $phase6_multi_run$
declare
 old_pkg private.client_packages%rowtype; orig_manifest jsonb; old_photo uuid;
 admin_id uuid; worker uuid; org uuid; wo uuid; oldrun uuid; newrun uuid; instance uuid;
 cfg jsonb; revision uuid; action uuid:=gen_random_uuid(); result jsonb; next_pkg jsonb;
 selected jsonb; oldrev timestamptz; claims_admin text; claims_worker text;
 set_id uuid:=gen_random_uuid(); digest text;
 new_photo uuid:=gen_random_uuid(); photo_set jsonb;
 transfer private.photo_transfers%rowtype; new_object uuid:=gen_random_uuid();
 old_decision_revision uuid; old_transfer_version uuid; history jsonb; page jsonb;
begin
 select * into old_pkg from private.client_packages
  where status='DELIVERED' and approved_manifest is not null limit 1;
 if old_pkg.id is null then raise exception 'Prior confirmed package fixture unavailable';end if;
 select photo_id into old_photo from private.client_package_photos
  where package_id=old_pkg.id order by ordinal limit 1;
 if old_photo is null then raise exception 'Prior verified photo missing';end if;
 select w.id,w.current_run_id,w.updated_at,w.organization_id
  into wo,oldrun,oldrev,org from public.work_orders w where w.id=old_pkg.work_order_id;
 select current_assignee_user_id into worker from public.work_order_runs where id=oldrun;
 select user_id into admin_id from private.admin_team_memberships
  where organization_id=org and active limit 1;
 if admin_id is null or worker is null or old_pkg.run_id<>oldrun
  then raise exception 'History fixture changed';end if;
 orig_manifest:=old_pkg.approved_manifest;
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
  'total',jsonb_build_object('enabled',true,'minimum',1),'items','[]'::jsonb);
 claims_admin:=jsonb_build_object('sub',admin_id,'session_id',admin_id,
  'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text;
 claims_worker:=jsonb_build_object('sub',worker,'session_id',worker,
  'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text;
 update private.account_work_access set active=true,suspension_authority=null,
  disabled_at=null where user_id in (admin_id,worker);
 perform set_config('request.jwt.claims',claims_admin,true);execute 'set local role authenticated';
 result:=public.admin_create_followup(action,wo,oldrun,oldrev,'CLIENT_RETURN',
   'Client requested new inspection evidence',array[old_photo],worker,
   current_date,'Additional check',cfg,'[]'::jsonb,null);
 newrun:=(result->>'run_id')::uuid;
 instance:=(result->>'assignment_instance_id')::uuid;
 if newrun=oldrun or result->>'kind'<>'CLIENT_RETURN' then
  raise exception 'Confirmed delivery did not create client return';end if;
 execute 'reset role';
 if (select approved_manifest from private.client_packages where id=old_pkg.id)
     is distinct from orig_manifest
   or (select status from private.client_packages where id=old_pkg.id)<>'DELIVERED'
   or (select run_id from public.photos where id=old_photo)<>oldrun
   or (select count(*) from public.work_order_assignments
      where id=instance and assignment_received_at is null
       and acknowledgment_received_at is null)<>1
 then raise exception 'Historical delivery/photo or fresh assignment was rewritten';end if;
 select (requirement_snapshot->>'revision')::uuid into revision
  from public.work_order_runs where id=newrun;
 perform set_config('request.jwt.claims',claims_worker,true);execute 'set local role authenticated';
 result:=public.accept_field_action_v4(gen_random_uuid(),wo,newrun,instance,
  'START',to_char(now()-interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  revision,null,'');
 if result->>'outcome'<>'APPLIED' then raise exception 'Follow-up Start failed: %',result;end if;
 photo_set:=jsonb_build_array(jsonb_build_object('id',new_photo,'item_id',null,
   'captured_at',to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 digest:=encode(sha256(convert_to(photo_set::text,'UTF8')),'hex');
 result:=public.register_photo_finish_set(set_id,wo,newrun,instance,revision,
  photo_set,digest,photo_set::text);
 if result->>'outcome'<>'APPLIED' then raise exception 'Corrective photo Finish set failed: %',result;end if;
 result:=public.accept_field_action_v4(gen_random_uuid(),wo,newrun,instance,
  'COMPLETE',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  revision,set_id,digest);
 if result->>'outcome'<>'APPLIED' then raise exception 'Follow-up Finish failed: %',result;end if;
 result:=public.begin_photo_transfer(gen_random_uuid(),new_photo,repeat('b',64),250000);
 -- The authoritative private transfer row and exact verified object below,
 -- not a loosely named client response state, establish the receipt fixture.
 execute 'reset role';
 select * into transfer from private.photo_transfers where photo_id=new_photo;
 if transfer.photo_id is null or transfer.run_id<>newrun then
   raise exception 'Replacement photo not bound to its original corrective run';end if;
 insert into storage.objects(id,bucket_id,name,owner_id,version)
  values(new_object,transfer.bucket,transfer.object_key,worker::text,'REVIEW-TEST-CORRECTIVE');
 insert into private.photo_transfer_receipts(action_id,photo_id,transfer_version,
    owner_user_id,owner_session_id,object_id,object_version,bucket,object_key,observed_sha256,observed_size)
 values(gen_random_uuid(),new_photo,transfer.version,worker,worker,new_object,
    'REVIEW-TEST-CORRECTIVE',transfer.bucket,transfer.object_key,repeat('b',64),250000);
 update private.photo_transfers set state='RECEIVED' where photo_id=new_photo;
 perform set_config('request.jwt.claims',claims_admin,true);
 execute 'set local role authenticated';
 result:=public.admin_review_photo(gen_random_uuid(),wo,new_photo,transfer.version,
    null,'APPROVED','');
 if result->>'decision'<>'APPROVED' then raise exception 'New corrective photo review not accepted';end if;

 next_pkg:=public.admin_save_package_draft(gen_random_uuid(),wo,null,
  'Complete corrected return submission',array[old_photo]);
 execute 'reset role';
 -- Historic delivery does not override a later explicit REJECTED review state.
 perform pg_temp.expect_photo_review_error('42501',format(
   'select private.client_package_manifest(%L)',next_pkg->>'id'));
 select d.revision,t.version into old_decision_revision,old_transfer_version
  from private.photo_review_decisions d
  join private.photo_transfers t on t.photo_id=d.photo_id
  where d.photo_id=old_photo;
 perform set_config('request.jwt.claims',claims_admin,true);
 execute 'set local role authenticated';
 perform public.admin_review_photo(gen_random_uuid(),wo,old_photo,
    old_transfer_version,old_decision_revision,'APPROVED','');
 execute 'reset role';
 -- Approved original evidence cannot satisfy the separate new-run minimum.
 perform pg_temp.expect_photo_review_error('22023',format(
    'select private.client_package_manifest(%L)',next_pkg->>'id'));
 perform set_config('request.jwt.claims',claims_admin,true);
 execute 'set local role authenticated';
 next_pkg:=public.admin_save_package_draft(gen_random_uuid(),wo,
    (next_pkg->>'revision')::uuid,'Full corrected package',array[old_photo,new_photo]);
 execute 'reset role';
 selected:=private.client_package_manifest((next_pkg->>'id')::uuid);
 perform set_config('request.jwt.claims',claims_admin,true);
 execute 'set local role authenticated';
 page:=public.admin_package_photo_page(wo,25,null,null);
 if jsonb_array_length(page->'photos')<>2
   or page->'photos'->0->>'photo_id'<>new_photo::text
   or page->'photos'->0->>'run_sequence'<>'2'
   or page->'photos'->1->>'photo_id'<>old_photo::text
   or page->'photos'->1->>'run_sequence'<>'1'
   or page->'photos'->0 ? 'object_key'
   or page->>'next_photo' is not null
 then raise exception 'Newest-run package page order, privacy or pagination wrong: %',page;end if;
 execute 'reset role';
 if selected->>'current_run_id'<>newrun::text
   or selected->'selected_photos'->0->>'photo_id'<>old_photo::text
   or selected->'selected_photos'->0->>'run_id'<>oldrun::text
   or selected->'selected_photos'->1->>'run_id'<>newrun::text
   or selected->'selected_photos'->1->>'photo_id'<>new_photo::text
   or jsonb_array_length(selected->'correction_obligations')<>1
   or (select count(*) from private.client_packages where work_order_id=wo and status='DELIVERED')<>1
 then raise exception 'Cross-run retained original evidence/coverage failed: %',selected;end if;
 -- A received original photo and valid DRAFT are NOT a new delivery. The only
 -- closure path is the exact provider worker completing an approved package.
 perform pg_temp.expect_photo_review_error('40001',format(
   'select public.service_finish_delivery(%L,%L,1)',
   next_pkg->>'id',gen_random_uuid()));
 if (select status from private.correction_obligations
     where replacement_run_id=newrun)<>'OPEN' then
   raise exception 'Private photo receipt or draft silently satisfied correction';end if;
 perform set_config('request.jwt.claims',claims_admin,true);
 execute 'set local role authenticated';
 history:=public.admin_release_history(wo,25);
 if history->>'work_order_id'<>wo::text
    or jsonb_array_length(history->'runs')<>2
    or jsonb_array_length(history->'packages')<>2
    or history->'packages'->1->>'status'<>'DELIVERED'
    or history->'packages'->1->>'receipt_confirmed_at' is null
    or history->'packages'->1->>'frozen_wo_number'<>orig_manifest->>'client_wo_number'
    or history->'runs'->0->>'run_id'<>newrun::text
 then raise exception 'Past delivery/Finish history was recalculated or disappeared: %',history;end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',claims_worker,true);
 execute 'set local role authenticated';
 perform pg_temp.expect_photo_review_error('42501',format(
   'select public.admin_release_history(%L,25)',wo));
 perform pg_temp.expect_photo_review_error('42501',format(
   'select public.admin_package_photo_page(%L,25,null,null)',wo));
 execute 'reset role';
 -- Exercise the new exact service-only TEST claim using the existing two-
 -- photo cross-run fixture; the entire gate runs under BEGIN/ROLLBACK and
 -- never writes real customer data, provider IDs or Drive objects.
 update public.work_orders set wo_number='TEST-0003-DASHBOARD'
   where id=wo;
 update private.client_companies set name='FWH TEST CLIENT'
   where id=old_pkg.company_id and organization_id=org;
 perform set_config('request.jwt.claims',claims_admin,true);
 execute 'set local role authenticated';
 page:=public.admin_preview_package(wo,(next_pkg->>'id')::uuid,
   (next_pkg->>'revision')::uuid);
 result:=public.admin_approve_package(gen_random_uuid(),wo,
   (next_pkg->>'id')::uuid,(next_pkg->>'revision')::uuid,page->>'manifest_sha256');
 if result->>'status'<>'APPROVED' then
   raise exception 'Two-photo disposable package approval failed: %',result;end if;
 result:=public.admin_queue_package(gen_random_uuid(),wo,
   (next_pkg->>'id')::uuid,(result->>'revision')::uuid,page->>'manifest_sha256');
 if result->>'status'<>'QUEUED' then
   raise exception 'Two-photo disposable package queue failed: %',result;end if;
 execute 'reset role';
 if (select count(*) from private.client_package_photos
       where package_id=(next_pkg->>'id')::uuid)<>2 then
   raise exception 'New exact TEST claim fixture requires two real member identities';end if;
 execute 'set local role service_role';
 perform pg_temp.expect_photo_review_error('42501',format(
   'select public.service_claim_exact_test_delivery(%L,%L,%L,%L)',
   gen_random_uuid(),next_pkg->>'id',old_pkg.destination_id,'DIFFERENT_TEST_ROOT'));
 if (select state from private.client_delivery_outbox
       where package_id=(next_pkg->>'id')::uuid)<>'QUEUED' then
   raise exception 'Wrong root claimed or modified TEST package';end if;
 result:=public.service_claim_exact_test_delivery(
   gen_random_uuid(),(next_pkg->>'id')::uuid,old_pkg.destination_id,
   'DISPOSABLE-ONLY');
 if result->>'claimed'<>'true'
   or result->>'package_id' is distinct from next_pkg->>'id'
   or result->>'destination_id' is distinct from old_pkg.destination_id::text
   or jsonb_array_length(result->'manifest'->'selected_photos')<>2
 then raise exception 'Exact TEST two-photo claim did not retain original lease: %',result;end if;
 if (select status from private.client_packages
       where id=(next_pkg->>'id')::uuid)<>'DELIVERING'
   or (select attempts from private.client_delivery_outbox
       where package_id=(next_pkg->>'id')::uuid)<>1
 then raise exception 'Exact TEST claim did not persist one original lease';end if;
 if public.service_claim_exact_test_delivery(
   gen_random_uuid(),(next_pkg->>'id')::uuid,old_pkg.destination_id,
   'DISPOSABLE-ONLY')->>'claimed' is distinct from 'false'
 then raise exception 'Repeated exact TEST claim acquired a second lease';end if;
 execute 'reset role';
 raise notice 'Exact disposable two-photo claim, role and wrong-root safety PASS';
 raise notice 'Phase 6D original/new photo minima, prior confirmed delivery and bounded history PASS';
end;$phase6_multi_run$;
rollback;
