-- Phase 5D same-permit expiration continuation. Rollback-only CI.
-- This never activates a real worker or changes original held evidence.
begin;
do $check$
declare
 original_count bigint;
 response jsonb;
 denied boolean:=false;
 signature text:='public.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid)';
begin
 if to_regprocedure(signature) is null
  or not has_function_privilege('service_role',signature,'EXECUTE')
  or has_function_privilege('anon',signature,'EXECUTE')
  or has_function_privilege('authenticated',signature,'EXECUTE')
 then raise exception 'Resume RPC must be service only';end if;
 select count(*) into original_count from private.client_delivery_dispatch_permit;
 begin
  perform private.service_resume_pinned_package_dispatch(
   gen_random_uuid(),gen_random_uuid(),'synthetic_ci_root_123456789',
   gen_random_uuid(),gen_random_uuid(),1,'fixture@example.invalid',
   'synthetic_ci_drive_123456789','synthetic_permission_id_12345',
   clock_timestamp(),gen_random_uuid());
 exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'Default OFF resumed unknown owner';end if;
 response:=private.service_read_pinned_package_dispatch(
  gen_random_uuid(),gen_random_uuid(),'synthetic_ci_root_123456789');
 if response is distinct from '{"present":false,"active":false}'::jsonb
 then raise exception 'OFF pinned snapshot exposed recovery';end if;
 if (select count(*) from private.client_delivery_dispatch_permit)<>original_count
 then raise exception 'Default OFF touched legacy permit';end if;
 raise notice 'PASS: exact service-only continuation OFF and original held';
end;
$check$;
rollback;
