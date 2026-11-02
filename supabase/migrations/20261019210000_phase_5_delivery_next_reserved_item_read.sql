-- Phase 5D SOURCE ONLY: select the next exact already-reserved provider item.
-- No remote write, lease renewal, new identity, worker activation or Send.
-- The same service lease guard serializes this read with the existing owner.
create function private.service_next_delivery_item(
  p_package uuid,p_worker uuid,p_generation bigint
) returns jsonb language plpgsql security definer set search_path='' as $next$
declare
  k private.client_packages%rowtype;
  f private.client_delivery_file_plans%rowtype;
  n integer; expected integer;
begin
  perform private.service_delivery_guard(p_package,p_worker,p_generation);
  select * into k from private.client_packages where id=p_package;
  if k.id is null or k.status<>'DELIVERING'
    or jsonb_typeof(k.approved_manifest->'selected_photos')<>'array'
    or k.approved_sha256 is null then
    raise exception 'Current approved delivery required' using errcode='42501';
  end if;
  expected:=jsonb_array_length(k.approved_manifest->'selected_photos');
  select count(*) into n from private.client_delivery_file_plans
    where package_id=p_package;
  if n=0 then
    return jsonb_build_object('state','UNRESERVED');
  end if;
  -- A partially saved set may represent a lost SQL acknowledgement.
  -- Never allocate replacement IDs or start an upload for it.
  if n<>expected+2
    or exists(select 1 from private.client_delivery_file_plans
      where package_id=p_package and state='UNCERTAIN')
    or (select count(*) from private.client_delivery_file_plans
      where package_id=p_package and kind='FOLDER' and photo_id is null)<>1
    or (select count(*) from private.client_delivery_file_plans
      where package_id=p_package and kind='MANIFEST' and photo_id is null
        and expected_sha256=k.approved_sha256
        and expected_size=octet_length(k.approved_manifest::text))<>1
    or (select count(*) from private.client_delivery_file_plans
      where package_id=p_package and kind='PHOTO')<>expected
    or exists(
      select 1 from private.client_delivery_file_plans p
      where p.package_id=p_package and p.kind='PHOTO'
        and not exists (
          select 1 from jsonb_array_elements(k.approved_manifest->'selected_photos') x
          where x->>'photo_id'=p.photo_id::text
            and x->>'observed_sha256'=p.expected_sha256
            and (x->>'observed_size')::bigint=p.expected_size
        )
    ) then
    raise exception 'Partial or changed delivery reservation requires reconciliation'
      using errcode='40001';
  end if;
  select * into f from private.client_delivery_file_plans
    where package_id=p_package and kind='FOLDER' and state<>'VERIFIED';
  if f.id is not null then
    return jsonb_build_object('state','FOLDER','plan_id',f.id);
  end if;
  select * into f from private.client_delivery_file_plans
    where package_id=p_package and kind='PHOTO' and state<>'VERIFIED'
    order by photo_id limit 1;
  if f.id is not null then
    return jsonb_build_object('state','FILE','kind','PHOTO','plan_id',f.id);
  end if;
  select * into f from private.client_delivery_file_plans
    where package_id=p_package and kind='MANIFEST' and state<>'VERIFIED';
  if f.id is not null then
    return jsonb_build_object('state','FILE','kind','MANIFEST','plan_id',f.id);
  end if;
  return jsonb_build_object('state','RECEIPTS_READY_FOR_FINAL_RECHECK');
end;
$next$;
create function public.service_next_delivery_item(
  p_package uuid,p_worker uuid,p_generation bigint
) returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_next_delivery_item(p_package,p_worker,p_generation)
$wrap$;
revoke all on function private.service_next_delivery_item(uuid,uuid,bigint),
  public.service_next_delivery_item(uuid,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function private.service_next_delivery_item(uuid,uuid,bigint),
  public.service_next_delivery_item(uuid,uuid,bigint) to service_role;
