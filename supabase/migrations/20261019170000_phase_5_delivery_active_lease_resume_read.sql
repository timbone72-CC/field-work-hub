-- Phase 5D — service-only read of the ORIGINAL still-active delivery lease.
-- SOURCE ONLY; never reclaim, extend, requeue, retry or allocate remote IDs.
create function private.service_read_active_delivery_lease()
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $resume$
declare o private.client_delivery_outbox%rowtype;
 k private.client_packages%rowtype;
begin
 -- Fail closed on an expired/uncertain prior delivery; do not skip it to start
 -- an unrelated provider write. The original outbox owns lease identity.
 select * into o from private.client_delivery_outbox
  where state='DELIVERING'
  order by enqueued_at,package_id limit 1;
 if o.package_id is null then return jsonb_build_object('state','NONE'); end if;
 if o.worker_id is null or o.lease_generation<1 or o.attempts<>1
    or o.lease_until is null or o.lease_until<=clock_timestamp() then
  return jsonb_build_object('state','BLOCKED_UNCERTAIN');
 end if;
 select * into k from private.client_packages where id=o.package_id;
 if k.id is null or k.status<>'DELIVERING'
  or k.approved_sha256 is distinct from o.approved_sha256
  or k.destination_id is distinct from o.destination_id
  or k.approved_manifest is null
  or k.approved_manifest->>'package_id' is distinct from k.id::text
  or k.approved_manifest->>'destination_id' is distinct from o.destination_id::text
  or not exists (
   select 1 from private.client_delivery_runtime rt
   where rt.organization_id=k.organization_id and rt.worker_ready
    and rt.last_verified_at>=now()-interval '24 hours'
    and rt.worker_identity is not null
  )
  or not exists (
   select 1 from private.client_delivery_destinations d
   where d.id=o.destination_id and d.organization_id=k.organization_id
    and d.company_id=k.company_id and d.provider='GOOGLE_DRIVE'
    and d.verified and d.active
    and d.revision::text=k.approved_manifest->>'destination_revision'
    and d.root_folder_id=k.approved_manifest->>'destination_root'
  ) then
  return jsonb_build_object('state','BLOCKED_UNCERTAIN');
 end if;
 -- Original lease only, with no provider IDs, private bytes, URLs or tokens.
 -- A subsequent operation MUST heartbeat and recheck the original SQL lease.
 return jsonb_build_object('state','ACTIVE','package_id',o.package_id,
  'worker_id',o.worker_id,'generation',o.lease_generation,
  'lease_until',o.lease_until,
  'approved_sha256',o.approved_sha256,'destination_id',o.destination_id,
  'manifest',k.approved_manifest);
end;
$resume$;
create function public.service_read_active_delivery_lease()
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_read_active_delivery_lease()
$wrap$;
revoke all on function private.service_read_active_delivery_lease(),
 public.service_read_active_delivery_lease()
 from public,anon,authenticated,service_role;
grant execute on function private.service_read_active_delivery_lease(),
 public.service_read_active_delivery_lease() to service_role;
