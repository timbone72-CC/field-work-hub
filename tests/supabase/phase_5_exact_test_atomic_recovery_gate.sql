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
      now(),'GOOGLE_FILE_ID_NOT_FOUND',gen_random_uuid(),gen_random_uuid());
  exception when others then denied:=true;end;
  if not denied then raise exception 'Nonexistent package recovered';end if;

  if (select count(*) from private.client_delivery_test_lease_recoveries)<>before_audit
    or (select count(*) from private.client_delivery_dispatch_permit)<>before_permit
  then raise exception 'Denied atomic TEST request wrote audit/permit';end if;

  raise notice 'Phase 5 exact atomic recovery RPC grants, old bypass denial and no-write failure PASS';
end;
$gate$;
rollback;
