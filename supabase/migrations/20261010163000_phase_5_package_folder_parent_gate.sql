-- Phase 5D additive follow-up: bind PACKAGE directly to verified immutable
-- WORK_ORDER folder, itself bound to verified ADDRESS under same company
-- destination root+revision. No Drive calls, live activation, or cleanup.
-- Service-only signature/grants are retained from the original migration.

create or replace function private.service_reserve_delivery_file(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text,p_photo uuid,
 p_file_id text,p_parent_id text
) returns jsonb language plpgsql security definer set search_path='' as $reserve$
declare k private.client_packages%rowtype; o private.client_delivery_outbox%rowtype;
 folder private.client_delivery_file_plans%rowtype; existing private.client_delivery_file_plans%rowtype;
 parent_map private.client_delivery_parent_maps%rowtype;
 m jsonb; photo jsonb; content_hash text; content_size bigint; mime text; parent text;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 if p_kind not in ('FOLDER','PHOTO','MANIFEST') or p_file_id is null
   or p_file_id !~ '^[a-zA-Z0-9_-]{10,160}$' or p_parent_id is null
   or p_parent_id !~ '^[a-zA-Z0-9_-]{3,160}$' then
  raise exception 'Exact generated Drive ID and parent required' using errcode='22023';end if;
 select * into k from private.client_packages where id=p_package;
 select * into o from private.client_delivery_outbox where package_id=p_package;
 m:=k.approved_manifest;
 if k.status<>'DELIVERING' or k.approved_sha256<>o.approved_sha256 or m is null then
  raise exception 'Frozen approved package required' using errcode='42501';end if;
 if p_kind='FOLDER' then
   if p_photo is not null then raise exception 'Folder cannot refer to a photo' using errcode='22023';end if;
   -- A package folder is NEVER allowed immediately below the destination root.
   -- Require both verified same-client ADDRESS and permanent WO UUID parents.
   select w.* into parent_map
   from private.client_delivery_parent_maps w
   join private.client_delivery_parent_maps a on a.id=w.parent_map_id
   join private.client_delivery_destinations d on d.id=w.destination_id
   where w.kind='WORK_ORDER' and w.state='VERIFIED'
     and w.work_order_id=k.work_order_id
     and w.organization_id=k.organization_id and w.company_id=k.company_id
     and w.address_key=k.folder_address_key
     and a.kind='ADDRESS' and a.state='VERIFIED'
     and a.folder_key=k.folder_address_key and a.address_key=k.folder_address_key
     and a.organization_id=w.organization_id and a.company_id=w.company_id
     and a.destination_id=w.destination_id
     and a.destination_revision=w.destination_revision
     and w.parent_remote_id=a.remote_folder_id
     and a.parent_remote_id=d.root_folder_id
     and w.destination_id=k.destination_id and d.organization_id=k.organization_id
     and d.company_id=k.company_id and d.active and d.verified
     and d.revision=w.destination_revision
     and d.revision::text=m->>'destination_revision'
     and d.root_folder_id=m->>'destination_root'
   for share of w,a,d;
   if parent_map.id is null then
     raise exception 'Verified address and WO folder hierarchy required'
       using errcode='42501';end if;
   parent:=parent_map.remote_folder_id;
   mime:='application/vnd.google-apps.folder';
 elsif p_kind='PHOTO' or p_kind='MANIFEST' then
   select * into folder from private.client_delivery_file_plans
     where package_id=p_package and kind='FOLDER' and photo_id is null;
   if folder.package_id is null then
    raise exception 'Preallocate package folder before children' using errcode='42501';end if;
   parent:=folder.drive_file_id;
   if p_kind='PHOTO' then
     if p_photo is null then raise exception 'Selected photo identity required' using errcode='22023';end if;
     select value into photo from jsonb_array_elements(m->'selected_photos')
       where value->>'photo_id'=p_photo::text;
     if photo is null then raise exception 'Photo not selected in approved manifest' using errcode='42501';end if;
     content_hash:=photo->>'observed_sha256'; content_size:=(photo->>'observed_size')::bigint; mime:='image/jpeg';
   else
     if p_photo is not null then raise exception 'Manifest has no photo identity' using errcode='22023';end if;
     content_hash:=k.approved_sha256;content_size:=octet_length(m::text);mime:='application/json';
   end if;
 else raise exception 'Unsupported file role' using errcode='22023';end if;
 if parent is distinct from p_parent_id then
  raise exception 'Drive parent differs from frozen destination' using errcode='42501';end if;
 select * into existing from private.client_delivery_file_plans
   where package_id=p_package and kind=p_kind and photo_id is not distinct from p_photo for update;
 if existing.package_id is not null then
   if existing.drive_file_id<>p_file_id or existing.drive_parent_id<>p_parent_id then
     raise exception 'Remote identity already reserved; do not replace' using errcode='40001';end if;
 else
   insert into private.client_delivery_file_plans(package_id,kind,photo_id,
     drive_file_id,drive_parent_id,expected_sha256,expected_size,mime_type)
     values(p_package,p_kind,p_photo,p_file_id,p_parent_id,content_hash,content_size,mime)
     returning * into existing;
 end if;
 return jsonb_build_object('file_plan_id',existing.id,
  'package_id',p_package,'kind',p_kind,'photo_id',p_photo,
  'drive_file_id',p_file_id,'drive_parent_id',p_parent_id,'expected_sha256',content_hash,
  'expected_size',content_size,'mime_type',mime);
end;
$reserve$;
