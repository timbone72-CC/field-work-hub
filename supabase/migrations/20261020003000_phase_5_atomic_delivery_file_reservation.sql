-- Phase 5D, source-only: one transaction for all preallocated PACKAGE
-- folder, selected JPEG and submission manifest IDs. The protected
-- existing service_reserve_delivery_file remains the sole per-item authority.
-- No provider write, active worker, scheduler, Send or cleanup is enabled.
create function private.service_reserve_delivery_file_set(
 p_package uuid,p_worker uuid,p_generation bigint,
 p_folder_id text,p_parent_id text,p_photos jsonb,p_manifest_id text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $batch$
declare
 k private.client_packages%rowtype;
 photo jsonb; selected jsonb;
 ids text[];
 item_id text; n integer; i integer;
begin
 -- Locks the current outbox row until this entire RPC commits. Concurrent
 -- retries cannot interleave item inserts or replace existing remote IDs.
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into k from private.client_packages where id=p_package;
 if k.id is null or k.status<>'DELIVERING'
   or k.approved_manifest is null
   or jsonb_typeof(k.approved_manifest->'selected_photos')<>'array'
   or k.approved_sha256 is null
   or jsonb_typeof(p_photos)<>'array' then
  raise exception 'Current frozen delivery selection required' using errcode='42501';
 end if;
 n:=jsonb_array_length(k.approved_manifest->'selected_photos');
 if n>200 or jsonb_array_length(p_photos)<>n
   or p_folder_id is null or p_folder_id !~ '^[A-Za-z0-9_-]{10,160}$'
   or p_manifest_id is null or p_manifest_id !~ '^[A-Za-z0-9_-]{10,160}$'
   or p_parent_id is null or p_parent_id !~ '^[A-Za-z0-9_-]{10,160}$'
   or p_folder_id=p_manifest_id or p_folder_id=p_parent_id
   or p_manifest_id=p_parent_id then
  raise exception 'One exact complete set of unique remote IDs required'
    using errcode='22023';
 end if;
 -- Existing partially saved/preallocated records require deliberate
 -- reconciliation, NEVER reallocation with another generated ID set.
 if exists(select 1 from private.client_delivery_file_plans
      where package_id=p_package) then
  raise exception 'Original package IDs already reserved; read original set'
    using errcode='40001';
 end if;
 ids:=array[p_folder_id,p_manifest_id,p_parent_id];
 for i in 0..n-1 loop
  photo:=p_photos->i;
  selected:=k.approved_manifest->'selected_photos'->i;
  if jsonb_typeof(photo)<>'object'
    or (select count(*) from jsonb_object_keys(photo))<>2
    or photo->>'photo_id' is distinct from selected->>'photo_id'
    or photo->>'file_id' is null
    or (photo->>'file_id') !~ '^[A-Za-z0-9_-]{10,160}$' then
   raise exception 'Frozen photo ordering or preallocated ID differs'
     using errcode='22023';
  end if;
  item_id:=photo->>'file_id';
  if item_id=any(ids) then
   raise exception 'Duplicate or parent remote ID' using errcode='22023';
  end if;
  ids:=array_append(ids,item_id);
 end loop;
 -- Calls existing server-validated package parent, immutable selected
 -- receipt/content and file-shape checks, atomically within this RPC.
 perform private.service_reserve_delivery_file(
   p_package,p_worker,p_generation,'FOLDER',null,p_folder_id,p_parent_id);
 for i in 0..n-1 loop
  photo:=p_photos->i;
  perform private.service_reserve_delivery_file(
    p_package,p_worker,p_generation,'PHOTO',
    (photo->>'photo_id')::uuid,photo->>'file_id',p_folder_id);
 end loop;
 perform private.service_reserve_delivery_file(
   p_package,p_worker,p_generation,'MANIFEST',null,p_manifest_id,p_folder_id);
 if (select count(*) from private.client_delivery_file_plans
   where package_id=p_package)<>n+2 then
  raise exception 'Atomic reservation count mismatch' using errcode='40001';
 end if;
 return jsonb_build_object('package_id',p_package,
   'folder_id',p_folder_id,'manifest_id',p_manifest_id,
   'reserved_count',n+2,'reserved',true);
end;
$batch$;

create function public.service_reserve_delivery_file_set(
 p_package uuid,p_worker uuid,p_generation bigint,
 p_folder_id text,p_parent_id text,p_photos jsonb,p_manifest_id text
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_reserve_delivery_file_set(
  p_package,p_worker,p_generation,p_folder_id,p_parent_id,p_photos,p_manifest_id)
$wrap$;
revoke all on function
 private.service_reserve_delivery_file_set(uuid,uuid,bigint,text,text,jsonb,text),
 public.service_reserve_delivery_file_set(uuid,uuid,bigint,text,text,jsonb,text)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_reserve_delivery_file_set(uuid,uuid,bigint,text,text,jsonb,text),
 public.service_reserve_delivery_file_set(uuid,uuid,bigint,text,text,jsonb,text)
 to service_role;

-- Retire the old externally callable one-file reservation RPC at the same
-- source migration boundary. Its private implementation remains callable
-- ONLY inside the new trusted transaction (under the function owner).
-- Otherwise an elevated service caller could strand a partial package.
revoke execute on function
 public.service_reserve_delivery_file(uuid,uuid,bigint,text,uuid,text,text),
 private.service_reserve_delivery_file(uuid,uuid,bigint,text,uuid,text,text)
 from service_role;
