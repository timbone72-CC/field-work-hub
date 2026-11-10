-- FWH-F04/AC1: SOURCE ONLY, server-owned read-only next queued package.
-- Dispatch remains OFF. This never claims, releases or retries anything.
-- The original HELD singleton, source photos and remote IDs are untouched.
create function private.service_select_next_delivery_package()
returns jsonb language plpgsql security definer set search_path='' as $selection$
declare
 cfg private.client_delivery_package_dispatch_config%rowtype;
 candidate record;
begin
 select * into cfg from private.client_delivery_package_dispatch_config where singleton;
 if cfg.singleton is null or not cfg.enabled or not cfg.legacy_worker_off_verified
 then return '{"available":false}'::jsonb;end if;

 -- Continue an ACTIVE and verified-step-safe exact package permit first.
 select k.id as package_id,k.destination_id,
        k.approved_manifest->>'destination_root' as root_id
 into candidate
 from private.client_delivery_package_dispatch_permits held
 join private.client_delivery_outbox o on o.package_id=held.package_id
 join private.client_packages k on k.id=held.package_id
 join private.client_delivery_destinations d on d.id=k.destination_id
 where o.state='DELIVERING' and k.status='DELIVERING'
   and o.worker_id=held.worker_id and o.lease_generation=held.generation
   and o.lease_until>clock_timestamp()
   and held.organization_id=k.organization_id
   and held.destination_id=k.destination_id
   and o.destination_id=k.destination_id
   and o.approved_sha256=k.approved_sha256
   and k.approved_manifest->>'package_id'=k.id::text
   and k.approved_manifest->>'destination_id'=k.destination_id::text
   and k.approved_manifest->>'destination_root'=d.root_folder_id
   and k.approved_manifest->>'destination_revision'=d.revision::text
   and d.organization_id=k.organization_id and d.company_id=k.company_id
   and d.active and d.verified
   and not exists(select 1 from private.client_delivery_package_step_attempts s
    where s.package_id=k.id and s.verified_at is null)
   and not exists(select 1 from private.client_delivery_final_receipts f
    where f.package_id=k.id)
 order by o.enqueued_at,k.id limit 1;
 if found then
   return jsonb_build_object('available',true,'package_id',candidate.package_id,
     'destination_id',candidate.destination_id,'root_id',candidate.root_id);
 end if;

 -- The held legacy dispatch is never an eligible candidate or fallback.
 if (select count(*) from private.client_delivery_package_dispatch_permits)
    >=cfg.max_in_flight
 then return '{"available":false}'::jsonb;end if;
 select k.id as package_id,k.destination_id,
        k.approved_manifest->>'destination_root' as root_id
 into candidate
 from private.client_delivery_outbox o
 join private.client_packages k on k.id=o.package_id
 join private.client_delivery_destinations d on d.id=k.destination_id
 where o.state='QUEUED' and o.attempts=0 and o.worker_id is null
   and k.status='QUEUED'
   and o.destination_id=k.destination_id
   and o.approved_sha256=k.approved_sha256 and k.approved_sha256 is not null
   and k.approved_manifest->>'package_id'=k.id::text
   and k.approved_manifest->>'destination_id'=k.destination_id::text
   and k.approved_manifest->>'destination_root'=d.root_folder_id
   and k.approved_manifest->>'destination_revision'=d.revision::text
   and d.organization_id=k.organization_id and d.company_id=k.company_id
   and d.active and d.verified
   and exists(select 1 from private.client_delivery_runtime rt
    where rt.organization_id=k.organization_id
      and rt.worker_ready and rt.worker_identity is not null)
   and not exists(select 1 from private.client_delivery_final_receipts f
    where f.package_id=k.id)
   and not exists(select 1 from private.client_delivery_package_dispatch_permits held
    where held.package_id=k.id)
 order by o.enqueued_at,k.id limit 1;
 if not found then return '{"available":false}'::jsonb;end if;
 return jsonb_build_object('available',true,'package_id',candidate.package_id,
     'destination_id',candidate.destination_id,'root_id',candidate.root_id);
end;
$selection$;
create function public.service_select_next_delivery_package()
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_select_next_delivery_package();
$wrap$;
revoke all on function private.service_select_next_delivery_package()
 from public,anon,authenticated;
revoke all on function public.service_select_next_delivery_package()
 from public,anon,authenticated;
grant execute on function private.service_select_next_delivery_package()
 to service_role;
grant execute on function public.service_select_next_delivery_package()
 to service_role;
