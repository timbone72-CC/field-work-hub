-- Single trusted projection: a worker cannot pick an arbitrary source blob,
-- parent or filename by knowing its own service identity.
create function private.service_get_delivery_file_plan(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language plpgsql security definer set search_path='' as $plan$
declare f private.client_delivery_file_plans%rowtype;
 k private.client_packages%rowtype; o private.client_delivery_outbox%rowtype;
 r private.photo_transfer_receipts%rowtype;
 item jsonb; ordinal int; source jsonb;
begin
 -- Lease guard takes a row lock and must run in a non-STABLE function.
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into f from private.client_delivery_file_plans
  where id=p_plan and package_id=p_package;
 select * into k from private.client_packages where id=p_package;
 select * into o from private.client_delivery_outbox where package_id=p_package;
 if f.id is null or k.id is null or k.status<>'DELIVERING'
  or o.approved_sha256 is distinct from k.approved_sha256
  or f.state='UNCERTAIN'
  or f.kind not in ('PHOTO','MANIFEST') then
   raise exception 'Current frozen delivery file required' using errcode='42501';end if;
 if f.kind='PHOTO' then
   select value into item from jsonb_array_elements(k.approved_manifest->'selected_photos')
     where value->>'photo_id'=f.photo_id::text;
   if item is null or item->>'observed_sha256'<>f.expected_sha256
      or (item->>'observed_size')::bigint<>f.expected_size then
     raise exception 'Selected source identity changed' using errcode='40001';end if;
   select * into r from private.photo_transfer_receipts where photo_id=f.photo_id
     and transfer_version=(item->>'transfer_version')::uuid;
   if r.photo_id is null or r.observed_sha256<>f.expected_sha256
     or r.observed_size<>f.expected_size
     or not exists(select 1 from storage.objects ob
       where ob.id=r.object_id and ob.version=r.object_version
         and ob.bucket_id=r.bucket and ob.name=r.object_key
         and ob.owner_id=r.owner_user_id::text
         and ob.archived_at is null and not coalesce(ob.is_delete_marker,false)) then
      raise exception 'Source private receipt or catalog object is unavailable' using errcode='42501';end if;
   ordinal:=(item->>'ordinal')::int;
   source:=jsonb_build_object('bucket',r.bucket,'object_key',r.object_key,
    'object_id',r.object_id,'object_version',r.object_version,
    'owner_id',r.owner_user_id,'photo_id',f.photo_id,
    'transfer_version',(item->>'transfer_version')::uuid);
 else
   if f.expected_sha256<>k.approved_sha256 or
     f.expected_size<>octet_length(k.approved_manifest::text) then
     raise exception 'Frozen submission manifest bytes mismatched' using errcode='40001';end if;
   source:=jsonb_build_object('manifest_bytes',k.approved_manifest::text);
 end if;
 return jsonb_build_object('package_id',p_package,'plan_id',f.id,'kind',f.kind,
   'photo_id',f.photo_id,'file_id',f.drive_file_id,'parent_id',f.drive_parent_id,
   'name',case when f.kind='PHOTO' then lpad(ordinal::text,3,'0')||'.jpg' else 'submission.json' end,
   'sha256',f.expected_sha256,'size',f.expected_size,'mime',f.mime_type,
   'appProperties',jsonb_build_object('fwh_package',p_package::text,'fwh_manifest',k.approved_sha256),
   'source',source);
end;
$plan$;
create function public.service_get_delivery_file_plan(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_get_delivery_file_plan(p_package,p_worker,p_generation,p_plan)
$wrap$;
revoke all on function private.service_get_delivery_file_plan(uuid,uuid,bigint,uuid),
 public.service_get_delivery_file_plan(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_get_delivery_file_plan(uuid,uuid,bigint,uuid),
 public.service_get_delivery_file_plan(uuid,uuid,bigint,uuid) to service_role;
