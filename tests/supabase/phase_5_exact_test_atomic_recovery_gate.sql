-- Phase 5D disposable PostgreSQL 17 source gate. All effects ROLLBACK.
-- Assert only trusted service-role can invoke the unified CAS/permit owner.
begin;
set local timezone='UTC';
do $gate$
declare
  combined text:='public.service_resume_and_acquire_exact_test_dispatch(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)';
  old_api text:='public.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)';
  denied boolean;
  before_audit bigint;
  before_permit bigint;
begin
  if to_regprocedure(combined) is null
    or to_regprocedure(old_api) is null
    or not has_function_privilege('service_role',combined,'EXECUTE')
    or has_function_privilege('anon',combined,'EXECUTE')
    or has_function_privilege('authenticated',combined,'EXECUTE')
    or has_function_privilege('service_role',old_api,'EXECUTE')
    or has_function_privilege('anon',old_api,'EXECUTE')
    or has_function_privilege('authenticated',old_api,'EXECUTE')
    or has_function_privilege('service_role',
      'private.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)','EXECUTE')
  then raise exception 'Atomic recovery service-role-only grant or old bypass failed';end if;

  select count(*) into before_audit from private.client_delivery_test_lease_recoveries;
  select count(*) into before_permit from private.client_delivery_dispatch_permit;

  -- Without the original frozen TEST record the normal private CAS must
  -- deny; a caller cannot acquire a dispatch permit with arbitrary identity.
  denied:=false;
  begin
    perform private.service_resume_and_acquire_exact_test_dispatch(
      gen_random_uuid(),gen_random_uuid(),'unused_test_root',gen_random_uuid(),
      1,gen_random_uuid(),'unused_remote_id',now()-interval '1 minute',
      now(),'GOOGLE_FILE_ID_NOT_FOUND',gen_random_uuid());
  exception when others then denied:=true;end;
  if not denied then raise exception 'Nonexistent package recovered';end if;

  if (select count(*) from private.client_delivery_test_lease_recoveries)<>before_audit
    or (select count(*) from private.client_delivery_dispatch_permit)<>before_permit
  then raise exception 'Denied atomic TEST request wrote audit/permit';end if;

  raise notice 'Phase 5 exact atomic recovery RPC grants, old bypass denial and no-write failure PASS';
end;
$gate$;
-- Disposable boundary unit test: temporarily replace only the inner expired
-- lease CAS inside this rollback transaction with an isolated marker stub.
-- The real CAS invariants retain their own independent SQL/worker tests.
-- This proves native PostgreSQL transaction rollback when the permit is busy,
-- and one committed request UUID when both operations succeed.
create temporary table phase5_atomic_marker(request_id uuid not null);
create or replace function private.service_resume_exact_test_expired_delivery(
  p_package uuid,p_destination uuid,p_root text,p_worker uuid,
  p_generation bigint,p_map uuid,p_remote_id text,
  p_expected_lease_until timestamptz,p_observed_at timestamptz,
  p_probe_result text,p_request uuid
)
returns jsonb language plpgsql security definer set search_path='' as $mock$
begin
  insert into pg_temp.phase5_atomic_marker(request_id) values(p_request);
  return jsonb_build_object('status','ORIGINAL_TEST_LEASE_RESUMED',
    'package_id',p_package,'worker_id',p_worker,
    'generation',p_generation,'map_id',p_map,
    'remote_folder_id',p_remote_id,
    'expires_at',clock_timestamp()+interval '2 minutes');
end;
$mock$;

do $transaction_gate$
declare
  package_id uuid:=gen_random_uuid();
  destination_id uuid:=gen_random_uuid();
  worker_id uuid:=gen_random_uuid();
  map_id uuid:=gen_random_uuid();
  request_id uuid:=gen_random_uuid();
  occupied_id uuid:=gen_random_uuid();
  remote_id text:='original_test_folder_0123456789';
  root_id text:='original_test_root_0123456789';
  proof jsonb;
  denied boolean:=false;
begin
  if exists(select 1 from private.client_delivery_dispatch_permit)
    or exists(select 1 from pg_temp.phase5_atomic_marker)
  then raise exception 'Atomic TEST fixture requires an empty dispatch slot';end if;

  insert into private.client_delivery_dispatch_permit(singleton,request_id)
    values(true,occupied_id);
  begin
    perform private.service_resume_and_acquire_exact_test_dispatch(
      package_id,destination_id,root_id,worker_id,1,map_id,remote_id,
      now()-interval '1 minute',now(),'GOOGLE_FILE_ID_NOT_FOUND',request_id);
  exception when insufficient_privilege then denied:=true;end;
  if not denied
    or exists(select 1 from pg_temp.phase5_atomic_marker)
    or (select request_id from private.client_delivery_dispatch_permit) is distinct from occupied_id
  then raise exception 'Busy dispatch did not roll back consumed recovery';end if;

  delete from private.client_delivery_dispatch_permit where request_id=occupied_id;
  proof:=private.service_resume_and_acquire_exact_test_dispatch(
    package_id,destination_id,root_id,worker_id,1,map_id,remote_id,
    now()-interval '1 minute',now(),'GOOGLE_FILE_ID_NOT_FOUND',request_id);
  if proof->>'status'<>'ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED'
    or proof->>'dispatch_id' is distinct from request_id::text
    or (select count(*) from pg_temp.phase5_atomic_marker)<>1
    or (select request_id from pg_temp.phase5_atomic_marker) is distinct from request_id
    or (select request_id from private.client_delivery_dispatch_permit) is distinct from request_id
  then raise exception 'Atomic lease/permit shared-ID receipt failed';end if;

  denied:=false;
  begin
    perform private.service_resume_and_acquire_exact_test_dispatch(
      package_id,destination_id,root_id,worker_id,1,map_id,remote_id,
      now()-interval '1 minute',now(),'GOOGLE_FILE_ID_NOT_FOUND',request_id);
  exception when insufficient_privilege then denied:=true;end;
  if not denied
    or (select count(*) from pg_temp.phase5_atomic_marker)<>1
    or (select request_id from private.client_delivery_dispatch_permit) is distinct from request_id
  then raise exception 'Repeated atomic request changed durable permit or audit';end if;
  raise notice 'Phase 5 atomic CAS/permit rollback on busy slot and shared request UUID PASS (mocked CAS core)';
end;
$transaction_gate$;
rollback;
