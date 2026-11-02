-- Phase 5D: additive LAST-CHANCE cutover fence for hosted legacy v55.
-- The approved package-permit migration stays OFF by default. Never unlock,
-- replay, replace or remove the original held singleton or its provider journal.
-- An existing legacy recovery RPC may bypass service_delivery_guard; protect
-- the durable legacy dispatcher and delivery outbox at the mutation boundary.
-- This does not prove an in-flight old HTTP provider call has drained.
create function private.service_legacy_dispatch_cutover_row_guard()
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
create trigger phase5d_cutover_legacy_singleton
 before insert or update or delete on private.client_delivery_dispatch_permit
 for each row execute function private.service_legacy_dispatch_cutover_row_guard();
create trigger phase5d_cutover_outbox
 before insert or update or delete on private.client_delivery_outbox
 for each row execute function private.service_legacy_dispatch_cutover_row_guard();
