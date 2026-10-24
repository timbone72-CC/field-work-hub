-- Phase 5D source-only: verified optional State->City chain shares the
-- existing immutable create/recovery ledger. No provider readiness changes.
create or replace function private.phase_5_expected_geographic_path(
  p_package private.client_packages,
  p_geo private.client_delivery_geography
) returns jsonb language plpgsql stable set search_path='' as $expected$
declare
  d private.client_delivery_destinations%rowtype;
  root_key text; state_key text; county_key text; city_key text;
begin
  select * into d from private.client_delivery_destinations
    where id=p_package.destination_id;
  if d.id is null or not d.active or not d.verified
    or d.organization_id is distinct from p_package.organization_id
    or d.company_id is distinct from p_package.company_id
    or p_geo.id is null
    or p_geo.organization_id is distinct from p_package.organization_id
    or p_geo.company_id is distinct from p_package.company_id
    or p_geo.work_order_id is distinct from p_package.work_order_id
    or p_geo.verified_at>clock_timestamp()
    or p_package.folder_address_key is null then
    raise exception 'Verified matching geography and destination required'
      using errcode='42501';
  end if;
  root_key:=encode(sha256(convert_to(
    p_package.organization_id::text||':'||p_package.company_id::text||':'||
    d.id::text||':'||d.revision::text,'UTF8')),'hex');
  state_key:=private.geo_parent_path_key(root_key,'STATE',p_geo.normalized_state);
  county_key:=private.geo_parent_path_key(state_key,'COUNTY',p_geo.normalized_county);
  city_key:=private.geo_parent_path_key(case when p_package.approved_manifest->>'folder_layout'='STATE_CITY_ADDRESS' then state_key else county_key end,'CITY',p_geo.normalized_city);
  return jsonb_build_object(
    'layout',coalesce(p_package.approved_manifest->>'folder_layout','STATE_COUNTY_CITY_ADDRESS'),
    'organization_id',p_package.organization_id,
    'company_id',p_package.company_id,
    'destination_id',d.id,
    'destination_revision',d.revision,
    'destination_root',d.root_folder_id,
    'geography_revision',p_geo.revision,
    'state',p_geo.normalized_state,'state_key',state_key,
    'county',p_geo.normalized_county,'county_key',county_key,
    'city',p_geo.normalized_city,'city_key',city_key,
    'address_key',p_package.folder_address_key,
    'work_order_id',p_package.work_order_id);
end;
$expected$;

create or replace function private.phase_5_guard_approved_geographic_manifest()
returns trigger language plpgsql security definer set search_path='' as $guard$
declare
  geo private.client_delivery_geography%rowtype;
  expected jsonb;
  old_geo jsonb;
  new_geo jsonb;
begin
  new_geo:=new.approved_manifest->'geographic_path';
  if tg_op='UPDATE' then
    old_geo:=old.approved_manifest->'geographic_path';
    -- Once frozen, the full geographic path and manifest cannot be
    -- rewritten, even after registry corrections or status transitions.
    if old.status<>'DRAFT' and old_geo is not null then
      if new_geo is distinct from old_geo
        or new.approved_manifest is distinct from old.approved_manifest
        or new.approved_sha256 is distinct from old.approved_sha256
        or new.destination_id is distinct from old.destination_id then
        raise exception 'Approved geographic manifest is immutable'
          using errcode='40001';
      end if;
      return new;
    end if;
  end if;
  -- Legacy fixed-layout packages are preserved. Explicit geographic layout
  -- has no fallback to an address-only root when geography is absent.
  if new.status='DRAFT' then
    if new_geo is not null then
      raise exception 'Draft cannot assert an approved geographic path'
        using errcode='42501';
    end if;
    return new;
  end if;
  if new.approved_manifest->>'folder_layout' not in
      ('STATE_COUNTY_CITY_ADDRESS','STATE_CITY_ADDRESS') or new.approved_manifest->>'folder_layout' is null then
    if new_geo is not null then
      raise exception 'Geography requires explicit layout revision'
        using errcode='42501';
    end if;
    return new;
  end if;
  select * into geo from private.client_delivery_geography
    where organization_id=new.organization_id
      and company_id=new.company_id
      and work_order_id=new.work_order_id;
  expected:=private.phase_5_expected_geographic_path(new,geo);
  if new_geo is distinct from expected
    or new.approved_manifest->>'destination_revision' is distinct from
       expected->>'destination_revision'
    or new.approved_manifest->>'destination_root' is distinct from
       expected->>'destination_root' then
    raise exception 'Manifest geographic path is not verified and frozen'
      using errcode='42501';
  end if;
  return new;
