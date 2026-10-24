-- Phase 5D SOURCE ONLY. Current-lease snapshot for one final independent
-- exact-ID Google GET of every ancestor, package folder, JPEG and manifest.
-- No provider access, Send, automatic delivery, worker activation or cleanup.
create function private.service_delivery_final_provider_snapshot(
  p_package uuid,p_worker uuid,p_generation bigint
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $final$
declare
  k private.client_packages%rowtype;
  d private.client_delivery_destinations%rowtype;
  f private.client_delivery_file_plans%rowtype;
  p private.client_delivery_parent_maps%rowtype;
  checked private.client_delivery_parent_maps%rowtype;
  snapshot jsonb:='[]'::jsonb;
  files jsonb:='[]'::jsonb;
  order_kinds text[];
  layout text;
  j integer:=1;
  n integer;
  root text;
begin
  perform private.service_delivery_guard(p_package,p_worker,p_generation);
  if private.service_next_delivery_item(p_package,p_worker,p_generation)->>'state'
    is distinct from 'RECEIPTS_READY_FOR_FINAL_RECHECK' then
    raise exception 'All original provider receipts required' using errcode='42501';
  end if;
  select * into k from private.client_packages where id=p_package;
  select * into d from private.client_delivery_destinations where id=k.destination_id;
  if k.id is null or k.status<>'DELIVERING'
    or d.id is null or not d.active or not d.verified
    or d.organization_id is distinct from k.organization_id
    or d.company_id is distinct from k.company_id
    or d.revision::text is distinct from k.approved_manifest->>'destination_revision'
    or d.root_folder_id is distinct from k.approved_manifest->>'destination_root' then
    raise exception 'Original approved destination is not current' using errcode='42501';
  end if;
  root:=d.root_folder_id;
  layout:=coalesce(k.approved_manifest->>'folder_layout','ADDRESS_WORK_ORDER');
  order_kinds:=case layout
    when 'ADDRESS_WORK_ORDER' then array['WORK_ORDER','ADDRESS']
    when 'STATE_CITY_ADDRESS' then array['WORK_ORDER','ADDRESS','CITY','STATE']
    when 'STATE_COUNTY_CITY_ADDRESS' then array['WORK_ORDER','ADDRESS','CITY','COUNTY','STATE']
    else null end;
  if order_kinds is null then
    raise exception 'Frozen folder layout unavailable' using errcode='42501';end if;
  select * into f from private.client_delivery_file_plans
    where package_id=p_package and kind='FOLDER' and photo_id is null
      and state='VERIFIED';
  if f.id is null or not exists(
    select 1 from private.client_delivery_package_folder_attempts a
    where a.file_plan_id=f.id and a.package_id=p_package
      and a.verified_at is not null and a.remote_evidence is not null) then
    raise exception 'Original package-folder receipt missing' using errcode='42501';
  end if;
  select * into p from private.client_delivery_parent_maps
    where remote_folder_id=f.drive_parent_id;
  while j<=array_length(order_kinds,1) loop
    if p.id is null or p.kind is distinct from order_kinds[j]
      or p.state is distinct from 'VERIFIED' then
      raise exception 'Verified original ancestor chain required' using errcode='42501';end if;
    checked:=private.service_delivery_parent_guard(p_package,p_worker,p_generation,p.id);
    if checked.id is distinct from p.id or
      (j=1 and p.remote_folder_id is distinct from f.drive_parent_id) then
      raise exception 'Frozen ancestor identity changed' using errcode='42501';end if;
    snapshot:=snapshot||jsonb_build_array(jsonb_build_object(
      'id',p.remote_folder_id,'parent',p.parent_remote_id,'name',p.remote_name,
      'mime','application/vnd.google-apps.folder','sha256',null,'size',null,
      'appProperties',jsonb_build_object(
        'fwh_org',p.organization_id::text,'fwh_company',p.company_id::text,
        'fwh_destination',p.destination_id::text,
        'fwh_kind',p.kind,'fwh_key',p.folder_key)));
    if p.parent_map_id is null then
      if j<>array_length(order_kinds,1)
        or p.parent_remote_id is distinct from root then
        raise exception 'Frozen root boundary changed' using errcode='42501';end if;
    else
      if j=array_length(order_kinds,1) then
        raise exception 'Unexpected extra ancestor' using errcode='42501';end if;
      select * into p from private.client_delivery_parent_maps where id=p.parent_map_id;
    end if;
    j:=j+1;
  end loop;
  n:=jsonb_array_length(k.approved_manifest->'selected_photos');
  if n>200 then raise exception 'Unbounded client package' using errcode='22023';end if;
  for f in select * from private.client_delivery_file_plans
    where package_id=p_package
    order by case kind when 'FOLDER' then 0 when 'PHOTO' then 1 else 2 end,
      photo_id nulls last
  loop
    if f.state<>'VERIFIED' then
      raise exception 'Unverified file in final readback' using errcode='42501';end if;
    files:=files||jsonb_build_array(jsonb_build_object(
      'id',f.drive_file_id,'parent',f.drive_parent_id,
      'name',case f.kind when 'FOLDER' then 'package-'||p_package::text
        when 'PHOTO' then 'field-photo-'||f.photo_id::text||'.jpg'
        else 'submission.json' end,
      'mime',f.mime_type,'sha256',f.expected_sha256,'size',f.expected_size,
      'appProperties',jsonb_build_object('fwh_package',p_package::text,
        'fwh_manifest',k.approved_sha256)));
  end loop;
  if jsonb_array_length(files)<>n+2 then
    raise exception 'Original immutable file set incomplete' using errcode='42501';end if;
  return jsonb_build_object('package_id',p_package,
    'approved_sha256',k.approved_sha256,'destination_id',d.id,
    'root_id',root,'ancestors',snapshot,'files',files);
end;
$final$;

create function public.service_delivery_final_provider_snapshot(
  p_package uuid,p_worker uuid,p_generation bigint
) returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_delivery_final_provider_snapshot(p_package,p_worker,p_generation)
$wrap$;
revoke all on function
 private.service_delivery_final_provider_snapshot(uuid,uuid,bigint),
 public.service_delivery_final_provider_snapshot(uuid,uuid,bigint)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_delivery_final_provider_snapshot(uuid,uuid,bigint),
 public.service_delivery_final_provider_snapshot(uuid,uuid,bigint)
 to service_role;
