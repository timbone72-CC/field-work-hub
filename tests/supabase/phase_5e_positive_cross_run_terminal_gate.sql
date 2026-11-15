-- 5E-T01: NEW positive terminal cross-run closure boundary in disposable CI.
-- This creates ONLY transaction-rolled-back synthetic PostgreSQL evidence.
-- Never invoke provider, worker, cleanup, phone, or existing hosted records.
begin;
do $cross_run$
declare
  org uuid:='00000000-0000-0000-0000-000000000001';
  admin uuid:='00000000-0000-0000-0000-000000000010';
  owner_id uuid:='00000000-0000-0000-0000-000000000011';
  wo uuid; old_run uuid; new_run uuid;
  old_assignment uuid; new_assignment uuid;
  company uuid:=gen_random_uuid(); dest uuid:=gen_random_uuid();
  pkg uuid:=gen_random_uuid(); send_action uuid:=gen_random_uuid();
  photo_selected uuid:=gen_random_uuid();
  photo_excluded uuid:=gen_random_uuid();
  old_finish uuid:=gen_random_uuid();
  new_finish uuid:=gen_random_uuid();
  transfer_ver uuid:=gen_random_uuid();
  excluded_ver uuid:=gen_random_uuid();
  photo_hash text:=repeat('a',64);
  excluded_hash text:=repeat('b',64);
  pkg_hash text:=repeat('c',64);
  old_digest text:=repeat('d',64);
  new_digest text:=repeat('e',64);
  cfg jsonb;
  selected jsonb;
  frozen jsonb;
  result jsonb;
  closed_count int;
  denied boolean:=false;
  key text;
