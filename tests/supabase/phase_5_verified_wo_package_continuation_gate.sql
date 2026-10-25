-- Rollback-only native TEST PACKAGE original-lease and grants gate.
begin;
do $gate$
declare
 rd_p constant text:='private.service_read_verified_original_test_wo_for_package(uuid,uuid,text)';
 rd_u constant text:='public.service_read_verified_original_test_wo_for_package(uuid,uuid,text)';
 wr_p constant text:='private.service_resume_verified_wo_and_acquire_package_dispatch(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,jsonb,uuid)';
 wr_u constant text:='public.service_resume_verified_wo_and_acquire_package_dispatch(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,jsonb,uuid)';
 n text; source text; count_before bigint; denied boolean:=false;
begin
 foreach n in array array[rd_p,rd_u,wr_p,wr_u] loop
  if to_regprocedure(n) is null
   or not has_function_privilege('service_role',n,'EXECUTE')
   or has_function_privilege('anon',n,'EXECUTE')
   or has_function_privilege('authenticated',n,'EXECUTE')
  then raise exception 'PACKAGE continuation role boundary changed: %',n;end if;
 end loop;
 if not (select relrowsecurity from pg_class where oid='private.client_delivery_test_verified_wo_continuations'::regclass)
   or has_table_privilege('authenticated','private.client_delivery_test_verified_wo_continuations','SELECT')
   or has_table_privilege('service_role','private.client_delivery_test_verified_wo_continuations','INSERT')
 then raise exception 'One-use journal direct access allowed';end if;
 source:=pg_get_functiondef(to_regprocedure(wr_p));
 if position('service_read_verified_original_test_wo_for_package' in source)=0
   or position('client_delivery_test_verified_wo_continuations' in source)=0
   or position('service_acquire_delivery_dispatch' in source)=0
   or position('p_expected_lease_until' in source)=0
   or position('p_proof' in source)=0
 then raise exception 'Original worker, proof or atomic dispatch missing';end if;
 select count(*) into count_before from private.client_delivery_test_verified_wo_continuations;
 begin
  perform private.service_resume_verified_wo_and_acquire_package_dispatch(
   gen_random_uuid(),gen_random_uuid(),'disposable_test_root_12345',
   gen_random_uuid(),1,gen_random_uuid(),'disposable_wo_remote_12345',
   clock_timestamp()-interval '2 minutes',clock_timestamp(),'{}'::jsonb,gen_random_uuid());
 exception when insufficient_privilege or serialization_failure then denied:=true;end;
 if not denied then raise exception 'Unknown worker allowed to resume';end if;
 if (select count(*) from private.client_delivery_test_verified_wo_continuations)<>count_before
 then raise exception 'Denied operation wrote a continuation';end if;
 raise notice 'PASS: original WORK_ORDER PACKAGE lease and SQL protections';
end;
$gate$;
rollback;
