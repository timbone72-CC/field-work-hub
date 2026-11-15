-- FWH 5E-T01 / 6D partner: exact accepted cross-run delivery closure.
-- Only a NEW trusted DELIVERING -> DELIVERED transition can record closure.
-- No historical backfill, photo deletion, automatic cleanup, or new provider path.
-- A main run retains its existing zero-photo-capable closure semantics.
-- An additional run requires ONE of its exact accepted frozen photos actually
-- selected in the immutable manifest AND verified in the provider file plan.
-- ALL original photos in that run, including excluded/intermediate evidence,
-- must retain matching immutable private receipts before any closure is written.

-- Pure comparison deliberately uses strings: malformed manifest IDs and sizes
-- cannot trigger a cast, widen an identity, or escape to another run/photo.
create function private.fwh_exact_frozen_run_photo(
  p_selected jsonb,p_frozen jsonb,p_photo uuid,p_run uuid,
  p_version uuid,p_hash text,p_size bigint
) returns boolean language sql immutable security invoker
set search_path='' as $selection$
 select exists(
   select 1
   from jsonb_array_elements(case when jsonb_typeof(p_selected)='array'
        then p_selected else '[]'::jsonb end) item
   where item->>'photo_id'=p_photo::text
     and item->>'run_id'=p_run::text
     and item->>'transfer_version'=p_version::text
     and item->>'observed_sha256'=p_hash
     and item->>'observed_size'=p_size::text
     and exists(
       select 1 from jsonb_array_elements(case when jsonb_typeof(p_frozen)='array'
         then p_frozen else '[]'::jsonb end) original
       where original->>'id'=p_photo::text
     )
 );
$selection$;

-- Internal guard shared by the terminal writer and immutable-closure trigger.
-- A package's main run is handled by the original main-run rule; this is ONLY
-- for accepted historical/corrective runs with a real selected provider photo.
create function private.fwh_verified_additional_package_run(
  p_package uuid,p_run uuid,p_finish_set uuid
) returns boolean language sql stable security definer
set search_path='' as $covered$
 select exists(
   select 1
   from private.client_packages k
   join public.photo_finish_sets fs on fs.id=p_finish_set
     and fs.work_order_id=k.work_order_id
     and fs.organization_id=k.organization_id and fs.run_id=p_run
   join public.work_order_runs wr on wr.id=fs.run_id
     and wr.work_order_id=k.work_order_id
     and wr.organization_id=k.organization_id
     and wr.field_status='FIELD_COMPLETE'
   join private.client_package_photos chosen on chosen.package_id=k.id
   join private.photo_transfers t on t.photo_id=chosen.photo_id
     and t.organization_id=fs.organization_id
     and t.work_order_id=fs.work_order_id and t.run_id=fs.run_id
     and t.finish_set_id=fs.id and t.finish_digest=fs.digest
     and t.captured_by=fs.actor_user_id and t.state='RECEIVED'
   join private.photo_transfer_receipts retained on
     retained.photo_id=t.photo_id and retained.transfer_version=t.version
     and retained.observed_sha256=t.prepared_sha256
     and retained.observed_size=t.prepared_size
   join private.client_delivery_file_plans verified on
     verified.package_id=k.id and verified.photo_id=chosen.photo_id
     and verified.kind='PHOTO' and verified.state='VERIFIED'
     and verified.verified_at is not null
     and verified.drive_file_id is not null
     and verified.drive_parent_id is not null
     and verified.expected_sha256=retained.observed_sha256
     and verified.expected_size=retained.observed_size
   where k.id=p_package and k.status='DELIVERED'
     and k.run_id is distinct from p_run
     and (wr.run_sequence=1 or exists(
       select 1 from private.correction_obligations co
       where co.work_order_id=k.work_order_id and co.replacement_run_id=p_run
         and co.status in ('OPEN','SATISFIED')))
     and private.fwh_exact_frozen_run_photo(
       k.approved_manifest->'selected_photos',fs.photos,t.photo_id,
       t.run_id,t.version,retained.observed_sha256,retained.observed_size)
 );
$covered$;

create or replace function private.guard_client_package_run_closure()
returns trigger language plpgsql security definer set search_path='' as $closure$
declare
  fs public.photo_finish_sets%rowtype;
  k private.client_packages%rowtype;
