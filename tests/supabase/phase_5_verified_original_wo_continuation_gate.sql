-- Phase 5D native SQL guard; disposable CI transaction only.
-- Never touches the operator's original TEST Google folder or ledger.
begin;
do $guard$
declare
  read_private constant text:='private.service_read_verified_exact_test_parent(uuid,uuid,text)';
  read_public constant text:='public.service_read_verified_exact_test_parent(uuid,uuid,text)';
  cas_private constant text:='private.service_resume_verified_original_and_acquire_dispatch(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,jsonb,uuid)';
  cas_public constant text:='public.service_resume_verified_original_and_acquire_dispatch(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,jsonb,uuid)';
  proc text;
  rows_before bigint;
  denied boolean:=false;
begin
  if to_regprocedure(read_private) is null or to_regprocedure(read_public) is null
    or to_regprocedure(cas_private) is null or to_regprocedure(cas_public) is null
    or not has_function_privilege('service_role',read_private,'EXECUTE')
    or not has_function_privilege('service_role',read_public,'EXECUTE')
    or not has_function_privilege('service_role',cas_private,'EXECUTE')
    or not has_function_privilege('service_role',cas_public,'EXECUTE')
    or has_function_privilege('anon',read_private,'EXECUTE')
    or has_function_privilege('anon',read_public,'EXECUTE')
    or has_function_privilege('anon',cas_private,'EXECUTE')
    or has_function_privilege('anon',cas_public,'EXECUTE')
    or has_function_privilege('authenticated',read_private,'EXECUTE')
    or has_function_privilege('authenticated',read_public,'EXECUTE')
    or has_function_privilege('authenticated',cas_private,'EXECUTE')
    or has_function_privilege('authenticated',cas_public,'EXECUTE')
  then raise exception 'Verified-parent TEST continuation privilege boundary changed';end if;
  proc:=pg_get_functiondef(to_regprocedure(cas_private));
  if position('service_read_verified_exact_test_parent' in proc)=0
    or position('client_delivery_test_verified_parent_continuations' in proc)=0
    or position('service_acquire_delivery_dispatch' in proc)=0
    or position('p_proof' in proc)=0
    or position('remote_evidence' in proc)=0
    or position('lease_until' in proc)=0
    or position('p_observed_at' in proc)=0
    or position('clock_timestamp()' in proc)=0
    or position('p_worker' in proc)=0
  then raise exception 'Original worker, frozen Google proof or atomic permit missing';end if;
  if (select count(*) from information_schema.tables
     where table_schema='private'
       and table_name='client_delivery_test_verified_parent_continuations')<>1
  then raise exception 'Exactly one private continuation journal required';end if;
  select count(*) into rows_before from private.client_delivery_test_verified_parent_continuations;
  begin
    perform private.service_resume_verified_original_and_acquire_dispatch(
      gen_random_uuid(),gen_random_uuid(),'disposable_test_root_12345',
      gen_random_uuid(),1,gen_random_uuid(),'disposable_remote_12345',
      clock_timestamp()-interval '2 minutes',clock_timestamp(),
      '{}'::jsonb,gen_random_uuid());
  exception when insufficient_privilege or serialization_failure then denied:=true;end;
  if not denied then raise exception 'Unrelated worker unexpectedly resumed delivery';end if;
  if (select count(*) from private.client_delivery_test_verified_parent_continuations)<>rows_before
  then raise exception 'Denied continuation wrote journal';end if;
  raise notice 'PASS: original verified TEST lease singleflight remains service-only, exact and no-write on denial';
end;
$guard$;
rollback;
