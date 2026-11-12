-- Phase 5D-T03 / FWH-F04 / AC1: preserve independent package progress.
-- SOURCE ONLY. No dispatch activation, permit release/takeover, Google write,
-- photo deletion, legacy retry, package mutation or background wake.
-- The existing service-only selector remains read-only and fail-closed.
--
-- A waiting eligible package should use a free permit slot BEFORE repeatedly
-- advancing an older held package. Once full, choose safe held packages by
-- oldest exact verified-step progress, not by permanently oldest enqueued_at.
-- Unverified attempts, expired unproven leases, changed destinations and
-- original legacy HELD authority remain ineligible. Claim stays atomic.
create or replace function private.service_select_next_delivery_package()
returns jsonb language plpgsql security definer set search_path='' as $selection$
declare
 cfg private.client_delivery_package_dispatch_config%rowtype;
 candidate record;
begin
 select * into cfg from private.client_delivery_package_dispatch_config where singleton;
 if cfg.singleton is null or not cfg.enabled or not cfg.legacy_worker_off_verified
 then return '{"available":false}'::jsonb;end if;


 -- Prefer a genuinely independent queued package only while a slot is free.
 -- The claim RPC still serializes/validates capacity, provider check and owner.
 if (select count(*) from private.client_delivery_package_dispatch_permits)
     <cfg.max_in_flight
 then
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

 if found then
  return jsonb_build_object('available',true,'package_id',candidate.package_id,
     'destination_id',candidate.destination_id,'root_id',candidate.root_id);
 end if;
 end if;

 -- With no eligible new work (or all slots occupied), resume only safe holds.
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
   and o.lease_until is not null
   and (
     o.lease_until>clock_timestamp()
     or (o.lease_until<=clock_timestamp()
       -- Only an already positively VERIFIED step can be renewed; the
       -- existing worker performs fresh Google GET and same-owner CAS.
       and exists(select 1 from private.client_delivery_package_step_attempts v
         where v.package_id=k.id and v.worker_id=held.worker_id
           and v.request_id=held.request_id and v.generation=held.generation
           and v.verified_at is not null
           and v.verified_outcome in ('VERIFIED_METADATA_STEP','VERIFIED_PROVIDER_STEP')))
   )
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
 order by
   coalesce((
     select max(v.verified_at)
     from private.client_delivery_package_step_attempts v
     where v.package_id=k.id and v.worker_id=held.worker_id
       and v.request_id=held.request_id and v.generation=held.generation
   ),'-infinity'::timestamptz),
   o.enqueued_at,k.id limit 1;
 if found then
   return jsonb_build_object('available',true,'package_id',candidate.package_id,
     'destination_id',candidate.destination_id,'root_id',candidate.root_id);
 end if;


 return '{"available":false}'::jsonb;
end;
$selection$;

-- CREATE OR REPLACE retains ACLs, but repeat the explicit service-only fence.
revoke all on function private.service_select_next_delivery_package()
 from public,anon,authenticated;
grant execute on function private.service_select_next_delivery_package()
 to service_role;