begin
  if tg_op<>'INSERT' then
    raise exception 'Immutable package/run closure cannot change' using errcode='42501';
  end if;
  select * into fs from public.photo_finish_sets where id=new.finish_set_id;
  select * into k from private.client_packages where id=new.package_id;
  if fs.id is null or k.id is null
    or fs.run_id is distinct from new.run_id
    or k.work_order_id is distinct from fs.work_order_id
    or (k.run_id is distinct from new.run_id
      and not private.fwh_verified_additional_package_run(
        new.package_id,new.run_id,new.finish_set_id))
    or k.organization_id is distinct from fs.organization_id
    or k.status<>'DELIVERED'
    or fs.digest is distinct from new.finish_digest
    or not exists (
      select 1 from public.field_actions a
      where a.organization_id=fs.organization_id
        and a.work_order_id=fs.work_order_id
        and a.run_id=new.run_id
        and a.actor_user_id=fs.actor_user_id
        and a.action_kind='COMPLETE' and a.accepted_at is not null
        and a.finish_set_id=new.finish_set_id
        and a.finish_digest=new.finish_digest)
    or not exists (
      select 1 from private.client_delivery_final_receipts r
      join private.client_delivery_outbox o on o.package_id=r.package_id
      where r.package_id=k.id and o.state='DELIVERED'
        and r.destination_id=k.destination_id
        and r.approved_sha256=k.approved_sha256
        and o.approved_sha256=k.approved_sha256)
  then raise exception 'Applicable final delivery/Finish closure not verified'
    using errcode='42501';end if;
  if jsonb_typeof(fs.photos)<>'array'
    or exists (
       select 1 from jsonb_array_elements(fs.photos) image
       where image->>'id' is null
          or not exists (
            select 1 from private.photo_transfers t
            join private.photo_transfer_receipts r
              on r.photo_id=t.photo_id and r.transfer_version=t.version
               and r.observed_sha256=t.prepared_sha256
               and r.observed_size=t.prepared_size
            where t.photo_id=(image->>'id')::uuid
              and t.captured_by=fs.actor_user_id
              and t.organization_id=fs.organization_id
              and t.work_order_id=fs.work_order_id
              and t.run_id=new.run_id
              and t.finish_set_id=new.finish_set_id
              and t.finish_digest=new.finish_digest
              and t.state='RECEIVED'))
  then raise exception 'Every frozen photo needs a verified private retention receipt'
    using errcode='42501';end if;
  return new;
end;
$closure$;

create or replace function private.record_verified_terminal_run_closure()
returns trigger language plpgsql security definer
set search_path='' set lock_timeout='5s' as $closure_writer$
declare
  fs public.photo_finish_sets%rowtype;
  candidate record;
begin
 if tg_op<>'UPDATE' or old.status is not distinct from new.status
   or old.status<>'DELIVERING' or new.status<>'DELIVERED'
 then return new;end if;
 if not exists(
    select 1 from private.client_delivery_final_receipts r
    join private.client_delivery_outbox o on o.package_id=r.package_id
    where r.package_id=new.id and o.state='DELIVERED'
      and r.approved_sha256=new.approved_sha256
      and o.approved_sha256=new.approved_sha256
      and r.destination_id=new.destination_id
      and o.destination_id=new.destination_id
 ) then return new;end if;

 -- The exact main run is eligible even for a valid manifest-only delivery.
 -- Additional runs only enter as frozen selected private photo identities;
 -- the shared coverage guard checks verified provider and private evidence.
 for candidate in
   select new.run_id as run_id
   union
   select distinct t.run_id
   from private.client_package_photos chosen
   join private.photo_transfers t on t.photo_id=chosen.photo_id
   where chosen.package_id=new.id and t.work_order_id=new.work_order_id
     and t.organization_id=new.organization_id
 loop
   select f.* into fs from public.photo_finish_sets f
   join public.field_actions a on a.finish_set_id=f.id
   where f.run_id=candidate.run_id and f.work_order_id=new.work_order_id
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
           join private.photo_transfer_receipts receipt
             on receipt.photo_id=t.photo_id and receipt.transfer_version=t.version
             and receipt.observed_sha256=t.prepared_sha256
             and receipt.observed_size=t.prepared_size
           where t.photo_id=(image->>'id')::uuid
             and t.captured_by=f.actor_user_id
             and t.organization_id=f.organization_id
             and t.work_order_id=f.work_order_id and t.run_id=f.run_id
             and t.finish_set_id=f.id and t.finish_digest=f.digest
             and t.state='RECEIVED'
         ))
   order by f.created_at desc limit 1;
   if fs.id is not null
      and (candidate.run_id=new.run_id
        or private.fwh_verified_additional_package_run(new.id,candidate.run_id,fs.id))
   then
     insert into private.client_package_runs(
       package_id,run_id,finish_set_id,finish_digest
     ) values(new.id,fs.run_id,fs.id,fs.digest)
     on conflict (package_id,run_id) do nothing;
   end if;
 end loop;
 return new;
end;
$closure_writer$;

-- New helpers are never exposed to the Data API or ordinary client roles.
revoke all on function private.fwh_exact_frozen_run_photo(
  jsonb,jsonb,uuid,uuid,uuid,text,bigint
) from public,anon,authenticated,service_role;
revoke all on function private.fwh_verified_additional_package_run(
  uuid,uuid,uuid
) from public,anon,authenticated,service_role;
revoke all on function private.guard_client_package_run_closure()
 from public,anon,authenticated,service_role;
revoke all on function private.record_verified_terminal_run_closure()
 from public,anon,authenticated,service_role;
