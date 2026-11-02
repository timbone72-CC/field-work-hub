-- Phase 5D: narrow terminal delivery completion under active package-cutover.
-- The verified original finalizer clears only worker_id and lease_until
-- on DELIVERING -> DELIVERED after recording the immutable final receipt.
-- Default dispatch remains OFF; preserve original singleton and all journals.
-- Rollback: restore the function body in 20261102003402 without modifying
-- any package, permit, lease, photo, journal, or remote Google object.
create or replace function private.service_legacy_dispatch_cutover_row_guard()
returns trigger language plpgsql security definer
set search_path='' set lock_timeout='5s' as $fence$
declare
 cfg private.client_delivery_package_dispatch_config%rowtype;
 pkg uuid;
 held private.client_delivery_package_dispatch_permits%rowtype;
begin
 select * into cfg from private.client_delivery_package_dispatch_config
  where singleton for share;
 if cfg.singleton is null then
   raise exception 'Cutover configuration missing' using errcode='42501';
 end if;
 -- OFF: preserve ALL previously accepted legacy behavior.
 if not cfg.enabled and not cfg.legacy_worker_off_verified then
   if tg_op='DELETE' then return old;end if;
   return new;
 end if;
 if tg_table_name='client_delivery_dispatch_permit' then
   raise exception 'Legacy singleton is quarantined under cutover'
     using errcode='42501';
 end if;
 -- These old recovery paths update the outbox directly before further provider
 -- work. A package-permit owner is mandatory on ALL changed delivery states.
 if tg_op='DELETE' then
   pkg:=old.package_id;
 elsif tg_op='INSERT' then
   pkg:=new.package_id;
 else
   pkg:=new.package_id;
 end if;
 if tg_op='INSERT' and new.state='QUEUED' then return new;end if;
 if tg_op='UPDATE'
   and old.state='QUEUED' and new.state='QUEUED'
   and old.worker_id is not distinct from new.worker_id
   and old.lease_generation is not distinct from new.lease_generation
   and old.lease_until is not distinct from new.lease_until
 then return new;end if;
 select * into held from private.client_delivery_package_dispatch_permits
  where package_id=pkg;
 if held.package_id is null or not cfg.enabled or not cfg.legacy_worker_off_verified
 then raise exception 'Package permit required for delivery mutation'
   using errcode='42501';end if;
 if tg_op='DELETE' then
   raise exception 'Protected delivery journal cannot be deleted during cutover'
     using errcode='42501';
 end if;
 -- The finalizer inserts the immutable final receipt BEFORE marking the
 -- outbox DELIVERED and clearing its short-lived worker lease. Permit ONLY
 -- this exact terminal transition, after the original same-generation owner,
 -- active fenced step, immutable receipt, and frozen package are confirmed.
 -- No legacy, QUEUED, UNCERTAIN, lease transfer, or unrelated field change.
 if tg_op='UPDATE' and old.state='DELIVERING' and new.state='DELIVERED' then
  if held.package_id is null or not cfg.enabled
    or not cfg.legacy_worker_off_verified
    or old.worker_id is null or old.lease_until is null
    or old.lease_until<=clock_timestamp()
    or old.worker_id is distinct from held.worker_id
    or old.lease_generation is distinct from held.generation
    or old.destination_id is distinct from held.destination_id
    or new.worker_id is not null or new.lease_until is not null
    or (to_jsonb(new)-'state'-'worker_id'-'lease_until')
       is distinct from (to_jsonb(old)-'state'-'worker_id'-'lease_until')
    or not exists(
      select 1 from private.client_packages k
      where k.id=old.package_id and k.status='DELIVERING'
        and k.organization_id=held.organization_id
        and k.destination_id=held.destination_id
        and k.approved_sha256=old.approved_sha256
        and k.approved_manifest->>'package_id'=k.id::text
        and k.approved_manifest->>'destination_id'=k.destination_id::text
    )
    or not exists(
      select 1 from private.client_delivery_package_step_attempts s
      where s.package_id=old.package_id
        and s.worker_id=held.worker_id
        and s.request_id=held.request_id
        and s.generation=held.generation and s.verified_at is null
    )
    or not exists(
      select 1 from private.client_delivery_final_receipts r
      join private.client_packages k on k.id=r.package_id
      join private.client_delivery_file_plans folder
        on folder.package_id=k.id and folder.kind='FOLDER'
           and folder.state='VERIFIED'
      where r.package_id=old.package_id
        and r.destination_id=held.destination_id
        and r.approved_sha256=old.approved_sha256
        and r.approved_sha256=k.approved_sha256
        and r.drive_folder_id=folder.drive_file_id
        and jsonb_typeof(r.files)='array'
        and jsonb_array_length(r.files)=
            jsonb_array_length(k.approved_manifest->'selected_photos')+2
        and not exists(
          select 1 from private.client_delivery_file_plans f
          where f.package_id=k.id and
            (f.state<>'VERIFIED' or f.verified_at is null or f.remote_evidence is null)
        )
    )
  then raise exception 'Unverified terminal delivery transition'
    using errcode='42501';end if;
  return new;
 end if;
 if held.worker_id is distinct from new.worker_id
   or held.generation is distinct from new.lease_generation
   or held.destination_id is distinct from new.destination_id
 then raise exception 'Frozen package delivery owner mismatch'
   using errcode='42501';end if;
 return new;
end;
$fence$;
revoke all on function private.service_legacy_dispatch_cutover_row_guard()
 from public,anon,authenticated,service_role;
