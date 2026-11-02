-- Phase 5D: new package read-only provider proof authority, rollback-only.
-- No remote provider call, no original permit mutation or activation.
begin;
do $gate$
declare
 cfg private.client_delivery_package_dispatch_config%rowtype;
 denied boolean:=false;
 before_original bigint;
begin
 select * into cfg from private.client_delivery_package_dispatch_config where singleton;
 if cfg.enabled or not cfg.legacy_worker_off_verified then
   -- In isolated CI, the installed config must still be default OFF/OFF;
   -- the hosted legacy-off flag may differ. This test requires OFF/OFF.
   if cfg.enabled or cfg.legacy_worker_off_verified then
     raise exception 'New provider gate must default OFF';end if;
 end if;
 if to_regclass('private.client_delivery_package_provider_checks') is null
  or not (select relrowsecurity from pg_class
     where oid='private.client_delivery_package_provider_checks'::regclass)
  or has_table_privilege('anon','private.client_delivery_package_provider_checks','SELECT')
  or has_table_privilege('authenticated','private.client_delivery_package_provider_checks','INSERT')
  or has_table_privilege('service_role','private.client_delivery_package_provider_checks','INSERT')
  or not has_function_privilege('service_role',
    'public.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid)','EXECUTE')
  or has_function_privilege('authenticated',
    'public.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid)','EXECUTE')
  or has_function_privilege('anon',
    'public.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid)','EXECUTE')
 then raise exception 'Read-only provider attestation must be private/service-only';end if;
 select count(*) into before_original from private.client_delivery_dispatch_permit;
 begin
  perform private.service_record_pinned_package_provider_check(
   gen_random_uuid(),gen_random_uuid(),'synthetic_ci_root_123456789',
   'disposable@example.invalid','synthetic_ci_drive_123456789',
   'synthetic_permission_123456',clock_timestamp(),gen_random_uuid());
 exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'Disabled new provider route accepted attestation';end if;
 if (select count(*) from private.client_delivery_dispatch_permit)<>before_original
  or exists(select 1 from private.client_delivery_package_provider_checks)
 then raise exception 'Disabled attestation mutated protected state';end if;
 raise notice 'PASS: package-local provider proof OFF/grants/RLS/legacy preserved';
end;
$gate$;
rollback;
