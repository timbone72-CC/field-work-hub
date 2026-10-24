-- Phase 5D candidate: bind geographic folder path to the approved manifest.
-- Keep provider readiness OFF. This does not reserve/create geographic parents.
-- Existing fixed-layout approved packages remain unchanged.
create function private.phase_5_expected_geographic_path(
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
  city_key:=private.geo_parent_path_key(county_key,'CITY',p_geo.normalized_city);
  return jsonb_build_object(
    'layout','STATE_COUNTY_CITY_ADDRESS',
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
revoke all on function private.phase_5_expected_geographic_path(
  private.client_packages,private.client_delivery_geography)
  from public,anon,authenticated,service_role;

create function private.phase_5_guard_approved_geographic_manifest()
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
  if new.approved_manifest->>'folder_layout' is distinct from
      'STATE_COUNTY_CITY_ADDRESS' then
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
create trigger phase_5_approved_geographic_manifest
 before insert or update on private.client_packages
 for each row execute function private.phase_5_guard_approved_geographic_manifest();
revoke all on function private.phase_5_guard_approved_geographic_manifest()
  from public,anon,authenticated,service_role;

-- Replace read-only resolver with approved-snapshot validation. The current
-- registry may change after approval; it may NEVER redirect an in-flight
-- package. Do not grant a geographic reservation RPC here.
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
    or k.approved_manifest->>'folder_layout'<>'STATE_COUNTY_CITY_ADDRESS'
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
revoke all on function private.service_plan_geographic_delivery_path(uuid,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function private.service_plan_geographic_delivery_path(uuid,uuid,bigint)
  to service_role;
