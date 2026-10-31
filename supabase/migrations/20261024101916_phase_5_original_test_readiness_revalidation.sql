-- Phase 5D: reconcile expired readiness with the approved original TEST worker
-- in the EXISTING atomic original-lease/dispatch transaction (SOURCE ONLY).
-- No new endpoint, worker/lease/Drive ID, key change, general activation,
-- photo write, scheduler, cleanup or customer delivery.
-- A fresh original-ID Drive GET-404 (<30s) is required by existing worker.
-- The single-use immutable recovery audit is also the revalidation journal:
-- failed RPC/permit and ambiguous outcomes never authorize another attempt.
create or replace function private.service_resume_exact_test_expired_delivery(
  p_package uuid,p_destination uuid,p_root text,p_worker uuid,
  p_generation bigint,p_map uuid,p_remote_id text,
  p_expected_lease_until timestamptz,p_observed_at timestamptz,
  p_probe_result text,p_request uuid
)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $resume$
declare
  o private.client_delivery_outbox%rowtype;
  verified jsonb;
  lease_end timestamptz;
  original_org uuid;
  ready private.client_delivery_runtime%rowtype;
  last_action private.client_delivery_worker_readiness_actions%rowtype;
  dest private.client_delivery_destinations%rowtype;
begin
  if p_worker is null or p_map is null or p_request is null
    or p_generation<>1 or p_remote_id is null
    or p_probe_result is distinct from 'GOOGLE_FILE_ID_NOT_FOUND'
    or p_expected_lease_until is null or p_observed_at is null
    or p_observed_at>clock_timestamp()
    or p_observed_at<clock_timestamp()-interval '30 seconds'
  then raise exception 'Current same-ID provider absence proof required'
    using errcode='42501'; end if;
  -- Serialize renewal with all original service_delivery_guard transactions.
  select * into o from private.client_delivery_outbox
    where package_id=p_package for update;
  if o.package_id is null or o.state<>'DELIVERING'
    or o.worker_id is distinct from p_worker
    or o.lease_generation is distinct from p_generation
    or o.attempts<>1 or o.lease_until is distinct from p_expected_lease_until
    or o.lease_until >= clock_timestamp() or o.uncertain_reason is not null
  then raise exception 'Expired original lease changed; deny recovery'
    using errcode='40001'; end if;

  verified:=private.service_read_expired_test_delivery_reservation(
    p_package,p_destination,p_root);
  if verified->>'state'<>'EXPIRED_RESERVED_PARENT'
    or verified->>'worker_id' is distinct from p_worker::text
    or (verified->>'generation')::bigint is distinct from p_generation
    or verified->'parent'->>'map_id' is distinct from p_map::text
    or verified->'parent'->>'remote_folder_id' is distinct from p_remote_id
    or (verified->>'lease_until')::timestamptz is distinct from p_expected_lease_until
  then raise exception 'Original TEST identity changed'
    using errcode='42501'; end if;

  -- Lock the immutable parent record before recording the one-shot recovery.
  perform 1 from private.client_delivery_parent_maps
    where id=p_map and remote_folder_id=p_remote_id and state='RESERVED'
      and create_attempts=0 and verified_at is null and remote_evidence is null
    for update;
  if not found then raise exception 'Original reserved remote ID changed'
    using errcode='40001'; end if;

  -- Existing worker was registered via the audited one-time readiness owner.
  -- This request is freshly backed by Google about/root and original-ID GET.
  -- Revalidate the ORIGINAL identity only in the one-shot recovery transaction.
  select k.organization_id into original_org
    from private.client_packages k where k.id=p_package;
  select * into ready from private.client_delivery_runtime
    where organization_id=original_org for update;
  select * into dest from private.client_delivery_destinations
    where id=p_destination and organization_id=original_org;
  select * into last_action from private.client_delivery_worker_readiness_actions a
    where a.organization_id=original_org
    order by a.recorded_at desc,a.action_id desc limit 1;
  if original_org is null or ready.organization_id is null
    or not ready.worker_ready or ready.worker_identity is null
    or ready.last_verified_at is null
    or dest.id is null or not dest.active or not dest.verified
    or dest.root_folder_id is distinct from p_root
    or last_action.action_id is null or not last_action.requested_ready
    or last_action.destination_id is distinct from p_destination
    or last_action.organization_id is distinct from original_org
    or last_action.destination_revision is distinct from dest.revision
    or last_action.provider_identity is distinct from dest.provider_identity
    or last_action.expected_root_folder_id is distinct from p_root
    or last_action.provider_proof_folder_id is distinct from
      dest.verification_receipt->>'proof_folder_id'
    or last_action.worker_identity is distinct from ready.worker_identity
    or last_action.verified_probe_result is distinct from
      'TEST_WORKER_CRYPTO_PROVIDER_READ_ONLY'
    or ready.last_verified_at < last_action.recorded_at-interval '1 minute'
  then raise exception 'Original audited worker readiness cannot revalidate'
    using errcode='42501'; end if;

  -- Expired readiness is reverified ONLY as part of the immutable,
  -- single-use original TEST recovery audit + global dispatch permit.
  -- Failures of any CAS, proof or permit roll this timestamp back.
  if ready.last_verified_at < clock_timestamp()-interval '24 hours' then
    update private.client_delivery_runtime
      set last_verified_at=clock_timestamp()
      where organization_id=original_org and worker_ready
        and worker_identity=last_action.worker_identity;
    if not found then raise exception 'Original worker readiness CAS failed'
      using errcode='40001'; end if;
  end if;

  insert into private.client_delivery_test_lease_recoveries(
    package_id,worker_id,lease_generation,original_lease_until,
    parent_map_id,remote_folder_id,observed_at,request_id
  ) values (p_package,p_worker,p_generation,p_expected_lease_until,
    p_map,p_remote_id,p_observed_at,p_request);

  update private.client_delivery_outbox
    set lease_until=clock_timestamp()+interval '2 minutes',
        last_heartbeat_at=clock_timestamp()
    where package_id=p_package and worker_id=p_worker
      and lease_generation=p_generation and attempts=1
      and state='DELIVERING' and lease_until=p_expected_lease_until
    returning lease_until into lease_end;
  if lease_end is null
  then raise exception 'Original lease recovery CAS failed' using errcode='40001'; end if;

  return jsonb_build_object('status','ORIGINAL_TEST_LEASE_RESUMED',
    'package_id',p_package,'worker_id',p_worker,'generation',p_generation,
    'map_id',p_map,'remote_folder_id',p_remote_id,'expires_at',lease_end);
end;
$resume$;


-- Keep the old standalone expired-lease CAS unreachable by service_role:
-- the existing combined lease+dispatch function remains the sole owner.
revoke all on function private.service_resume_exact_test_expired_delivery(
  uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid
) from public,anon,authenticated,service_role;
