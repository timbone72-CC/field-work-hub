-- Rollback-only native security + original-worker first-photo denial gate.
begin;
do $gate$
declare
 rd_p constant text:='private.service_read_exact_test_first_photo_continuation(uuid,uuid,text)';
 rd_u constant text:='public.service_read_exact_test_first_photo_continuation(uuid,uuid,text)';
 wr_p constant text:='private.service_resume_exact_test_first_photo_and_dispatch(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid)';
 wr_u constant text:='public.service_resume_exact_test_first_photo_and_dispatch(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid)';
 n text; def text; before_count bigint; denies boolean:=false;
begin
 foreach n in array array[rd_p,rd_u,wr_p,wr_u] loop
   if to_regprocedure(n) is null
     or not has_function_privilege('service_role',n,'EXECUTE')
     or has_function_privilege('anon',n,'EXECUTE')
     or has_function_privilege('authenticated',n,'EXECUTE')
   then raise exception 'First-photo original-worker function grant mismatch: %',n;end if;
 end loop;
 if not (select relrowsecurity from pg_class
   where oid='private.client_delivery_test_first_photo_continuations'::regclass)
  or has_table_privilege('anon','private.client_delivery_test_first_photo_continuations','SELECT')
  or has_table_privilege('authenticated','private.client_delivery_test_first_photo_continuations','SELECT')
  or has_table_privilege('service_role','private.client_delivery_test_first_photo_continuations','INSERT')
 then raise exception 'First-photo private journal is exposed';end if;
 def:=pg_get_functiondef(to_regprocedure(wr_p));
 if position('service_read_exact_test_first_photo_continuation' in def)=0
  or position('client_delivery_test_first_photo_continuations' in def)=0
  or position('service_acquire_delivery_dispatch' in def)=0
  or position('p_expected_lease_until' in def)=0
  or position('p_proof' in def)=0
 then raise exception 'First-photo CAS does not guard original proof/lease/permit';end if;
 select count(*) into before_count from private.client_delivery_test_first_photo_continuations;
 begin
  perform private.service_resume_exact_test_first_photo_and_dispatch(
    gen_random_uuid(),gen_random_uuid(),'disposable_test_root_012345',
    gen_random_uuid(),1,gen_random_uuid(),gen_random_uuid(),
    'disposable_original_folder_12345','disposable_saved_photo_12345',
    clock_timestamp()-interval '2 minutes',clock_timestamp(),
    '{}'::jsonb,gen_random_uuid());
 exception when insufficient_privilege or serialization_failure then denies:=true;end;
 if not denies then raise exception 'Foreign first-photo worker unexpectedly admitted';end if;
 if (select count(*) from private.client_delivery_test_first_photo_continuations)<>before_count
 then raise exception 'Rejected first-photo CAS committed audit';end if;
 if (select count(*) from private.client_delivery_dispatch_permit where request_id is not null)<>0
 then raise exception 'Rejected first-photo CAS held permit';end if;
 raise notice 'PASS: first photo recovery service-only and foreign worker denied';
end;
$gate$;
rollback;