end;
$guard$;

create or replace function private.service_plan_geographic_delivery_path(
  p_package uuid,p_worker uuid,p_generation bigint
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s'
as $path$
declare
  k private.client_packages%rowtype;
  d private.client_delivery_destinations%rowtype;
  frozen jsonb;
begin
  perform private.service_delivery_guard(p_package,p_worker,p_generation);
  select * into k from private.client_packages where id=p_package;
  frozen:=k.approved_manifest->'geographic_path';
  if k.id is null or k.status<>'DELIVERING'
    or k.approved_sha256 is null or k.folder_address_key is null
    or k.approved_manifest->>'folder_layout' not in ('STATE_COUNTY_CITY_ADDRESS','STATE_CITY_ADDRESS')
    or jsonb_typeof(frozen)<>'object'
    or frozen->>'address_key' is distinct from k.folder_address_key
    or frozen->>'work_order_id' is distinct from k.work_order_id::text
    or frozen->>'company_id' is distinct from k.company_id::text
    or frozen->>'organization_id' is distinct from k.organization_id::text
    or frozen->>'destination_id' is distinct from k.destination_id::text
    or frozen->>'destination_revision' is distinct from
       k.approved_manifest->>'destination_revision'
    or frozen->>'destination_root' is distinct from
       k.approved_manifest->>'destination_root' then
    raise exception 'Frozen geographic manifest required' using errcode='42501';
  end if;
  select * into d from private.client_delivery_destinations where id=k.destination_id;
  if d.id is null or not d.verified or not d.active
    or d.organization_id is distinct from k.organization_id
    or d.company_id is distinct from k.company_id
    or d.revision::text is distinct from frozen->>'destination_revision'
    or d.root_folder_id is distinct from frozen->>'destination_root' then
    raise exception 'Frozen client destination changed' using errcode='42501';
  end if;
  return frozen||jsonb_build_object('reservations_enabled',false);
end;
$path$;

create or replace function private.phase_5_guard_company_folder_layout()
returns trigger language plpgsql security definer set search_path='' as $guard$
declare selected jsonb; chosen text; configured boolean;
begin
 if new.status='DRAFT' then return new;end if;
 if tg_op='UPDATE' and old.status<>'DRAFT' then
   -- Previously approved packages preserve their original layout and
   -- revision even when company policy later changes.
   if new.approved_manifest is distinct from old.approved_manifest
     or new.approved_sha256 is distinct from old.approved_sha256
     or new.destination_id is distinct from old.destination_id then
     raise exception 'Approved package layout is immutable' using errcode='40001';
   end if;
   return new;
 end if;
 selected:=private.phase_5_current_folder_layout(
   new.destination_id,new.organization_id,new.company_id);
 configured:=selected->>'configured'='true';
 chosen:=new.approved_manifest->>'folder_layout';
 if configured then
   if chosen is distinct from selected->>'layout'
     or new.approved_manifest->>'folder_layout_revision'
         is distinct from selected->>'revision' then
     raise exception 'Approved layout does not match selected company policy'
       using errcode='42501';
   end if;
 else
   -- Legacy address-only approval remains supported until an Admin
   -- explicitly configures that company.
   if chosen is not null and chosen<>'ADDRESS_WORK_ORDER' then
     raise exception 'Explicit company folder layout configuration required'
       using errcode='42501';
   end if;
 end if;
 if coalesce(chosen,'ADDRESS_WORK_ORDER')='ADDRESS_WORK_ORDER'
   and new.approved_manifest ? 'geographic_path' then
   raise exception 'Address-only layout cannot claim geography'
     using errcode='42501';
 end if;
 return new;
end;
$guard$;

create or replace function private.service_delivery_parent_guard(
  p_package uuid,p_worker uuid,p_generation bigint,p_map uuid
) returns private.client_delivery_parent_maps
language plpgsql security definer set search_path='' set lock_timeout='5s' as $guard$
declare
 k private.client_packages%rowtype; d private.client_delivery_destinations%rowtype;
 f private.client_delivery_parent_maps%rowtype;
 p private.client_delivery_parent_maps%rowtype;
 m jsonb; geo jsonb; layout text;
 expected_kind text; expected_key text;
 shared boolean;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into k from private.client_packages where id=p_package;
 if k.id is null or k.status<>'DELIVERING' or k.approved_manifest is null
   or k.folder_address_key is null then
   raise exception 'Current frozen package required' using errcode='42501';end if;
 m:=k.approved_manifest;layout:=coalesce(m->>'folder_layout','ADDRESS_WORK_ORDER');
 select * into d from private.client_delivery_destinations where id=k.destination_id;
 if d.id is null or d.organization_id is distinct from k.organization_id
  or d.company_id is distinct from k.company_id or not d.verified or not d.active
  or d.revision::text is distinct from m->>'destination_revision'
  or d.root_folder_id is distinct from m->>'destination_root' then
  raise exception 'Frozen client destination required' using errcode='42501';end if;
 select * into f from private.client_delivery_parent_maps where id=p_map for update;
 if f.id is null or f.organization_id is distinct from k.organization_id
  or f.company_id is distinct from k.company_id or f.destination_id is distinct from d.id
  or f.destination_revision is distinct from d.revision or f.state='UNCERTAIN'
 then raise exception 'Exact company-scoped folder map required' using errcode='42501';end if;
 shared:=f.kind in ('STATE','COUNTY','CITY');
 if layout='ADDRESS_WORK_ORDER' then
   if f.geography_revision is not null or f.geographic_path_key is not null
     or f.kind not in ('ADDRESS','WORK_ORDER')
     or f.address_key is distinct from k.folder_address_key then
     raise exception 'Legacy layout may not reference geographic nodes'
       using errcode='42501';end if;
   if f.kind='ADDRESS' then
     if f.work_order_id is not null or f.parent_map_id is not null
       or f.parent_remote_id is distinct from d.root_folder_id then
       raise exception 'Legacy address must be under client root' using errcode='42501';end if;
     return f;
   end if;
   expected_kind:='ADDRESS';
 else
   if layout not in ('STATE_COUNTY_CITY_ADDRESS','STATE_CITY_ADDRESS')
     or jsonb_typeof(m->'geographic_path')<>'object' then
     raise exception 'Unsupported or unfrozen geographic layout' using errcode='42501';end if;
   geo:=m->'geographic_path';
   if geo->>'organization_id' is distinct from k.organization_id::text
     or geo->>'company_id' is distinct from k.company_id::text
     or geo->>'destination_id' is distinct from d.id::text
     or geo->>'destination_revision' is distinct from d.revision::text
     or geo->>'destination_root' is distinct from d.root_folder_id
     or geo->>'work_order_id' is distinct from k.work_order_id::text
     or geo->>'address_key' is distinct from k.folder_address_key
     or geo->>'geography_revision' is null then
     raise exception 'Frozen company geography required' using errcode='42501';end if;
   if f.kind not in ('STATE','COUNTY','CITY','ADDRESS','WORK_ORDER')
     or (not shared and (f.geography_revision::text is distinct from geo->>'geography_revision'
       or f.address_key is distinct from k.folder_address_key)) then
     raise exception 'Wrong geographic leaf or parent' using errcode='42501';end if;
   expected_key:=case f.kind
     when 'STATE' then geo->>'state_key'
     when 'COUNTY' then geo->>'county_key'
     when 'CITY' then geo->>'city_key'
     when 'ADDRESS' then k.folder_address_key else k.work_order_id::text end;
   if f.folder_key is distinct from expected_key then
     raise exception 'Frozen geographic path key mismatch' using errcode='42501';end if;
   if f.kind='STATE' then
     if f.parent_map_id is not null
       or f.parent_remote_id is distinct from d.root_folder_id
       or f.geographic_path_key is distinct from geo->>'state_key' then
       raise exception 'STATE must be directly under exact client root' using errcode='42501';end if;
     return f;
   end if;
   expected_kind:=case f.kind
     when 'COUNTY' then 'STATE' when 'CITY' then case when layout='STATE_CITY_ADDRESS' then 'STATE' else 'COUNTY' end
     when 'ADDRESS' then 'CITY' else 'ADDRESS' end;
   if (f.kind='COUNTY' and layout='STATE_CITY_ADDRESS')
     or (f.kind='COUNTY' and f.geographic_path_key is distinct from geo->>'county_key')
     or (f.kind='CITY' and f.geographic_path_key is distinct from geo->>'city_key')
     or (f.kind='ADDRESS' and f.geographic_path_key is distinct from geo->>'city_key') then
     raise exception 'Parent geographic path mismatch' using errcode='42501';end if;
 end if;
 if (f.kind='WORK_ORDER' and f.work_order_id is distinct from k.work_order_id)
   or (f.kind<>'WORK_ORDER' and f.work_order_id is not null) then
   raise exception 'Work order identity mismatch' using errcode='42501';end if;
 select * into p from private.client_delivery_parent_maps where id=f.parent_map_id;
 if p.id is null or p.kind is distinct from expected_kind or p.state<>'VERIFIED'
   or p.organization_id is distinct from f.organization_id
   or p.company_id is distinct from f.company_id
   or p.destination_id is distinct from f.destination_id
   or p.destination_revision is distinct from f.destination_revision
   or f.parent_remote_id is distinct from p.remote_folder_id then
   raise exception 'Verified exact-company predecessor required' using errcode='42501';end if;
 if layout='ADDRESS_WORK_ORDER' then
   if p.address_key is distinct from k.folder_address_key then
     raise exception 'Legacy address parent changed' using errcode='42501';end if;
 else
   if (f.kind='COUNTY' and p.folder_key is distinct from geo->>'state_key')
     or (f.kind='CITY' and p.folder_key is distinct from case when layout='STATE_CITY_ADDRESS' then geo->>'state_key' else geo->>'county_key' end)
     or (f.kind='ADDRESS' and p.folder_key is distinct from geo->>'city_key')
     or (f.kind='WORK_ORDER' and p.folder_key is distinct from k.folder_address_key)
     or (not shared and p.geography_revision::text is distinct from
         geo->>'geography_revision' and f.kind='WORK_ORDER') then
     raise exception 'Wrong frozen geographic predecessor' using errcode='42501';end if;
 end if;
 return f;
end;
$guard$;

create or replace function private.service_geographic_parent_plan(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $plan$
declare k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 g jsonb; predecessor private.client_delivery_parent_maps%rowtype;
 key text; label text; ancestor text; predecessor_kind text;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 if p_kind not in ('STATE','COUNTY','CITY') then
   raise exception 'Exact geographic kind required' using errcode='22023';end if;
 select * into k from private.client_packages where id=p_package;
 if k.id is null or k.status<>'DELIVERING' or k.approved_sha256 is null
  or k.approved_manifest->>'folder_layout' not in ('STATE_COUNTY_CITY_ADDRESS','STATE_CITY_ADDRESS') then
   raise exception 'Approved geographic package required' using errcode='42501';end if;
 if p_kind='COUNTY' and k.approved_manifest->>'folder_layout'='STATE_CITY_ADDRESS' then
   raise exception 'COUNTY not part of chosen layout' using errcode='42501';end if;
 g:=private.service_plan_geographic_delivery_path(p_package,p_worker,p_generation);
 select * into d from private.client_delivery_destinations where id=k.destination_id;
 if d.id is null or d.organization_id is distinct from k.organization_id
   or d.company_id is distinct from k.company_id or not d.active or not d.verified
   or d.revision::text is distinct from g->>'destination_revision'
   or d.root_folder_id is distinct from g->>'destination_root' then
   raise exception 'Current verified company root required' using errcode='42501';end if;
 key:=case p_kind when 'STATE' then g->>'state_key'
   when 'COUNTY' then g->>'county_key' else g->>'city_key' end;
 label:=case p_kind when 'STATE' then g->>'state'
   when 'COUNTY' then g->>'county' else g->>'city' end;
 if key !~ '^[a-f0-9]{64}$' or char_length(label) not between 2 and 100 then
   raise exception 'Frozen geography path invalid' using errcode='42501';end if;
 if p_kind='STATE' then
   return jsonb_build_object('kind',p_kind,'key',key,'label',label,
     'parent_map_id',null,'parent_id',d.root_folder_id,
     'destination_id',d.id,'destination_revision',d.revision);
 end if;
 predecessor_kind:=case p_kind when 'COUNTY' then 'STATE'
 when 'CITY' then case when k.approved_manifest->>'folder_layout'='STATE_CITY_ADDRESS' then 'STATE' else 'COUNTY' end end;
 ancestor:=case when predecessor_kind='STATE' then g->>'state_key' else g->>'county_key' end;
 select * into predecessor from private.client_delivery_parent_maps
 where organization_id=k.organization_id and company_id=k.company_id
  and destination_id=d.id and destination_revision=d.revision
  and kind=predecessor_kind and folder_key=ancestor;
 if predecessor.id is null or predecessor.state<>'VERIFIED' then
   raise exception 'Verified geographic ancestor required' using errcode='42501';end if;
 perform private.service_delivery_parent_guard(p_package,p_worker,p_generation,predecessor.id);
 return jsonb_build_object('kind',p_kind,'key',key,'label',label,
   'parent_map_id',predecessor.id,'parent_id',predecessor.remote_folder_id,
   'destination_id',d.id,'destination_revision',d.revision);
end;
$plan$;

create or replace function private.service_geographic_leaf_plan(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $plan$
declare k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 g jsonb; predecessor private.client_delivery_parent_maps%rowtype;
 ancestor_key text; ancestor_kind text; leaf_key text; leaf_name text;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 if p_kind not in ('ADDRESS','WORK_ORDER') then
  raise exception 'Geographic leaf kind required' using errcode='22023';end if;
 select * into k from private.client_packages where id=p_package;
 if k.id is null or k.status<>'DELIVERING'
   or k.approved_manifest->>'folder_layout' not in ('STATE_COUNTY_CITY_ADDRESS','STATE_CITY_ADDRESS')
   or k.folder_address_key is null then
  raise exception 'Frozen geographic package required' using errcode='42501';end if;
 g:=private.service_plan_geographic_delivery_path(p_package,p_worker,p_generation);
 select * into d from private.client_delivery_destinations where id=k.destination_id;
 if d.id is null or not d.active or not d.verified
   or d.organization_id is distinct from k.organization_id
   or d.company_id is distinct from k.company_id
   or d.revision::text is distinct from g->>'destination_revision'
   or d.root_folder_id is distinct from g->>'destination_root' then
  raise exception 'Verified exact client destination required' using errcode='42501';end if;
 ancestor_kind:=case p_kind when 'ADDRESS' then 'CITY' else 'ADDRESS' end;
 ancestor_key:=case p_kind when 'ADDRESS' then g->>'city_key' else k.folder_address_key end;
 leaf_key:=case p_kind when 'ADDRESS' then k.folder_address_key else k.work_order_id::text end;
 leaf_name:=case p_kind when 'ADDRESS' then
  left(regexp_replace(k.folder_address_snapshot,'[[:cntrl:]/]',' ','g'),100)
  ||' - '||left(k.folder_address_key,12)
  else 'work-order-'||k.work_order_id::text end;
 select * into predecessor from private.client_delivery_parent_maps
  where organization_id=k.organization_id and company_id=k.company_id
   and destination_id=d.id and destination_revision=d.revision
   and kind=ancestor_kind and folder_key=ancestor_key;
 if predecessor.id is null or predecessor.state<>'VERIFIED' then
  raise exception 'Verified exact geographic predecessor required' using errcode='42501';end if;
 perform private.service_delivery_parent_guard(p_package,p_worker,p_generation,predecessor.id);
 return jsonb_build_object('kind',p_kind,'key',leaf_key,'name',leaf_name,
   'parent_map_id',predecessor.id,'parent_id',predecessor.remote_folder_id,
   'destination_id',d.id,'destination_revision',d.revision,
   'geography_revision',g->>'geography_revision',
   'city_key',g->>'city_key','address_key',k.folder_address_key);
end;
$plan$;

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
    if selected_layout->>'layout' in ('STATE_COUNTY_CITY_ADDRESS','STATE_CITY_ADDRESS') then
      select * into geo from private.client_delivery_geography
        where organization_id=k.organization_id and company_id=k.company_id
          and work_order_id=k.work_order_id;
      -- Existing strict verification and no-fallback rule; no guess from ZIP.
      k.destination_id:=d.id;
      k.approved_manifest:=jsonb_build_object('folder_layout',selected_layout->>'layout');
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
    end if;
  end if;
  return manifest;
end;
$manifest$;
