-- Phase 5E owner-scoped cleanup readiness foundation. Disposable PostgreSQL only.
-- Read-only assertions and transaction rollback. Never delete local/remote data.
begin;
do $gate$
declare
 denied boolean:=false;
 closure_trigger text;
 f text;
 before_count bigint;
begin
 if to_regclass('private.client_package_runs') is null
   or not (select relrowsecurity from pg_class where oid='private.client_package_runs'::regclass)
 then raise exception 'Immutable private run-closure owner or RLS missing';end if;
 if has_table_privilege('authenticated','private.client_package_runs','SELECT')
   or has_table_privilege('authenticated','private.client_package_runs','INSERT')
   or has_table_privilege('service_role','private.client_package_runs','INSERT')
   or has_table_privilege('anon','private.client_package_runs','SELECT')
 then raise exception 'Closure table must deny direct role access';end if;
 if not has_function_privilege('authenticated',
     'public.field_photo_cleanup_readiness(uuid)','EXECUTE')
   or not has_function_privilege('authenticated',
     'private.field_photo_cleanup_readiness(uuid)','EXECUTE')
   or has_function_privilege('anon',
     'public.field_photo_cleanup_readiness(uuid)','EXECUTE')
   or has_function_privilege('service_role',
     'private.field_photo_cleanup_readiness(uuid)','EXECUTE')
 then raise exception 'Owner-only read RPC grant mismatch';end if;
 select pg_get_functiondef(
    'private.guard_client_package_run_closure()'::regprocedure)
 into closure_trigger;
 select pg_get_functiondef(
    'private.field_photo_cleanup_readiness(uuid)'::regprocedure) into f;
 if position('private.client_delivery_final_receipts' in closure_trigger)=0
    or position('private.photo_transfer_receipts' in closure_trigger)=0
    or position('Immutable package/run closure' in closure_trigger)=0
    or position('public.field_actions' in closure_trigger)=0
    or position('FINAL_RUN_CLOSURE_PENDING' in f)=0
    or position('private.photo_transfer_receipts' in f)=0
    or position('auth.uid()' in f)=0
    or position('server_readiness_only' in f)=0
 then raise exception 'Eligibility/retention/immutability guard absent';end if;
 select count(*) into before_count from private.client_package_runs;
 execute 'set local role authenticated';
 begin
   perform public.field_photo_cleanup_readiness(gen_random_uuid());
 exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'Unauthenticated or wrong-owner photo leaked';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 denied:=false;
 begin
   perform public.field_photo_cleanup_readiness(gen_random_uuid());
 exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'Foreign/unknown photo must deny';end if;
 execute 'reset role';
 if (select count(*) from private.client_package_runs)<>before_count then
   raise exception 'Readiness RPC changed durable closure table';end if;
 raise notice 'PASS: package closure immutable, private owner read, wrong user denied, no deletion';
end;
$gate$;
rollback;
