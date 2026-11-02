-- Phase 5D: ORIGINAL disposable TEST package, one protected first-photo step.
-- Additive, service-only. No automatic client delivery or new remote IDs.
create table private.client_delivery_test_first_photo_continuations (
 package_id uuid primary key references private.client_packages(id),
 worker_id uuid not null,
 lease_generation bigint not null check(lease_generation=1),
 original_lease_until timestamptz not null,
 folder_plan_id uuid not null references private.client_delivery_file_plans(id),
 photo_plan_id uuid not null references private.client_delivery_file_plans(id),
 folder_remote_id text not null,
 photo_remote_id text not null,
 request_id uuid not null unique,
 observed_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.client_delivery_test_first_photo_continuations enable row level security;
revoke all on private.client_delivery_test_first_photo_continuations
 from public,anon,authenticated,service_role;

create function private.service_read_exact_test_first_photo_continuation(
 p_package uuid,p_destination uuid,p_root text
) returns jsonb language plpgsql stable security definer set search_path=''
set lock_timeout='5s' as $read$
declare
 k private.client_packages%rowtype;
 o private.client_delivery_outbox%rowtype;
 d private.client_delivery_destinations%rowtype;
 w private.client_delivery_parent_maps%rowtype;
 a private.client_delivery_parent_maps%rowtype;
 f private.client_delivery_file_plans%rowtype;
 p private.client_delivery_file_plans%rowtype;
 t private.client_delivery_package_folder_attempts%rowtype;
 j private.client_delivery_test_verified_wo_continuations%rowtype;
 r private.client_delivery_runtime%rowtype;
 proof jsonb;
 selected jsonb;
begin
 select * into k from private.client_packages where id=p_package;
 select * into o from private.client_delivery_outbox where package_id=p_package;
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into j from private.client_delivery_test_verified_wo_continuations where package_id=p_package;
 select * into w from private.client_delivery_parent_maps where id=j.wo_map_id;
 select * into a from private.client_delivery_parent_maps where id=w.parent_map_id;
 select * into f from private.client_delivery_file_plans
  where package_id=p_package and kind='FOLDER';
 select * into t from private.client_delivery_package_folder_attempts
  where file_plan_id=f.id and package_id=p_package;
 select * into p from private.client_delivery_file_plans
  where package_id=p_package and kind='PHOTO' order by photo_id limit 1;
 select * into r from private.client_delivery_runtime where organization_id=k.organization_id;
 proof:=t.remote_evidence;
 selected:=k.approved_manifest->'selected_photos';
 if k.id is null or d.id is null or o.package_id is null or j.package_id is null
  or w.id is null or a.id is null or f.id is null or p.id is null or t.file_plan_id is null
  or r.organization_id is null or not r.worker_ready or r.worker_identity is null
  or k.status<>'DELIVERING' or o.state<>'DELIVERING'
  or o.worker_id is null or o.worker_id is distinct from j.worker_id
  or o.lease_generation<>1 or j.lease_generation<>1 or o.attempts<>1
  or o.uncertain_reason is not null or o.lease_until is null
  or o.lease_until>=clock_timestamp()
  or o.destination_id is distinct from d.id
  or d.organization_id is distinct from k.organization_id
  or d.company_id is distinct from k.company_id
  or d.id is distinct from k.destination_id
  or d.provider<>'GOOGLE_DRIVE' or not d.verified or not d.active
  or d.root_folder_id is distinct from p_root
  or k.approved_manifest->>'destination_root' is distinct from p_root
  or k.approved_manifest->>'destination_id' is distinct from d.id::text
  or k.approved_manifest->>'destination_revision' is distinct from d.revision::text
  or coalesce(k.approved_manifest->>'folder_layout','ADDRESS_WORK_ORDER')<>'ADDRESS_WORK_ORDER'
  or k.approved_manifest->>'package_id' is distinct from k.id::text
  or k.approved_sha256 is null or o.approved_sha256 is distinct from k.approved_sha256
  or jsonb_typeof(selected)<>'array' or jsonb_array_length(selected)<>2
  or (select count(*) from private.client_package_photos where package_id=p_package)<>2
  or not exists(select 1 from public.work_orders wo
    join private.client_companies cc on cc.id=k.company_id and cc.organization_id=k.organization_id
    where wo.id=k.work_order_id and wo.organization_id=k.organization_id
    and wo.client_company_id=k.company_id and wo.wo_number='TEST-0003-DASHBOARD'
    and cc.name='FWH TEST CLIENT' and cc.active)
  or d.verification_receipt->>'shared_drive_id' is null
  or exists(select 1 from private.client_delivery_dispatch_permit where request_id is not null)
  or exists(select 1 from private.client_delivery_test_first_photo_continuations
    where package_id=p_package)
  or exists(select 1 from private.client_delivery_outbox where package_id<>p_package
    and state='DELIVERING')
  or exists(select 1 from private.client_delivery_upload_starts where package_id=p_package)
  or exists(select 1 from private.client_delivery_upload_sessions where package_id=p_package)
  or exists(select 1 from private.client_delivery_final_receipts where package_id=p_package)
 then raise exception 'Original TEST first photo recovery scope changed' using errcode='42501';end if;
 if w.kind<>'WORK_ORDER' or w.state<>'VERIFIED' or w.create_attempts<>1
  or w.verified_at is null or w.remote_folder_id is distinct from j.remote_folder_id
  or w.id is distinct from j.wo_map_id or w.work_order_id is distinct from k.work_order_id
  or w.destination_id is distinct from d.id or w.remote_evidence is null
  or w.remote_evidence->>'id' is distinct from w.remote_folder_id
  or a.kind<>'ADDRESS' or a.state<>'VERIFIED' or a.create_attempts<>1
  or a.verified_at is null or a.destination_id is distinct from d.id
  or a.parent_remote_id is distinct from p_root
  or w.parent_remote_id is distinct from a.remote_folder_id
  or w.remote_evidence->>'parent' is distinct from a.remote_folder_id
  or w.remote_evidence->>'drive_id' is distinct from d.verification_receipt->>'shared_drive_id'
  or w.remote_evidence->'appProperties' is distinct from jsonb_build_object(
    'fwh_org',k.organization_id::text,'fwh_company',k.company_id::text,
    'fwh_destination',d.id::text,'fwh_kind','WORK_ORDER','fwh_key',w.folder_key)
  or a.remote_evidence->>'id' is distinct from a.remote_folder_id
 then raise exception 'Verified original WO receipt not immutable' using errcode='42501';end if;
 if f.kind<>'FOLDER' or f.state<>'VERIFIED' or f.verified_at is null
  or f.drive_parent_id is distinct from w.remote_folder_id
  or f.mime_type<>'application/vnd.google-apps.folder'
  or f.expected_sha256 is not null or f.expected_size is not null
  or t.verified_at is null
  or t.remote_evidence->>'id' is distinct from f.drive_file_id
  or t.remote_evidence->>'parent' is distinct from f.drive_parent_id
  or t.remote_evidence->>'drive_id' is distinct from d.verification_receipt->>'shared_drive_id'
  or t.remote_evidence->>'mime' is distinct from f.mime_type
  or t.remote_evidence->>'name' is distinct from 'package-'||k.id::text
  or t.remote_evidence->'trashed' is distinct from 'false'::jsonb
  or t.remote_evidence->'sha256' is distinct from 'null'::jsonb
  or t.remote_evidence->'size' is distinct from 'null'::jsonb
  or t.remote_evidence->'appProperties' is distinct from
    jsonb_build_object('fwh_package',k.id::text,'fwh_manifest',k.approved_sha256)
  or f.remote_evidence is distinct from jsonb_build_object(
    'file_id',f.drive_file_id,'parent_id',f.drive_parent_id,
    'mime_type',f.mime_type,'sha256',null,'size',null)
  or (select count(*) from private.client_delivery_file_plans where package_id=p_package)<>4
  or (select count(distinct drive_file_id) from private.client_delivery_file_plans where package_id=p_package)<>4
  or (select count(*) from private.client_delivery_file_plans
    where package_id=p_package and kind='FOLDER' and state='VERIFIED')<>1
  or (select count(*) from private.client_delivery_file_plans
    where package_id=p_package and kind='PHOTO' and state='PREALLOCATED')<>2
  or (select count(*) from private.client_delivery_file_plans
    where package_id=p_package and kind='MANIFEST' and state='PREALLOCATED'
      and expected_sha256=k.approved_sha256
      and expected_size=octet_length(k.approved_manifest::text))<>1
  or exists(select 1 from private.client_delivery_file_plans q
    where q.package_id=p_package and q.kind='PHOTO'
      and (q.drive_parent_id is distinct from f.drive_file_id or
       q.mime_type<>'image/jpeg' or not exists(
        select 1 from jsonb_array_elements(selected) s
        where s->>'photo_id'=q.photo_id::text
          and s->>'observed_sha256'=q.expected_sha256
          and (s->>'observed_size')::bigint=q.expected_size)))
  or p.expected_sha256 is null or p.expected_size is null or p.expected_size<=0
  or p.expected_size>33554432 or p.drive_parent_id is distinct from f.drive_file_id
 then raise exception 'Verified PACKAGE or PHOTO reservation changed' using errcode='42501';end if;
 return jsonb_build_object(
  'state','ORIGINAL_TEST_FIRST_PHOTO_EXPIRED',
  'package_id',k.id,'destination_id',d.id,'root_id',p_root,
  'worker_id',o.worker_id,'generation',o.lease_generation,'attempts',o.attempts,
  'lease_until',o.lease_until,'approved_sha256',k.approved_sha256,
  'drive_id',d.verification_receipt->>'shared_drive_id',
  'wo_remote_id',w.remote_folder_id,'wo_parent_id',a.remote_folder_id,
  'wo_name',w.remote_name,'wo_proof',w.remote_evidence,
  'wo_properties',w.remote_evidence->'appProperties',
  'folder_plan_id',f.id,'folder_remote_id',f.drive_file_id,
  'folder_proof',proof,'folder_name','package-'||k.id::text,
  'folder_properties',proof->'appProperties',
  'photo_plan_id',p.id,'photo_remote_id',p.drive_file_id,
  'photo_id',p.photo_id,'photo_sha256',p.expected_sha256,'photo_size',p.expected_size,
  'photo_parent_id',p.drive_parent_id
 );
end;
$read$;
create function public.service_read_exact_test_first_photo_continuation(
 p_package uuid,p_destination uuid,p_root text
) returns jsonb language sql stable security invoker set search_path='' as $wrap$
 select private.service_read_exact_test_first_photo_continuation(p_package,p_destination,p_root)
$wrap$;

create function private.service_resume_exact_test_first_photo_and_dispatch(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,
 p_generation bigint,p_folder_plan uuid,p_photo_plan uuid,
 p_folder_remote text,p_photo_remote text,
 p_expected_lease_until timestamptz,p_observed_at timestamptz,
 p_proof jsonb,p_request uuid
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $resume$
declare
 o private.client_delivery_outbox%rowtype;
 k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 rt private.client_delivery_runtime%rowtype;
 action private.client_delivery_worker_readiness_actions%rowtype;
 s jsonb;
 lease_end timestamptz;
 permit jsonb;
begin
 if p_package is null or p_destination is null or p_worker is null
  or p_generation<>1 or p_folder_plan is null or p_photo_plan is null
  or p_folder_remote is null or p_photo_remote is null or p_request is null
  or p_expected_lease_until is null or p_observed_at is null
  or p_observed_at>clock_timestamp()
  or p_observed_at<clock_timestamp()-interval '30 seconds'
  or jsonb_typeof(p_proof)<>'object'
 then raise exception 'Fresh original TEST PACKAGE proof required' using errcode='42501';end if;
 select * into o from private.client_delivery_outbox where package_id=p_package for update;
 if o.package_id is null or o.state<>'DELIVERING'
  or o.worker_id is distinct from p_worker
  or o.lease_generation<>1 or o.attempts<>1 or o.uncertain_reason is not null
  or o.lease_until is distinct from p_expected_lease_until
  or o.lease_until>=clock_timestamp()
  or o.destination_id is distinct from p_destination
 then raise exception 'Only same expired original TEST worker may resume' using errcode='40001';end if;
 s:=private.service_read_exact_test_first_photo_continuation(p_package,p_destination,p_root);
 if s->>'state' is distinct from 'ORIGINAL_TEST_FIRST_PHOTO_EXPIRED'
  or s->>'worker_id' is distinct from p_worker::text
  or s->>'generation' is distinct from '1'
  or s->>'folder_plan_id' is distinct from p_folder_plan::text
  or s->>'photo_plan_id' is distinct from p_photo_plan::text
  or s->>'folder_remote_id' is distinct from p_folder_remote
  or s->>'photo_remote_id' is distinct from p_photo_remote
  or (s->>'lease_until')::timestamptz is distinct from p_expected_lease_until
  or s->'folder_proof' is distinct from p_proof
  or p_proof->>'id' is distinct from p_folder_remote
  or p_proof->>'parent' is distinct from s->>'wo_remote_id'
  or p_proof->>'drive_id' is distinct from s->>'drive_id'
  or p_proof->>'mime' is distinct from 'application/vnd.google-apps.folder'
  or p_proof->>'name' is distinct from s->>'folder_name'
  or p_proof->'appProperties' is distinct from s->'folder_properties'
  or p_proof->'trashed' is distinct from 'false'::jsonb
  or p_proof->'sha256' is distinct from 'null'::jsonb
  or p_proof->'size' is distinct from 'null'::jsonb
 then raise exception 'Original TEST provider identity changed' using errcode='42501';end if;
 select * into k from private.client_packages where id=p_package;
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into rt from private.client_delivery_runtime
  where organization_id=k.organization_id for update;
 select * into action from private.client_delivery_worker_readiness_actions a
  where a.organization_id=k.organization_id order by a.recorded_at desc,a.action_id desc limit 1;
 if rt.organization_id is null or not rt.worker_ready or rt.worker_identity is null
  or action.action_id is null or not action.requested_ready
  or action.worker_identity is distinct from rt.worker_identity
  or action.destination_id is distinct from d.id
  or action.destination_revision is distinct from d.revision
  or action.expected_root_folder_id is distinct from p_root
  or action.provider_identity is distinct from d.provider_identity
  or action.provider_proof_folder_id is distinct from d.verification_receipt->>'proof_folder_id'
  or action.verified_probe_result is distinct from 'TEST_WORKER_CRYPTO_PROVIDER_READ_ONLY'
  or rt.last_verified_at<action.recorded_at-interval '1 minute'
 then raise exception 'Audited original worker readiness changed' using errcode='42501';end if;
 if rt.last_verified_at<clock_timestamp()-interval '24 hours' then
  update private.client_delivery_runtime set last_verified_at=clock_timestamp()
   where organization_id=k.organization_id and worker_ready
     and worker_identity=action.worker_identity;
  if not found then raise exception 'Readiness revalidation denied' using errcode='40001';end if;
 end if;
 insert into private.client_delivery_test_first_photo_continuations(
  package_id,worker_id,lease_generation,original_lease_until,
  folder_plan_id,photo_plan_id,folder_remote_id,photo_remote_id,
  request_id,observed_at)
 values(p_package,p_worker,p_generation,p_expected_lease_until,
  p_folder_plan,p_photo_plan,p_folder_remote,p_photo_remote,p_request,p_observed_at);
 update private.client_delivery_outbox
  set lease_until=clock_timestamp()+interval '2 minutes',
      last_heartbeat_at=clock_timestamp()
  where package_id=p_package and worker_id=p_worker and lease_generation=1
    and attempts=1 and state='DELIVERING'
    and lease_until=p_expected_lease_until
  returning lease_until into lease_end;
 if lease_end is null then raise exception 'Original worker lease CAS denied' using errcode='40001';end if;
 permit:=private.service_acquire_delivery_dispatch(p_request);
 if permit->>'acquired' is distinct from 'true' then
  raise exception 'Dispatch collision: entire original-worker transaction rolled back'
    using errcode='42501';end if;
 return jsonb_build_object(
  'status','ORIGINAL_TEST_FIRST_PHOTO_DISPATCH_ACQUIRED',
  'package_id',p_package,'worker_id',p_worker,'generation',p_generation,
  'folder_plan_id',p_folder_plan,'photo_plan_id',p_photo_plan,
  'folder_remote_id',p_folder_remote,'photo_remote_id',p_photo_remote,
  'dispatch_id',p_request,'expires_at',lease_end);
end;
$resume$;
create function public.service_resume_exact_test_first_photo_and_dispatch(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,
 p_generation bigint,p_folder_plan uuid,p_photo_plan uuid,
 p_folder_remote text,p_photo_remote text,
 p_expected_lease_until timestamptz,p_observed_at timestamptz,
 p_proof jsonb,p_request uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_resume_exact_test_first_photo_and_dispatch(
  p_package,p_destination,p_root,p_worker,p_generation,p_folder_plan,
  p_photo_plan,p_folder_remote,p_photo_remote,p_expected_lease_until,
  p_observed_at,p_proof,p_request)
$wrap$;
revoke all on function
 private.service_read_exact_test_first_photo_continuation(uuid,uuid,text),
 public.service_read_exact_test_first_photo_continuation(uuid,uuid,text),
 private.service_resume_exact_test_first_photo_and_dispatch(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid),
 public.service_resume_exact_test_first_photo_and_dispatch(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_read_exact_test_first_photo_continuation(uuid,uuid,text),
 public.service_read_exact_test_first_photo_continuation(uuid,uuid,text),
 private.service_resume_exact_test_first_photo_and_dispatch(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid),
 public.service_resume_exact_test_first_photo_and_dispatch(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid)
 to service_role;
