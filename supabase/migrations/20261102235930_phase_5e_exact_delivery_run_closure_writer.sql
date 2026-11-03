-- Phase 5E: associate only an exact accepted/current frozen run with its
-- verified terminal delivery. This never creates a receipt or triggers cleanup.
-- A historic delivered package is not backfilled; only a NEW trusted
-- DELIVERING -> DELIVERED transition under the existing server finalizer.
-- Unselected/rejected frozen photos still need durable private receipts.
create function private.record_verified_terminal_run_closure()
returns trigger language plpgsql security definer
set search_path='' set lock_timeout='5s' as $closure_writer$
declare
  fs public.photo_finish_sets%rowtype;
begin
 if tg_op<>'UPDATE' or old.status is not distinct from new.status
   or old.status<>'DELIVERING' or new.status<>'DELIVERED'
 then return new;end if;
 -- Existing terminal finalization verified Google PHOTO/MANIFEST/FOLDER
 -- plans and durable outbox and receipt before updating package status.
 if not exists(
    select 1 from private.client_delivery_final_receipts r
    join private.client_delivery_outbox o on o.package_id=r.package_id
    where r.package_id=new.id and o.state='DELIVERED'
      and r.approved_sha256=new.approved_sha256
      and o.approved_sha256=new.approved_sha256
      and r.destination_id=new.destination_id
      and o.destination_id=new.destination_id
 ) then return new;end if;
 -- Only the package's exact main run is eligible in this first stage.
 -- No inference about other runs included in a multi-run package, no
 -- cleanup of rejected-only or never-sent work, no synthetic backfill.
 select f.* into fs from public.photo_finish_sets f
 join public.field_actions a on a.finish_set_id=f.id
 where f.run_id=new.run_id and f.work_order_id=new.work_order_id
   and f.organization_id=new.organization_id
   and a.organization_id=f.organization_id
   and a.work_order_id=f.work_order_id and a.run_id=f.run_id
   and a.actor_user_id=f.actor_user_id and a.action_kind='COMPLETE'
   and a.accepted_at is not null and a.finish_digest=f.digest
   and jsonb_typeof(f.photos)='array'
   and not exists(
    select 1 from jsonb_array_elements(f.photos) image
    where image->>'id' is null
      or not exists(
        select 1 from private.photo_transfers t
        join private.photo_transfer_receipts r
          on r.photo_id=t.photo_id and r.transfer_version=t.version
          and r.observed_sha256=t.prepared_sha256
          and r.observed_size=t.prepared_size
        where t.photo_id=(image->>'id')::uuid
          and t.captured_by=f.actor_user_id
          and t.organization_id=f.organization_id
          and t.work_order_id=f.work_order_id and t.run_id=f.run_id
          and t.finish_set_id=f.id and t.finish_digest=f.digest
          and t.state='RECEIVED'
     ))
 order by f.created_at desc limit 1;
 if fs.id is null then return new;end if;
 insert into private.client_package_runs(
   package_id,run_id,finish_set_id,finish_digest
 ) values(new.id,fs.run_id,fs.id,fs.digest)
 on conflict (package_id,run_id) do nothing;
 return new;
end;
$closure_writer$;
create trigger client_package_terminal_run_closure
 after update of status on private.client_packages
 for each row execute function private.record_verified_terminal_run_closure();
revoke all on function private.record_verified_terminal_run_closure()
 from public,anon,authenticated,service_role;
