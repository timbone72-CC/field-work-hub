-- FWH Phase 5D disposable PostgreSQL regression; always ROLLBACK.
-- The original TEST worker/permit/folder are NEVER used by this test.
begin;
do $gate$
declare
  read_private constant text:='private.service_read_attempted_exact_test_parent(uuid,uuid,text)';
  read_public constant text:='public.service_read_attempted_exact_test_parent(uuid,uuid,text)';
  commit_private constant text:='private.service_commit_attempted_exact_test_parent(uuid,uuid,text,uuid,bigint,uuid,uuid,timestamptz,jsonb)';
  commit_public constant text:='public.service_commit_attempted_exact_test_parent(uuid,uuid,text,uuid,bigint,uuid,uuid,timestamptz,jsonb)';
  body text;
  before_audits bigint;
  before_permits bigint;
  before_parent bigint;
  before_receipts bigint;
  denied boolean:=false;
begin
  if to_regprocedure(read_private) is null
    or to_regprocedure(read_public) is null
    or to_regprocedure(commit_private) is null
    or to_regprocedure(commit_public) is null
  then raise exception 'Exact TEST reconciliation SQL owners absent';end if;
  if not has_function_privilege('service_role',read_private,'EXECUTE')
    or not has_function_privilege('service_role',read_public,'EXECUTE')
    or not has_function_privilege('service_role',commit_private,'EXECUTE')
    or not has_function_privilege('service_role',commit_public,'EXECUTE')
    or has_function_privilege('anon',read_private,'EXECUTE')
    or has_function_privilege('anon',read_public,'EXECUTE')
    or has_function_privilege('anon',commit_private,'EXECUTE')
    or has_function_privilege('anon',commit_public,'EXECUTE')
    or has_function_privilege('authenticated',read_private,'EXECUTE')
    or has_function_privilege('authenticated',read_public,'EXECUTE')
    or has_function_privilege('authenticated',commit_private,'EXECUTE')
    or has_function_privilege('authenticated',commit_public,'EXECUTE')
  then raise exception 'Trusted reconciliation RPC privileges broadened';end if;
  body:=pg_get_functiondef(to_regprocedure(commit_private));
  if position('service_read_attempted_exact_test_parent' in body)=0
    or position('service_confirm_delivery_parent' in body)=0
    or position('client_delivery_dispatch_permit' in body)=0
    or position('client_delivery_test_lease_recoveries' in body)=0
    or position('last_heartbeat_at' in body)=0
    or position('clock_timestamp()' in body)=0
    or position('p_observed_at' in body)=0
    or position('p_proof is distinct from expected' in body)=0
    or body !~ 'f[.]create_attempts[[:space:]]*<>[[:space:]]*1'
  then raise exception 'Atomic original-worker/permit/proof/attempt guard missing';end if;

  select count(*) into before_audits from private.client_delivery_test_lease_recoveries;
  select count(*) into before_permits from private.client_delivery_dispatch_permit;
  select count(*) into before_parent from private.client_delivery_parent_maps;
  select count(*) into before_receipts from private.client_delivery_final_receipts;
  begin
    perform private.service_commit_attempted_exact_test_parent(
      gen_random_uuid(),gen_random_uuid(),'synthetic_TEST_root_123456789',
      gen_random_uuid(),1,gen_random_uuid(),gen_random_uuid(),
      clock_timestamp(),'{}'::jsonb);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unknown TEST worker could commit a parent';end if;
  if (select count(*) from private.client_delivery_test_lease_recoveries)<>before_audits
    or (select count(*) from private.client_delivery_dispatch_permit)<>before_permits
    or (select count(*) from private.client_delivery_parent_maps)<>before_parent
    or (select count(*) from private.client_delivery_final_receipts)<>before_receipts
  then raise exception 'Denied TEST reconciliation changed protected ledger';end if;
  raise notice 'Phase 5D original parent source guard, least privilege and no-write denial PASS';
end;
$gate$;
rollback;
