-- Source-only Phase 5D: one authoritative Preview/Approve/Send manifest
-- projection honors a client Admin's explicitly versioned layout.
-- Do not enable delivery, perform Drive writes, or deploy this alone.
create or replace function private.client_package_manifest(p_package uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $manifest$
declare k private.client_packages%rowtype; w public.work_orders%rowtype;
  d private.client_delivery_destinations%rowtype; req jsonb; item jsonb;
  v_photos jsonb:='[]'::jsonb; n integer:=0; selected_count integer; required_total integer;
  selected_named integer; p record;
  selected_layout jsonb; manifest jsonb; geo private.client_delivery_geography%rowtype;
begin
  select * into k from private.client_packages where id=p_package;
  if k.id is null then raise exception 'Package unavailable' using errcode='42501';end if;
  select * into w from public.work_orders where id=k.work_order_id;
  if w.organization_id is distinct from k.organization_id or w.client_company_id is distinct from k.company_id
    or w.current_run_id is distinct from k.run_id or w.field_status<>'FIELD_COMPLETE' then
    raise exception 'Current accepted work identity changed or Finish missing' using errcode='40001';end if;
  if exists(select 1 from private.client_packages prior
     where prior.work_order_id=w.id and prior.id<>k.id
       and prior.status in ('QUEUED','DELIVERING','FAILED','UNCERTAIN')) then
    raise exception 'Earlier client delivery unresolved' using errcode='40001';end if;
  select * into d from private.client_delivery_destinations
    where organization_id=k.organization_id and company_id=k.company_id
      and active and verified
      and (k.status='DRAFT' or id=k.destination_id);
  if d.id is null then raise exception 'Verified client destination required' using errcode='42501';end if;
  select requirement_snapshot into req from public.work_order_runs where id=k.run_id;
  perform private.validate_photo_requirements(req);
  select count(*) into selected_count from private.client_package_photos where package_id=k.id;
  if selected_count>5000 then raise exception 'Package selection too large' using errcode='22023';end if;
  for p in
    select s.ordinal,s.photo_id,t.run_id,t.version,r.observed_sha256,r.observed_size,
      ph.requirement_item_id,coalesce(dec.decision,'PENDING') as decision
    from private.client_package_photos s
    join private.photo_transfers t on t.photo_id=s.photo_id
    join private.photo_transfer_receipts r on r.photo_id=t.photo_id and r.transfer_version=t.version
    join public.photos ph on ph.id=t.photo_id and ph.work_order_id=k.work_order_id
    left join private.photo_review_decisions dec on dec.photo_id=t.photo_id
    join storage.objects ob on ob.id=r.object_id and ob.version=r.object_version
      and ob.bucket_id=r.bucket and ob.name=r.object_key and ob.owner_id=r.owner_user_id::text
      and ob.archived_at is null and not coalesce(ob.is_delete_marker,false)
    where s.package_id=k.id and t.run_id=k.run_id and t.state='RECEIVED'
    order by s.ordinal
  loop
    if p.decision='REJECTED' or (w.review_required and p.decision<>'APPROVED')
      or not private.photo_has_accepted_finish(p.photo_id) then
      raise exception 'Selected evidence not approved, received or Finish-accepted' using errcode='42501';end if;
    n:=n+1;
    v_photos:=v_photos||jsonb_build_array(jsonb_build_object('ordinal',p.ordinal,
      'photo_id',p.photo_id,'run_id',p.run_id,'transfer_version',p.version,
      'observed_sha256',p.observed_sha256,'observed_size',p.observed_size,'item_id',p.requirement_item_id,
      'review_decision',p.decision));
  end loop;
  if n<>selected_count then
    raise exception 'Missing or foreign private receipt, rejected photo, or changed Storage object' using errcode='42501';end if;
  required_total:=case when (req->'total'->>'enabled')::boolean then (req->'total'->>'minimum')::integer else 0 end;
  if n<required_total then raise exception 'Package total photo coverage incomplete' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(req->'items') loop
    if (item->>'enabled')::boolean then
      select count(*) into selected_named from jsonb_array_elements(v_photos) photo
        where photo->>'item_id'=item->>'id';
      if selected_named<(item->>'minimum')::integer then
        raise exception 'Required named photo coverage incomplete' using errcode='22023';end if;
    end if;
  end loop;
  manifest:=jsonb_build_object('package_id',k.id,'organization_id',k.organization_id,
    'work_order_id',w.id,'client_company_id',k.company_id,'client_wo_number',w.wo_number,
    'client_notes',k.notes,'current_run_id',k.run_id,'requirements',req,
    'review_required',w.review_required,'review_policy_revision',w.review_policy_revision,
    'destination_id',d.id,'destination_revision',d.revision,'destination_provider',d.provider,
    'destination_root',d.root_folder_id,'selected_photos',v_photos);
  -- Rebuild live release evidence, but retain the ORIGINAL approved layout
  -- and remote destination snapshot. A newer company configuration cannot
  -- redirect an already approved package during Send reconciliation.
  if k.status<>'DRAFT' and k.approved_manifest is not null then
    if k.approved_manifest->>'destination_id' is distinct from d.id::text
      or k.approved_manifest->>'destination_revision' is distinct from d.revision::text
      or k.approved_manifest->>'destination_root' is distinct from d.root_folder_id then
      raise exception 'Approved destination identity changed' using errcode='40001';
    end if;
    if k.approved_manifest ? 'folder_layout' then
      manifest:=manifest||jsonb_build_object(
        'folder_layout',k.approved_manifest->>'folder_layout',
        'folder_layout_revision',k.approved_manifest->>'folder_layout_revision');
    end if;
    if k.approved_manifest ? 'geographic_path' then
      manifest:=manifest||jsonb_build_object(
        'geographic_path',k.approved_manifest->'geographic_path');
    end if;
    return manifest;
  end if;
  selected_layout:=private.phase_5_current_folder_layout(d.id,k.organization_id,k.company_id);
  if selected_layout->>'configured'='true' then
    manifest:=manifest||jsonb_build_object(
      'folder_layout',selected_layout->>'layout',
      'folder_layout_revision',selected_layout->>'revision');
    if selected_layout->>'layout'='STATE_COUNTY_CITY_ADDRESS' then
      select * into geo from private.client_delivery_geography
        where organization_id=k.organization_id and company_id=k.company_id
          and work_order_id=k.work_order_id;
      -- Existing strict verification and no-fallback rule; no guess from ZIP.
      k.destination_id:=d.id;
      -- Draft previews do not yet have the approval trigger's frozen address.
      -- Compute the same canonical key, then the trigger independently freezes
      -- that identical current WO address at the approval transaction.
      k.folder_address_snapshot:=btrim(w.property_address);
      if char_length(k.folder_address_snapshot) not between 3 and 320 then
        raise exception 'Address snapshot unavailable' using errcode='22023';end if;
      k.folder_address_key:=encode(sha256(convert_to(
        lower(regexp_replace(btrim(w.property_address),'[[:space:]]+',' ','g')),'UTF8')),'hex');
      manifest:=manifest||jsonb_build_object(
        'geographic_path',private.phase_5_expected_geographic_path(k,geo));
    elsif selected_layout->>'layout'='STATE_CITY_ADDRESS' then
      raise exception 'State/City delivery layout not enabled'
        using errcode='42501';
    end if;
  end if;
  return manifest;
end;
$manifest$;
