-- Phase 5D: TEST-only expired original lease + dispatch permit in ONE transaction.
-- SOURCE ONLY. No worker hosting, Google write, scheduler, customer Send or cleanup.
-- A provider GET-404 remains required by the trusted coordinator immediately
-- before this RPC; the database rechecks its 30-second proof and original IDs.
-- Any failed permit acquisition RAISES, rolling back the lease and audit.
create function private.service_resume_and_acquire_exact_test_dispatch(
  p_package uuid,p_destination uuid,p_root text,p_worker uuid,
  p_generation bigint,p_map uuid,p_remote_id text,
  p_expected_lease_until timestamptz,p_observed_at timestamptz,
  p_probe_result text,p_request uuid
)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $atomic$
declare
  resumed jsonb;
  permitted jsonb;
begin
  if p_request is null then
    raise exception 'Original TEST recovery/dispatch request ID required'
      using errcode='22023';
  end if;

  -- Existing private CAS owns every immutable package, worker, generation,
  -- destination, reserved folder and read-only provider-proof check.
  resumed:=private.service_resume_exact_test_expired_delivery(
    p_package,p_destination,p_root,p_worker,p_generation,p_map,
    p_remote_id,p_expected_lease_until,p_observed_at,p_probe_result,p_request);
  if resumed->>'status' is distinct from 'ORIGINAL_TEST_LEASE_RESUMED'
    or resumed->>'package_id' is distinct from p_package::text
    or resumed->>'worker_id' is distinct from p_worker::text
    or resumed->>'map_id' is distinct from p_map::text
    or resumed->>'remote_folder_id' is distinct from p_remote_id
  then
    raise exception 'Original TEST recovery confirmation uncertain'
      using errcode='40001';
  end if;

  -- Audit and persistent permit share the SAME immutable request UUID.
  -- The existing global non-expiring permit owner arbitrates every worker.
  -- This is the SAME SQL transaction as the one-use recovery above; if
  -- another worker holds the slot, ALL recovery mutations are rolled back.
  permitted:=private.service_acquire_delivery_dispatch(p_request);
  if permitted->>'acquired' is distinct from 'true' then
    raise exception 'Dispatch occupied; TEST recovery rolled back'
      using errcode='42501';
  end if;

  return resumed || jsonb_build_object(
    'status','ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED',
    'dispatch_id',p_request);
end;
$atomic$;

-- Public invoker wrapper only for a service-role JWT, never an Admin/phone.
create function public.service_resume_and_acquire_exact_test_dispatch(
  p_package uuid,p_destination uuid,p_root text,p_worker uuid,
  p_generation bigint,p_map uuid,p_remote_id text,
  p_expected_lease_until timestamptz,p_observed_at timestamptz,
  p_probe_result text,p_request uuid
)
returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_resume_and_acquire_exact_test_dispatch(
    p_package,p_destination,p_root,p_worker,p_generation,p_map,
    p_remote_id,p_expected_lease_until,p_observed_at,p_probe_result,
    p_request)
$wrap$;

-- Retire the old service-visible two-step CAS; only the combined operation
-- may resume this specific expired TEST lease. Private function remains
-- callable only by its function owner within the new atomic transaction.
revoke execute on function
  private.service_resume_exact_test_expired_delivery(
    uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid),
  public.service_resume_exact_test_expired_delivery(
    uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)
  from public,anon,authenticated,service_role;

revoke all on function
  private.service_resume_and_acquire_exact_test_dispatch(
    uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid),
  public.service_resume_and_acquire_exact_test_dispatch(
    uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function
  private.service_resume_and_acquire_exact_test_dispatch(
    uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid),
  public.service_resume_and_acquire_exact_test_dispatch(
    uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)
  to service_role;
