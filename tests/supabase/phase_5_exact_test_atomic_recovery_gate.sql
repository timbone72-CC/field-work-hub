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
-- The installed real inner CAS must revalidate only the ORIGINAL audited
-- worker in the exact one-shot transaction. This runs before the isolated
-- mock CAS below, so source drift is caught by PostgreSQL itself.
do $ready_guard$
declare
  sql_body text:=pg_get_functiondef(
    'private.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)'::regprocedure);
  before_verified timestamptz;
  after_verified timestamptz;
  ready_org uuid;
  denied boolean:=false;
begin
  if position('last_action.requested_ready' in sql_body)=0
    or position('last_action.worker_identity is distinct from ready.worker_identity' in sql_body)=0
    or position('last_action.destination_id is distinct from p_destination' in sql_body)=0
    or position('last_action.destination_revision is distinct from dest.revision' in sql_body)=0
    or position('last_action.provider_identity is distinct from dest.provider_identity' in sql_body)=0
    or position('last_action.expected_root_folder_id is distinct from p_root' in sql_body)=0
    or position('last_action.verified_probe_result is distinct from' in sql_body)=0
    or position('p_observed_at<clock_timestamp()-interval ''30 seconds''' in sql_body)=0
    or position('last_verified_at=clock_timestamp()' in sql_body)=0
    or position('insert into private.client_delivery_test_lease_recoveries' in sql_body)=0
    or position('last_verified_at>=now()-interval ''24 hours''' in sql_body)>0
  then raise exception 'Original same-worker readiness renewal boundary missing';end if;
  select organization_id,last_verified_at into ready_org,before_verified
    from private.client_delivery_runtime order by organization_id limit 1;
  begin
    perform private.service_resume_and_acquire_exact_test_dispatch(
      gen_random_uuid(),gen_random_uuid(),'synthetic_test_root_00000',
      gen_random_uuid(),1,gen_random_uuid(),'synthetic_original_id_00000',
      clock_timestamp()-interval '5 minutes',
      clock_timestamp(),'GOOGLE_FILE_ID_NOT_FOUND',gen_random_uuid());
  exception when others then denied:=true;end;
  if not denied then raise exception 'Unknown TEST identity was revalidated';end if;
  if ready_org is not null then
    select last_verified_at into after_verified from private.client_delivery_runtime
      where organization_id=ready_org;
    if before_verified is distinct from after_verified
    then raise exception 'Denied TEST recovery changed worker readiness';end if;
  end if;
  raise notice 'Original audited worker revalidation guard and denied no-write PASS';
end;
$ready_guard$;
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
    or (select permit.request_id from private.client_delivery_dispatch_permit permit) is distinct from occupied_id
  then raise exception 'Busy dispatch did not roll back consumed recovery';end if;

  delete from private.client_delivery_dispatch_permit permit where permit.request_id=occupied_id;
  proof:=private.service_resume_and_acquire_exact_test_dispatch(
    package_id,destination_id,root_id,worker_id,1,map_id,remote_id,
    now()-interval '1 minute',now(),'GOOGLE_FILE_ID_NOT_FOUND',request_id);
  if proof->>'status'<>'ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED'
    or proof->>'dispatch_id' is distinct from request_id::text
    or (select count(*) from pg_temp.phase5_atomic_marker)<>1
    or (select marker.request_id from pg_temp.phase5_atomic_marker marker) is distinct from request_id
    or (select permit.request_id from private.client_delivery_dispatch_permit permit) is distinct from request_id
  then raise exception 'Atomic lease/permit shared-ID receipt failed';end if;

  denied:=false;
  begin
    perform private.service_resume_and_acquire_exact_test_dispatch(
      package_id,destination_id,root_id,worker_id,1,map_id,remote_id,
      now()-interval '1 minute',now(),'GOOGLE_FILE_ID_NOT_FOUND',request_id);
  exception when insufficient_privilege then denied:=true;end;
  if not denied
    or (select count(*) from pg_temp.phase5_atomic_marker)<>1
    or (select permit.request_id from private.client_delivery_dispatch_permit permit) is distinct from request_id
  then raise exception 'Repeated atomic request changed durable permit or audit';end if;
  raise notice 'Phase 5 atomic CAS/permit rollback on busy slot and shared request UUID PASS (mocked CAS core)';
end;
$transaction_gate$;
rollback;
