-- Phase 5D: reconcile the ALREADY-ATTEMPTED original TEST parent after a
-- lost worker confirmation. Additive, service-role-only, explicitly TEST bound.
-- No Google CREATE, second lease-recovery audit, new worker/remote identity,
-- auto-send, scheduler, permit release or photo upload.
-- A trusted worker MUST independently GET-verify exactly the saved Google ID
-- immediately before submitting the proof to the atomic commit function.
create function private.service_read_attempted_exact_test_parent(
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
   or permit.request_id is null or ready.organization_id is null
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
   or a.request_id is distinct from permit.request_id
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
 then raise exception 'Existing original TEST parent scope not verified'
    using errcode='42501';end if;
 select * into f from private.client_delivery_parent_maps where id=a.parent_map_id;
 if f.id is null or f.kind<>'ADDRESS' or f.state<>'ATTEMPTED'
   or f.create_attempts<>1 or f.verified_at is not null or f.remote_evidence is not null
   or f.remote_folder_id is distinct from a.remote_folder_id
   or f.parent_remote_id is distinct from p_root
   or f.parent_map_id is not null or f.work_order_id is not null
   or f.organization_id is distinct from k.organization_id
   or f.company_id is distinct from k.company_id
   or f.destination_id is distinct from d.id
   or f.destination_revision is distinct from d.revision
   or f.address_key is distinct from k.folder_address_key
 then raise exception 'Original attempted parent changed'
    using errcode='42501';end if;
 return jsonb_build_object(
  'state','ORIGINAL_ATTEMPTED_PARENT_HELD','package_id',k.id,
  'destination_id',d.id,'root_id',p_root,'worker_id',o.worker_id,
  'generation',o.lease_generation,'attempts',o.attempts,
  'approved_sha256',k.approved_sha256,'request_id',a.request_id,
  'map_id',f.id,'remote_folder_id',f.remote_folder_id,
  'parent_remote_id',f.parent_remote_id,'remote_name',f.remote_name,
  'drive_id',d.verification_receipt->>'shared_drive_id',
  'appProperties',jsonb_build_object(
    'fwh_org',f.organization_id::text,'fwh_company',f.company_id::text,
    'fwh_destination',f.destination_id::text,'fwh_kind',f.kind,
    'fwh_key',f.folder_key));
end;
$read$;
create function public.service_read_attempted_exact_test_parent(
 p_package uuid,p_destination uuid,p_root text
) returns jsonb language sql stable security invoker set search_path='' as $wrap$
 select private.service_read_attempted_exact_test_parent(p_package,p_destination,p_root)
$wrap$;

-- Retain the existing singleton dispatch permit throughout verification.
-- Atomic original-lease renewal and existing parent-confirmation are one
-- transaction, so a lost reply cannot leave only a fresh lease as success.
create function private.service_commit_attempted_exact_test_parent(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,
 p_generation bigint,p_map uuid,p_request uuid,
 p_observed_at timestamptz,p_proof jsonb
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $commit$
declare
 o private.client_delivery_outbox%rowtype;
 f private.client_delivery_parent_maps%rowtype;
 a private.client_delivery_test_lease_recoveries%rowtype;
 permit private.client_delivery_dispatch_permit%rowtype;
 d private.client_delivery_destinations%rowtype;
 k private.client_packages%rowtype;
 ready private.client_delivery_runtime%rowtype;
 last_action private.client_delivery_worker_readiness_actions%rowtype;
 expected jsonb;
 saved jsonb;
 verified jsonb;
begin
 if p_package is null or p_destination is null or p_worker is null
    or p_map is null or p_request is null or p_generation<>1
    or p_observed_at is null
    or p_observed_at>clock_timestamp()
    or p_observed_at<clock_timestamp()-interval '30 seconds'
    or jsonb_typeof(p_proof)<>'object'
 then raise exception 'Fresh exact original-ID provider proof required'
    using errcode='42501';end if;

 -- Lock original outbox, dispatch, parent in consistent ownership order.
 select * into o from private.client_delivery_outbox
    where package_id=p_package for update;
 select * into permit from private.client_delivery_dispatch_permit
    where singleton=true for update;
 select * into a from private.client_delivery_test_lease_recoveries
    where package_id=p_package;
 select * into f from private.client_delivery_parent_maps
    where id=p_map for update;
 if o.package_id is null or o.worker_id is distinct from p_worker
   or o.lease_generation is distinct from p_generation
   or o.state<>'DELIVERING' or o.attempts<>1
   or o.lease_until is null or o.lease_until>=clock_timestamp()
   or o.uncertain_reason is not null or o.destination_id is distinct from p_destination
   or permit.request_id is null or permit.request_id is distinct from p_request
   or a.package_id is null or a.request_id is distinct from p_request
   or a.worker_id is distinct from p_worker or a.lease_generation<>1
   or a.parent_map_id is distinct from p_map
   or a.remote_folder_id is distinct from f.remote_folder_id
   or a.original_lease_until is null
   or f.state<>'ATTEMPTED' or f.create_attempts<>1
   or f.verified_at is not null or f.remote_evidence is not null
 then raise exception 'Original worker, attempt, or held permit changed'
    using errcode='42501';end if;
 -- Recheck every frozen TEST identity and one-use attempted journal.
 saved:=private.service_read_attempted_exact_test_parent(
   p_package,p_destination,p_root);
 if saved->>'state'<>'ORIGINAL_ATTEMPTED_PARENT_HELD'
   or saved->>'worker_id' is distinct from p_worker::text
   or saved->>'map_id' is distinct from p_map::text
   or saved->>'request_id' is distinct from p_request::text
   or saved->>'remote_folder_id' is distinct from a.remote_folder_id
   or saved->>'root_id' is distinct from p_root
 then raise exception 'Original TEST identities no longer match'
    using errcode='42501';end if;

 expected:=jsonb_build_object(
    'id',saved->>'remote_folder_id','parent',saved->>'parent_remote_id',
    'name',saved->>'remote_name','mime','application/vnd.google-apps.folder',
    'trashed',false,'drive_id',saved->>'drive_id',
    'appProperties',saved->'appProperties');
 if p_proof is distinct from expected
 then raise exception 'Original exact provider GET proof mismatch'
    using errcode='42501';end if;
 select * into k from private.client_packages where id=p_package;
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into ready from private.client_delivery_runtime
   where organization_id=k.organization_id for update;
 select * into last_action from private.client_delivery_worker_readiness_actions
   where organization_id=k.organization_id
   order by recorded_at desc,action_id desc limit 1;
 if ready.organization_id is null or not ready.worker_ready
   or ready.worker_identity is null or last_action.action_id is null
   or not last_action.requested_ready
   or last_action.worker_identity is distinct from ready.worker_identity
   or last_action.organization_id is distinct from k.organization_id
   or last_action.destination_id is distinct from p_destination
   or last_action.destination_revision is distinct from d.revision
   or last_action.expected_root_folder_id is distinct from p_root
   or last_action.provider_identity is distinct from d.provider_identity
   or last_action.provider_proof_folder_id is distinct from
       d.verification_receipt->>'proof_folder_id'
   or last_action.verified_probe_result is distinct from
       'TEST_WORKER_CRYPTO_PROVIDER_READ_ONLY'
   or ready.last_verified_at < last_action.recorded_at-interval '1 minute'
 then raise exception 'Original worker readiness evidence changed'
    using errcode='42501';end if;
 -- Same original worker + fresh exact-ID GET; never new readiness actor.
 if ready.last_verified_at<clock_timestamp()-interval '24 hours' then
    update private.client_delivery_runtime set
      last_verified_at=clock_timestamp()
      where organization_id=k.organization_id and worker_ready
        and worker_identity=last_action.worker_identity;
    if not found then raise exception 'Original readiness CAS denied'
      using errcode='40001';end if;
 end if;
 update private.client_delivery_outbox set
   lease_until=clock_timestamp()+interval '2 minutes',
   last_heartbeat_at=clock_timestamp()
   where package_id=p_package and worker_id=p_worker
     and lease_generation=1 and attempts=1 and state='DELIVERING'
     and lease_until=o.lease_until;
 if not found then raise exception 'Original lease renew CAS denied'
   using errcode='40001';end if;
 -- Execute the SAME existing protected confirmation with its intact guard.
 verified:=private.service_confirm_delivery_parent(
    p_package,p_worker,p_generation,p_map,p_proof);
 if verified->>'state'<>'VERIFIED' or verified->>'map_id' is distinct from p_map::text
    or verified->>'replayed' is distinct from 'false'
 then raise exception 'Original provider confirmation not committed'
    using errcode='40001';end if;
 -- The permit is deliberately retained until a separately checked
 -- release by its original owner, after the trusted worker receives this ack.
 return jsonb_build_object('status','ORIGINAL_TEST_PARENT_RECONCILED',
   'package_id',p_package,'worker_id',p_worker,'generation',p_generation,
   'map_id',p_map,'remote_folder_id',a.remote_folder_id,
   'dispatch_id',p_request,'permit_held',true);
end;
$commit$;
create function public.service_commit_attempted_exact_test_parent(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,
 p_generation bigint,p_map uuid,p_request uuid,
 p_observed_at timestamptz,p_proof jsonb
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_commit_attempted_exact_test_parent(
 p_package,p_destination,p_root,p_worker,p_generation,p_map,
 p_request,p_observed_at,p_proof)
$wrap$;

revoke all on function
 private.service_read_attempted_exact_test_parent(uuid,uuid,text),
 public.service_read_attempted_exact_test_parent(uuid,uuid,text),
 private.service_commit_attempted_exact_test_parent(uuid,uuid,text,uuid,bigint,uuid,uuid,timestamptz,jsonb),
 public.service_commit_attempted_exact_test_parent(uuid,uuid,text,uuid,bigint,uuid,uuid,timestamptz,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_read_attempted_exact_test_parent(uuid,uuid,text),
 public.service_read_attempted_exact_test_parent(uuid,uuid,text),
 private.service_commit_attempted_exact_test_parent(uuid,uuid,text,uuid,bigint,uuid,uuid,timestamptz,jsonb),
 public.service_commit_attempted_exact_test_parent(uuid,uuid,text,uuid,bigint,uuid,uuid,timestamptz,jsonb)
 to service_role;