begin
  if (select enabled or legacy_worker_off_verified
      from private.client_delivery_package_dispatch_config where singleton)
  then raise exception 'Positive closure fixture requires isolated OFF dispatch';end if;
  if (select enabled from private.client_delivery_event_wake where singleton)
  then raise exception 'Disposable CI event wake must remain OFF';end if;

  cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
    'total',jsonb_build_object('enabled',false,'minimum',0),
    'items','[]'::jsonb);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,
    'session_id',admin,'app_metadata',
    jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  select (j->>'work_order_id')::uuid into wo
  from public.admin_create_work_order_v4(false,
    'CI-5E-CROSS-RUN-'||gen_random_uuid()::text,
    'Synthetic cross run property','INSPECTION','CI only',current_date,
    owner_id,cfg) j;
  select current_run_id into old_run
  from public.work_orders where id=wo;
  select id into old_assignment from public.work_order_assignments
  where run_id=old_run and assigned_user_id=owner_id
    and assignment_ended_at is null limit 1;
  if old_assignment is null then raise exception 'CI old assignment not created';end if;

  -- Initial accepted run, two frozen photos; only one gets client delivery.
  frozen:=jsonb_build_array(
    jsonb_build_object('id',photo_selected,'captured_at',now()),
    jsonb_build_object('id',photo_excluded,'captured_at',now()));
  insert into public.photos(id,work_order_id,run_id,captured_by,captured_at)
  values(photo_selected,wo,old_run,owner_id,now()),
        (photo_excluded,wo,old_run,owner_id,now());
  insert into public.photo_finish_sets(
    id,actor_user_id,organization_id,work_order_id,run_id,
    assignment_instance_id,photos,digest)
  values(old_finish,owner_id,org,wo,old_run,old_assignment,frozen,old_digest);
  insert into public.field_actions(
    action_id,actor_user_id,organization_id,work_order_id,run_id,
    assignment_instance_id,action_kind,event_time_text,event_at,
    accepted_at,result,finish_set_id,finish_digest)
  values(gen_random_uuid(),owner_id,org,wo,old_run,old_assignment,'COMPLETE',
    to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'),now(),now(),
    '{"outcome":"APPLIED"}'::jsonb,old_finish,old_digest);
  update public.work_order_runs set field_status='FIELD_COMPLETE'
    where id=old_run;

  -- The old run has accepted Finish and immutable PRIVATE receipts for BOTH
  -- frozen originals; excluded evidence never acquires a fake client file ID.
  insert into private.photo_transfers(
    photo_id,version,organization_id,captured_by,work_order_id,run_id,
    finish_set_id,assignment_instance_id,finish_digest,
    prepared_sha256,prepared_size,object_key,state)
  values
    (photo_selected,transfer_ver,org,owner_id,wo,old_run,old_finish,
      old_assignment,old_digest,photo_hash,1234,
      org::text||'/'||wo::text||'/'||old_run::text||'/'||photo_selected::text||'.jpg','RECEIVED'),
    (photo_excluded,excluded_ver,org,owner_id,wo,old_run,old_finish,
      old_assignment,old_digest,excluded_hash,2345,
      org::text||'/'||wo::text||'/'||old_run::text||'/'||photo_excluded::text||'.jpg','RECEIVED');
  insert into private.photo_transfer_receipts(
    action_id,photo_id,transfer_version,owner_user_id,owner_session_id,
    object_id,object_version,bucket,object_key,observed_sha256,observed_size)
  select gen_random_uuid(),t.photo_id,t.version,owner_id,owner_id,
    gen_random_uuid(),'ci-only','fwh-review-private',t.object_key,
    t.prepared_sha256,t.prepared_size
  from private.photo_transfers t
  where t.photo_id in (photo_selected,photo_excluded);

  -- A distinct current/main run closes with a legitimate zero-photo Finish.
  new_run:=gen_random_uuid();
  insert into public.work_order_runs(
    id,work_order_id,organization_id,run_sequence,field_status,
    current_assignee_user_id,requirement_snapshot)
  values(new_run,wo,org,2,'FIELD_COMPLETE',owner_id,'{}'::jsonb);
  insert into public.work_order_assignments(
    run_id,organization_id,assigned_user_id,assignment_started_at)
  values(new_run,org,owner_id,now()) returning id into new_assignment;
  insert into public.photo_finish_sets(
    id,actor_user_id,organization_id,work_order_id,run_id,
    assignment_instance_id,photos,digest)
  values(new_finish,owner_id,org,wo,new_run,new_assignment,
    '[]'::jsonb,new_digest);
  insert into public.field_actions(
    action_id,actor_user_id,organization_id,work_order_id,run_id,
    assignment_instance_id,action_kind,event_time_text,event_at,
    accepted_at,result,finish_set_id,finish_digest)
  values(gen_random_uuid(),owner_id,org,wo,new_run,new_assignment,'COMPLETE',
    to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'),now(),now(),
    '{"outcome":"APPLIED"}'::jsonb,new_finish,new_digest);
  insert into private.client_companies(id,organization_id,name)
  values(company,org,'Synthetic CI Client');
  insert into private.client_delivery_destinations(
    id,organization_id,company_id,provider,provider_identity,root_folder_id)
  values(dest,org,company,'GOOGLE_DRIVE','ci@example.invalid',
    'ci_root_identity_123456789');
  update public.work_orders set current_run_id=new_run,
    current_run_sequence=2,field_status='FIELD_COMPLETE',
    client_company_id=company where id=wo;

  selected:=jsonb_build_array(jsonb_build_object(
    'photo_id',photo_selected,'run_id',old_run,'transfer_version',transfer_ver,
    'observed_sha256',photo_hash,'observed_size',1234));
  insert into private.client_packages(
    id,organization_id,work_order_id,run_id,company_id,status,
    approved_manifest,approved_sha256,approved_by,approved_at,destination_id)
  values(pkg,org,wo,new_run,company,'DELIVERING',
    jsonb_build_object('package_id',pkg,'destination_id',dest,
      'selected_photos',selected),pkg_hash,admin,now(),dest);
  insert into private.client_package_photos(package_id,photo_id,ordinal)
  values(pkg,photo_selected,1);
  insert into private.client_delivery_file_plans(
    package_id,kind,photo_id,drive_file_id,drive_parent_id,
    expected_sha256,expected_size,mime_type,state,verified_at,remote_evidence)
  values(pkg,'PHOTO',photo_selected,'ci_photo_file_123456789',
    'ci_folder_parent_123456789',photo_hash,1234,'image/jpeg',
    'VERIFIED',now(),'{"confirmed":true}'::jsonb);
  insert into private.client_package_actions(
    action_id,package_id,actor_user_id,action_kind,request_fingerprint,result)
  values(send_action,pkg,admin,'SEND',repeat('f',64),'{}'::jsonb);
  insert into private.client_delivery_outbox(
    package_id,action_id,approved_sha256,destination_id,state)
  values(pkg,send_action,pkg_hash,dest,'DELIVERING');
  insert into private.client_delivery_final_receipts(
    package_id,approved_sha256,destination_id,drive_folder_id,files)
  values(pkg,pkg_hash,dest,'ci_folder_parent_123456789',
    jsonb_build_array(jsonb_build_object('photo_id',photo_selected)));
  update private.client_delivery_outbox set state='DELIVERED'
    where package_id=pkg;

  -- THIS exact provider-terminal status transition must write BOTH accepted
  -- runs; the old run's excluded original is still privately protected.
  update private.client_packages set status='DELIVERED' where id=pkg;
  select count(*) into closed_count from private.client_package_runs
    where package_id=pkg;
  if closed_count<>2
    or not exists(select 1 from private.client_package_runs
       where package_id=pkg and run_id=old_run
         and finish_set_id=old_finish and finish_digest=old_digest)
    or not exists(select 1 from private.client_package_runs
       where package_id=pkg and run_id=new_run
         and finish_set_id=new_finish and finish_digest=new_digest)
  then raise exception 'Cross-run trusted terminal delivery did not close both accepted runs: %',closed_count;end if;
  if not exists(select 1 from private.photo_transfer_receipts
    where photo_id=photo_excluded and observed_sha256=excluded_hash)
    or exists(select 1 from private.client_package_photos
      where package_id=pkg and photo_id=photo_excluded)
  then raise exception 'Excluded original lost private retention or was falsely delivered';end if;
  if private.fwh_verified_additional_package_run(pkg,new_run,new_finish)
    or private.fwh_verified_additional_package_run(pkg,gen_random_uuid(),old_finish)
    or private.fwh_verified_additional_package_run(pkg,old_run,new_finish)
  then raise exception 'Wrong run/Finish gained cross-run closure';end if;
  begin
    update private.client_package_runs set finish_digest=old_digest
      where package_id=pkg and run_id=old_run;
  exception when sqlstate '42501' then denied:=true;end;
  if not denied then raise exception 'Immutable closure update unexpectedly allowed';end if;
  raise notice 'PASS: genuine terminal update closes two accepted runs, excluded receipt retained, foreign/immutable denied';
end;
$cross_run$;
rollback;
