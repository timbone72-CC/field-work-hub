-- Phase 5D: one-time continuation of the EXISTING original TEST first-photo
-- encrypted Google resumable session. Never generate another remote ID/session.
-- Narrow service-only atomic expired-lease + dispatch, no general recovery API.
create table private.client_delivery_test_first_photo_progress_continuations (
 package_id uuid primary key
  references private.client_delivery_test_first_photo_continuations(package_id),
 worker_id uuid not null,
 lease_generation bigint not null check (lease_generation=1),
 photo_plan_id uuid not null references private.client_delivery_file_plans(id),
 photo_remote_id text not null,
 previous_offset bigint not null check (previous_offset>0),
 previous_revision bigint not null check (previous_revision>0),
 request_id uuid not null unique,
 original_expired_lease timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.client_delivery_test_first_photo_progress_continuations enable row level security;
revoke all on private.client_delivery_test_first_photo_progress_continuations
 from public,anon,authenticated,service_role;

create function private.service_read_exact_test_first_photo_saved_progress(
 p_package uuid,p_destination uuid,p_root text
) returns jsonb language plpgsql stable security definer set search_path=''
set lock_timeout='5s' as $read$
declare
 o private.client_delivery_outbox%rowtype;
 k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 j private.client_delivery_test_first_photo_continuations%rowtype;
 f private.client_delivery_file_plans%rowtype;
 p private.client_delivery_file_plans%rowtype;
 sess private.client_delivery_upload_sessions%rowtype;
 a private.client_delivery_package_folder_attempts%rowtype;
 rt private.client_delivery_runtime%rowtype;
begin
 select * into o from private.client_delivery_outbox where package_id=p_package;
 select * into k from private.client_packages where id=p_package;
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into j from private.client_delivery_test_first_photo_continuations
  where package_id=p_package;
 select * into f from private.client_delivery_file_plans
  where package_id=p_package and kind='FOLDER';
 select * into p from private.client_delivery_file_plans
  where package_id=p_package and kind='PHOTO' order by photo_id limit 1;
 select * into sess from private.client_delivery_upload_sessions
  where package_id=p_package and file_plan_id=p.id;
 select * into a from private.client_delivery_package_folder_attempts
  where package_id=p_package and file_plan_id=f.id;
 select * into rt from private.client_delivery_runtime where organization_id=k.organization_id;
 if o.package_id is null or k.id is null or d.id is null or j.package_id is null
  or f.id is null or p.id is null or sess.file_plan_id is null or a.file_plan_id is null
  or o.state<>'DELIVERING' or k.status<>'DELIVERING'
  or o.worker_id is null or o.worker_id is distinct from j.worker_id
  or o.lease_generation<>1 or j.lease_generation<>1 or o.attempts<>1
  or o.uncertain_reason is not null or o.lease_until is null
  or o.lease_until>=clock_timestamp()
  or o.destination_id is distinct from d.id or k.destination_id is distinct from d.id
  or d.organization_id is distinct from k.organization_id
  or d.company_id is distinct from k.company_id
  or d.provider<>'GOOGLE_DRIVE' or not d.verified or not d.active
  or d.root_folder_id is distinct from p_root
  or k.approved_manifest->>'destination_root' is distinct from p_root
  or k.approved_manifest->>'destination_id' is distinct from d.id::text
  or k.approved_manifest->>'destination_revision' is distinct from d.revision::text
  or k.approved_manifest->>'package_id' is distinct from k.id::text
  or coalesce(k.approved_manifest->>'folder_layout','ADDRESS_WORK_ORDER')<>'ADDRESS_WORK_ORDER'
  or o.approved_sha256 is distinct from k.approved_sha256 or k.approved_sha256 is null
  or rt.organization_id is null or not rt.worker_ready or rt.worker_identity is null
  or j.photo_plan_id is distinct from p.id
  or j.photo_remote_id is distinct from p.drive_file_id
  or j.folder_plan_id is distinct from f.id
  or j.folder_remote_id is distinct from f.drive_file_id
  or p.drive_parent_id is distinct from f.drive_file_id
  or p.kind<>'PHOTO' or p.state<>'PREALLOCATED'
  or p.expected_size is null or p.expected_size<=0 or p.expected_size>33554432
  or p.expected_sha256 is null or p.mime_type<>'image/jpeg'
  or f.kind<>'FOLDER' or f.state<>'VERIFIED' or f.verified_at is null
  or a.verified_at is null or a.remote_evidence is null
  or a.remote_evidence->>'id' is distinct from f.drive_file_id
  or a.remote_evidence->>'parent' is distinct from f.drive_parent_id
  or a.remote_evidence->>'drive_id' is distinct from
    d.verification_receipt->>'shared_drive_id'
  or a.remote_evidence->>'name' is distinct from 'package-'||k.id::text
  or a.remote_evidence->'appProperties' is distinct from jsonb_build_object(
   'fwh_package',k.id::text,'fwh_manifest',k.approved_sha256)
  or f.remote_evidence->>'file_id' is distinct from f.drive_file_id
  or sess.state<>'UPLOADING' or sess.ciphertext is null
  or jsonb_typeof(sess.ciphertext)<>'object'
  or sess.total_bytes is distinct from p.expected_size
  or sess.recorded_offset<=0 or sess.recorded_offset>=sess.total_bytes
  or sess.revision<3
  or (select count(*) from private.client_delivery_file_plans
      where package_id=p_package)<>4
  or (select count(distinct drive_file_id) from private.client_delivery_file_plans
      where package_id=p_package)<>4
  or (select count(*) from private.client_delivery_file_plans
      where package_id=p_package and kind='PHOTO' and state='PREALLOCATED')<>2
  or (select count(*) from private.client_delivery_file_plans
      where package_id=p_package and kind='MANIFEST' and state='PREALLOCATED')<>1
  or (select count(*) from private.client_delivery_upload_starts
      where package_id=p_package and file_plan_id=p.id)<>1
  or (select count(*) from private.client_delivery_upload_sessions
      where package_id=p_package)<>1
  or exists(select 1 from private.client_delivery_dispatch_permit)
  or exists(select 1 from private.client_delivery_outbox
      where package_id<>p_package and state='DELIVERING')
  or exists(select 1 from private.client_delivery_final_receipts
      where package_id=p_package)
  or exists(select 1 from private.client_delivery_test_first_photo_progress_continuations
      where package_id=p_package)
 then raise exception 'Original TEST saved first-photo session not eligible'
  using errcode='42501';end if;
 return jsonb_build_object(
  'state','ORIGINAL_TEST_FIRST_PHOTO_SAVED_PROGRESS_EXPIRED',
  'package_id',k.id,'destination_id',d.id,'root_id',p_root,
  'worker_id',o.worker_id,'generation',o.lease_generation,'attempts',o.attempts,
  'lease_until',o.lease_until,'approved_sha256',k.approved_sha256,
  'drive_id',d.verification_receipt->>'shared_drive_id',
  'folder_plan_id',f.id,'folder_remote_id',f.drive_file_id,
  'folder_parent_id',f.drive_parent_id,'folder_name','package-'||k.id::text,
  'folder_proof',a.remote_evidence,
  'photo_plan_id',p.id,'photo_remote_id',p.drive_file_id,
  'photo_id',p.photo_id,'photo_sha256',p.expected_sha256,
  'photo_size',p.expected_size,'photo_parent_id',p.drive_parent_id,
  'recorded_offset',sess.recorded_offset,'session_revision',sess.revision,
  'session_state',sess.state);
end;
$read$;

create function public.service_read_exact_test_first_photo_saved_progress(
 p_package uuid,p_destination uuid,p_root text
) returns jsonb language sql stable security invoker set search_path='' as $wrap$
 select private.service_read_exact_test_first_photo_saved_progress(
  p_package,p_destination,p_root)
$wrap$;

create function private.service_resume_exact_test_first_photo_saved_progress(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,
 p_generation bigint,p_photo_plan uuid,p_photo_remote text,
 p_expected_lease_until timestamptz,p_expected_offset bigint,
 p_expected_revision bigint,p_proof jsonb,p_request uuid
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $resume$
declare
 o private.client_delivery_outbox%rowtype;
 s private.client_delivery_upload_sessions%rowtype;
 k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 rt private.client_delivery_runtime%rowtype;
 audit private.client_delivery_worker_readiness_actions%rowtype;
 prior jsonb;
 lease_end timestamptz;
 permit jsonb;
begin
 if p_package is null or p_destination is null or p_worker is null
  or p_generation<>1 or p_photo_plan is null or p_photo_remote is null
  or p_expected_lease_until is null or p_expected_offset is null
  or p_expected_revision is null or p_request is null
  or jsonb_typeof(p_proof)<>'object'
 then raise exception 'Exact saved session continuation required'
  using errcode='42501';end if;
 select * into o from private.client_delivery_outbox
  where package_id=p_package for update;
 select * into s from private.client_delivery_upload_sessions
  where package_id=p_package and file_plan_id=p_photo_plan for update;
 if o.package_id is null or s.file_plan_id is null
  or o.state<>'DELIVERING' or o.worker_id is distinct from p_worker
  or o.lease_generation<>1 or o.attempts<>1 or o.uncertain_reason is not null
  or o.lease_until is distinct from p_expected_lease_until
  or o.lease_until>=clock_timestamp()
  or o.destination_id is distinct from p_destination
  or s.state<>'UPLOADING' or s.recorded_offset is distinct from p_expected_offset
  or s.revision is distinct from p_expected_revision
 then raise exception 'Original lease or saved offset changed'
  using errcode='40001';end if;
 -- The read routine verifies original journal, exact prior receipt, one
 -- encrypted session, original file reservation and exclusive TEST scope.
 prior:=private.service_read_exact_test_first_photo_saved_progress(
  p_package,p_destination,p_root);
 if prior->>'state' is distinct from 'ORIGINAL_TEST_FIRST_PHOTO_SAVED_PROGRESS_EXPIRED'
  or prior->>'worker_id' is distinct from p_worker::text
  or prior->>'generation' is distinct from '1'
  or prior->>'photo_plan_id' is distinct from p_photo_plan::text
  or prior->>'photo_remote_id' is distinct from p_photo_remote
  or (prior->>'lease_until')::timestamptz is distinct from p_expected_lease_until
  or (prior->>'recorded_offset')::bigint is distinct from p_expected_offset
  or (prior->>'session_revision')::bigint is distinct from p_expected_revision
  or prior->'folder_proof' is distinct from p_proof
  or p_proof->>'id' is distinct from prior->>'folder_remote_id'
  or p_proof->>'parent' is distinct from prior->>'folder_parent_id'
  or p_proof->>'drive_id' is distinct from prior->>'drive_id'
  or p_proof->>'mime' is distinct from 'application/vnd.google-apps.folder'
  or p_proof->>'name' is distinct from prior->>'folder_name'
  or p_proof->'trashed' is distinct from 'false'::jsonb
 then raise exception 'Original provider proof or session changed'
  using errcode='42501';end if;
 -- Exact same audited original worker readiness, never a general renewal:
 -- an expired 24-hour health stamp is revalidated atomically with the
 -- original lease CAS and dispatch permit (no separate readiness API).
 select * into k from private.client_packages where id=p_package;
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into rt from private.client_delivery_runtime
  where organization_id=k.organization_id for update;
 select * into audit from private.client_delivery_worker_readiness_actions q
  where q.organization_id=k.organization_id
  order by q.recorded_at desc,q.action_id desc limit 1;
 if rt.organization_id is null or not rt.worker_ready
  or rt.worker_identity is null or audit.action_id is null
  or not audit.requested_ready
  or audit.worker_identity is distinct from rt.worker_identity
  or audit.destination_id is distinct from d.id
  or audit.destination_revision is distinct from d.revision
  or audit.expected_root_folder_id is distinct from p_root
  or audit.provider_identity is distinct from d.provider_identity
  or audit.provider_proof_folder_id is distinct from
    d.verification_receipt->>'proof_folder_id'
  or audit.verified_probe_result is distinct from
    'TEST_WORKER_CRYPTO_PROVIDER_READ_ONLY'
  or rt.last_verified_at<audit.recorded_at-interval '1 minute'
 then raise exception 'Original audited worker readiness changed'
  using errcode='42501';end if;
 if rt.last_verified_at<clock_timestamp()-interval '24 hours' then
  update private.client_delivery_runtime
    set last_verified_at=clock_timestamp()
   where organization_id=k.organization_id and worker_ready
    and worker_identity=audit.worker_identity;
  if not found then
   raise exception 'Original readiness revalidation denied'
    using errcode='40001';end if;
 end if;
 insert into private.client_delivery_test_first_photo_progress_continuations(
  package_id,worker_id,lease_generation,photo_plan_id,photo_remote_id,
  previous_offset,previous_revision,request_id,original_expired_lease)
 values (p_package,p_worker,1,p_photo_plan,p_photo_remote,
  p_expected_offset,p_expected_revision,p_request,p_expected_lease_until);
 update private.client_delivery_outbox
  set lease_until=clock_timestamp()+interval '2 minutes',
      last_heartbeat_at=clock_timestamp()
  where package_id=p_package and worker_id=p_worker and lease_generation=1
   and attempts=1 and state='DELIVERING'
   and lease_until=p_expected_lease_until
  returning lease_until into lease_end;
 if lease_end is null then
  raise exception 'Original worker CAS denied' using errcode='40001';end if;
 permit:=private.service_acquire_delivery_dispatch(p_request);
 if permit->>'acquired' is distinct from 'true' then
  raise exception 'Dispatch collision, atomic rollback' using errcode='42501';end if;
 return jsonb_build_object(
  'status','ORIGINAL_TEST_SAVED_PHOTO_DISPATCH_ACQUIRED',
  'package_id',p_package,'worker_id',p_worker,'generation',1,
  'photo_plan_id',p_photo_plan,'photo_remote_id',p_photo_remote,
  'previous_offset',p_expected_offset,'previous_revision',p_expected_revision,
  'dispatch_id',p_request,'expires_at',lease_end);
end;
$resume$;

create function public.service_resume_exact_test_first_photo_saved_progress(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,
 p_generation bigint,p_photo_plan uuid,p_photo_remote text,
 p_expected_lease_until timestamptz,p_expected_offset bigint,
 p_expected_revision bigint,p_proof jsonb,p_request uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_resume_exact_test_first_photo_saved_progress(
  p_package,p_destination,p_root,p_worker,p_generation,p_photo_plan,
  p_photo_remote,p_expected_lease_until,p_expected_offset,p_expected_revision,
  p_proof,p_request)
$wrap$;
revoke all on function
 private.service_read_exact_test_first_photo_saved_progress(uuid,uuid,text),
 public.service_read_exact_test_first_photo_saved_progress(uuid,uuid,text),
 private.service_resume_exact_test_first_photo_saved_progress(
  uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,bigint,bigint,jsonb,uuid),
 public.service_resume_exact_test_first_photo_saved_progress(
  uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,bigint,bigint,jsonb,uuid)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_read_exact_test_first_photo_saved_progress(uuid,uuid,text),
 public.service_read_exact_test_first_photo_saved_progress(uuid,uuid,text),
 private.service_resume_exact_test_first_photo_saved_progress(
  uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,bigint,bigint,jsonb,uuid),
 public.service_resume_exact_test_first_photo_saved_progress(
  uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,bigint,bigint,jsonb,uuid)
 to service_role;
