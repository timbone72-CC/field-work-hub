-- Phase 5D single-use, original-worker continuation AFTER the exact ADDRESS
-- folder was independently GET-verified and durably committed.
-- Source only. No general lease takeover, retry scheduler, customer Send,
-- new package/worker/generation, edited remote parent or photo cleanup.
create table private.client_delivery_test_verified_parent_continuations (
 package_id uuid primary key references private.client_packages(id),
 worker_id uuid not null,
 lease_generation bigint not null check (lease_generation=1),
 original_lease_until timestamptz not null,
 parent_map_id uuid not null references private.client_delivery_parent_maps(id),
 remote_folder_id text not null,
 request_id uuid not null unique,
 observed_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.client_delivery_test_verified_parent_continuations enable row level security;
revoke all on table private.client_delivery_test_verified_parent_continuations
 from public,anon,authenticated,service_role;

create function private.service_read_verified_exact_test_parent(
 p_package uuid,p_destination uuid,p_root text
) returns jsonb language plpgsql stable security definer set search_path=''
set lock_timeout='5s' as $read$
declare
 k private.client_packages%rowtype;
 o private.client_delivery_outbox%rowtype;
 d private.client_delivery_destinations%rowtype;
 f private.client_delivery_parent_maps%rowtype;
 a private.client_delivery_test_lease_recoveries%rowtype;
 permit private.client_delivery_dispatch_permit%rowtype;
 ready private.client_delivery_runtime%rowtype;
 member_count bigint;
begin
 select * into k from private.client_packages where id=p_package;
 select * into o from private.client_delivery_outbox where package_id=p_package;
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into a from private.client_delivery_test_lease_recoveries
  where package_id=p_package;
 select * into permit from private.client_delivery_dispatch_permit where singleton=true;
 select * into ready from private.client_delivery_runtime
  where organization_id=k.organization_id;
 select count(*) into member_count from private.client_package_photos where package_id=p_package;
 if k.id is null or o.package_id is null or d.id is null or a.package_id is null
   or permit.request_id is not null or ready.organization_id is null
   or k.status<>'DELIVERING' or o.state<>'DELIVERING'
   or k.destination_id is distinct from d.id or o.destination_id is distinct from d.id
   or d.organization_id is distinct from k.organization_id
   or d.company_id is distinct from k.company_id
   or d.provider<>'GOOGLE_DRIVE' or not d.active or not d.verified
   or d.root_folder_id is distinct from p_root
   or d.revision::text is distinct from k.approved_manifest->>'destination_revision'
   or k.approved_manifest->>'destination_root' is distinct from p_root
   or k.approved_manifest->>'package_id' is distinct from k.id::text
   or k.approved_manifest->>'destination_id' is distinct from d.id::text
   or coalesce(k.approved_manifest->>'folder_layout','ADDRESS_WORK_ORDER')<>'ADDRESS_WORK_ORDER'
   or k.approved_sha256 is null or o.approved_sha256 is distinct from k.approved_sha256
   or jsonb_typeof(k.approved_manifest->'selected_photos')<>'array'
   or jsonb_array_length(k.approved_manifest->'selected_photos')<>2
   or member_count<>2 or o.worker_id is null
   or o.worker_id is distinct from a.worker_id or o.lease_generation<>1
   or a.lease_generation<>1 or o.attempts<>1 or o.uncertain_reason is not null
   or o.lease_until is null or o.lease_until>=clock_timestamp()
   or a.original_lease_until>=a.recorded_at
   or a.request_id is null
   or exists(select 1 from private.client_delivery_test_verified_parent_continuations v where v.package_id=p_package)
   or a.observed_at is null or a.remote_folder_id is null
   or a.parent_map_id is null or a.recorded_at is null
   or not ready.worker_ready or ready.worker_identity is null
   or d.verification_receipt->>'shared_drive_id' is null
   or exists(select 1 from private.client_delivery_outbox x
      where x.package_id<>p_package and x.state='DELIVERING')
   or exists(select 1 from private.client_delivery_file_plans x
      where x.package_id=p_package)
   or exists(select 1 from private.client_delivery_upload_sessions x
      where x.package_id=p_package)
   or exists(select 1 from private.client_delivery_final_receipts x
      where x.package_id=p_package)
   or not exists(
      select 1 from public.work_orders w
      join private.client_companies c on c.id=k.company_id
        and c.organization_id=k.organization_id
      where w.id=k.work_order_id and w.organization_id=k.organization_id
        and w.client_company_id=k.company_id
        and w.wo_number='TEST-0003-DASHBOARD'
        and c.name='FWH TEST CLIENT' and c.active)
 then raise exception 'Existing verified original TEST parent scope not verified'
    using errcode='42501';end if;
 select * into f from private.client_delivery_parent_maps where id=a.parent_map_id;
 if f.id is null or f.kind<>'ADDRESS' or f.state<>'VERIFIED'
   or f.create_attempts<>1 or f.verified_at is null or f.remote_evidence is null
   or f.remote_folder_id is distinct from a.remote_folder_id
   or f.parent_remote_id is distinct from p_root
   or f.parent_map_id is not null or f.work_order_id is not null
   or f.organization_id is distinct from k.organization_id
   or f.company_id is distinct from k.company_id
   or f.destination_id is distinct from d.id
   or f.destination_revision is distinct from d.revision
   or f.address_key is distinct from k.folder_address_key
   or exists(select 1 from private.client_delivery_parent_maps next
     where next.kind='WORK_ORDER' and next.organization_id=f.organization_id
      and next.company_id=f.company_id and next.destination_id=f.destination_id
      and next.destination_revision=f.destination_revision
      and next.work_order_id=k.work_order_id)
 then raise exception 'Original verified parent or descendant changed'
    using errcode='42501';end if;
 return jsonb_build_object(
  'state','ORIGINAL_VERIFIED_PARENT_EXPIRED','package_id',k.id,
  'destination_id',d.id,'root_id',p_root,'worker_id',o.worker_id,
  'generation',o.lease_generation,'attempts',o.attempts,
  'approved_sha256',k.approved_sha256,'request_id',a.request_id,
  'map_id',f.id,'remote_folder_id',f.remote_folder_id,
  'parent_remote_id',f.parent_remote_id,'remote_name',f.remote_name,
  'drive_id',d.verification_receipt->>'shared_drive_id',
  'lease_until',o.lease_until,'remote_evidence',f.remote_evidence,
  'appProperties',jsonb_build_object(
    'fwh_org',f.organization_id::text,'fwh_company',f.company_id::text,
    'fwh_destination',f.destination_id::text,'fwh_kind',f.kind,
    'fwh_key',f.folder_key));
end;
$read$;

create function public.service_read_verified_exact_test_parent(
 p_package uuid,p_destination uuid,p_root text
) returns jsonb language sql stable security invoker set search_path='' as $wrap$
 select private.service_read_verified_exact_test_parent(p_package,p_destination,p_root)
$wrap$;

-- One SQL transaction: retain exact original worker, reverify its immutable
-- durable parent receipt, renew only that expired lease, journal this one
-- continuation and acquire the global non-expiring dispatch permit.
-- A failed or lost permit acquisition rolls everything back.
create function private.service_resume_verified_original_and_acquire_dispatch(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,
 p_generation bigint,p_map uuid,p_remote_id text,
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
 saved jsonb;
 lease_end timestamptz;
 permit jsonb;
begin
 if p_package is null or p_destination is null or p_worker is null
   or p_map is null or p_request is null or p_remote_id is null
   or p_generation<>1 or p_expected_lease_until is null
   or p_observed_at is null or p_observed_at>clock_timestamp()
   or p_observed_at<clock_timestamp()-interval '30 seconds'
   or jsonb_typeof(p_proof)<>'object'
 then raise exception 'Fresh original verified-parent provider proof required'
   using errcode='42501';end if;

 select * into o from private.client_delivery_outbox
   where package_id=p_package for update;
 if o.package_id is null or o.state<>'DELIVERING'
   or o.worker_id is distinct from p_worker
   or o.lease_generation is distinct from p_generation
   or o.attempts<>1 or o.uncertain_reason is not null
   or o.lease_until is distinct from p_expected_lease_until
   or o.lease_until>=clock_timestamp()
   or o.destination_id is distinct from p_destination
 then raise exception 'Only expired original TEST lease may continue'
   using errcode='40001';end if;

 saved:=private.service_read_verified_exact_test_parent(
   p_package,p_destination,p_root);
 if saved->>'state' is distinct from 'ORIGINAL_VERIFIED_PARENT_EXPIRED'
   or saved->>'worker_id' is distinct from p_worker::text
   or saved->>'map_id' is distinct from p_map::text
   or saved->>'remote_folder_id' is distinct from p_remote_id
   or saved->>'lease_until' is null
   or (saved->>'lease_until')::timestamptz is distinct from p_expected_lease_until
   or saved->>'root_id' is distinct from p_root
   or saved->'remote_evidence' is distinct from p_proof
   or p_proof->>'id' is distinct from p_remote_id
   or p_proof->>'parent' is distinct from p_root
   or p_proof->>'mime' is distinct from 'application/vnd.google-apps.folder'
   or p_proof->>'trashed' is distinct from 'false'
   or p_proof->>'name' is distinct from saved->>'remote_name'
   or p_proof->>'drive_id' is distinct from saved->>'drive_id'
   or p_proof->'appProperties' is distinct from saved->'appProperties'
   or p_proof->'sha256'<>'null'::jsonb or p_proof->'size'<>'null'::jsonb
 then raise exception 'Exact original Google receipt / frozen IDs changed'
   using errcode='42501';end if;

 select * into k from private.client_packages where id=p_package;
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into rt from private.client_delivery_runtime
   where organization_id=k.organization_id for update;
 select * into action from private.client_delivery_worker_readiness_actions a
   where a.organization_id=k.organization_id
   order by a.recorded_at desc,a.action_id desc limit 1;
 if rt.organization_id is null or not rt.worker_ready or rt.worker_identity is null
   or action.action_id is null or not action.requested_ready
   or action.worker_identity is distinct from rt.worker_identity
   or action.destination_id is distinct from d.id
   or action.destination_revision is distinct from d.revision
   or action.expected_root_folder_id is distinct from p_root
   or action.provider_identity is distinct from d.provider_identity
   or action.provider_proof_folder_id is distinct from d.verification_receipt->>'proof_folder_id'
   or action.verified_probe_result is distinct from 'TEST_WORKER_CRYPTO_PROVIDER_READ_ONLY'
   or rt.last_verified_at < action.recorded_at-interval '1 minute'
 then raise exception 'Original audited TEST worker readiness changed'
   using errcode='42501';end if;
 if rt.last_verified_at<clock_timestamp()-interval '24 hours' then
   update private.client_delivery_runtime set last_verified_at=clock_timestamp()
   where organization_id=k.organization_id and worker_ready
     and worker_identity=action.worker_identity;
   if not found then raise exception 'Original readiness renewal denied'
     using errcode='40001';end if;
 end if;

 insert into private.client_delivery_test_verified_parent_continuations(
  package_id,worker_id,lease_generation,original_lease_until,
  parent_map_id,remote_folder_id,request_id,observed_at)
 values(p_package,p_worker,p_generation,p_expected_lease_until,
  p_map,p_remote_id,p_request,p_observed_at);

 update private.client_delivery_outbox
  set lease_until=clock_timestamp()+interval '2 minutes',
      last_heartbeat_at=clock_timestamp()
  where package_id=p_package and worker_id=p_worker and lease_generation=1
    and attempts=1 and state='DELIVERING' and lease_until=p_expected_lease_until
  returning lease_until into lease_end;
 if lease_end is null then raise exception 'Original TEST lease renewal CAS denied'
   using errcode='40001';end if;

 permit:=private.service_acquire_delivery_dispatch(p_request);
 if permit->>'acquired' is distinct from 'true' then
   raise exception 'Dispatch occupied: whole TEST continuation rolled back'
     using errcode='42501';end if;
 return jsonb_build_object('status','ORIGINAL_VERIFIED_PARENT_LEASE_AND_DISPATCH_ACQUIRED',
  'package_id',p_package,'worker_id',p_worker,'generation',p_generation,
  'map_id',p_map,'remote_folder_id',p_remote_id,'dispatch_id',p_request,
  'expires_at',lease_end);
end;
$resume$;

create function public.service_resume_verified_original_and_acquire_dispatch(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,
 p_generation bigint,p_map uuid,p_remote_id text,
 p_expected_lease_until timestamptz,p_observed_at timestamptz,
 p_proof jsonb,p_request uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_resume_verified_original_and_acquire_dispatch(
 p_package,p_destination,p_root,p_worker,p_generation,p_map,
 p_remote_id,p_expected_lease_until,p_observed_at,p_proof,p_request)
$wrap$;

revoke all on function
 private.service_read_verified_exact_test_parent(uuid,uuid,text),
 public.service_read_verified_exact_test_parent(uuid,uuid,text),
 private.service_resume_verified_original_and_acquire_dispatch(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,jsonb,uuid),
 public.service_resume_verified_original_and_acquire_dispatch(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,jsonb,uuid)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_read_verified_exact_test_parent(uuid,uuid,text),
 public.service_read_verified_exact_test_parent(uuid,uuid,text),
 private.service_resume_verified_original_and_acquire_dispatch(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,jsonb,uuid),
 public.service_resume_verified_original_and_acquire_dispatch(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,jsonb,uuid)
 to service_role;
