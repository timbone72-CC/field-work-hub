-- Phase 5D: resolve geographic parent keys under the original trusted lease.
-- Read-only planning only: never reserve/create a folder or authorize Send.
-- The next migration must freeze this path into approved manifest before
-- any geographic folder may be reserved or created.
create function private.service_plan_geographic_delivery_path(
  p_package uuid,p_worker uuid,p_generation bigint
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s'
as $path$
declare
  k private.client_packages%rowtype;
  g jsonb;
  d private.client_delivery_destinations%rowtype;
  state_key text; county_key text; city_key text;
  root_key text;
begin
  perform private.service_delivery_guard(p_package,p_worker,p_generation);
  select * into k from private.client_packages where id=p_package;
  if k.id is null or k.status<>'DELIVERING'
    or k.folder_address_key is null or k.approved_sha256 is null
    or k.approved_manifest is null then
    raise exception 'Approved frozen package required' using errcode='42501';end if;
  select * into d from private.client_delivery_destinations where id=k.destination_id;
  if d.id is null or d.organization_id is distinct from k.organization_id
    or d.company_id is distinct from k.company_id
    or not d.active or not d.verified
    or d.revision::text is distinct from k.approved_manifest->>'destination_revision'
    or d.root_folder_id is distinct from k.approved_manifest->>'destination_root' then
    raise exception 'Verified frozen client destination required' using errcode='42501';end if;
  g:=private.service_verified_delivery_geography(p_package,p_worker,p_generation);
  if g->>'company_id' is distinct from k.company_id::text
    or g->>'organization_id' is distinct from k.organization_id::text
    or g->>'work_order_id' is distinct from k.work_order_id::text then
    raise exception 'Cross-company geographic record denied' using errcode='42501';end if;
  -- Include destination and company in the root key. County keys include
  -- state, and city keys include county: identical names cannot collide.
  root_key:=encode(sha256(convert_to(
    k.organization_id::text||':'||k.company_id::text||':'||
    d.id::text||':'||d.revision::text,'UTF8')),'hex');
  state_key:=private.geo_parent_path_key(root_key,'STATE',g->>'state');
  county_key:=private.geo_parent_path_key(state_key,'COUNTY',g->>'county');
  city_key:=private.geo_parent_path_key(county_key,'CITY',g->>'city');
  return jsonb_build_object(
    'organization_id',k.organization_id,'company_id',k.company_id,
    'destination_id',d.id,'destination_revision',d.revision,
    'destination_root',d.root_folder_id,
    'geography_revision',g->>'geography_revision',
    'state',g->>'state','state_key',state_key,
    'county',g->>'county','county_key',county_key,
    'city',g->>'city','city_key',city_key,
    'address_key',k.folder_address_key,'work_order_id',k.work_order_id,
    'reservations_enabled',false);
end;
$path$;
revoke all on function private.service_plan_geographic_delivery_path(uuid,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function private.service_plan_geographic_delivery_path(uuid,uuid,bigint)
  to service_role;
-- Deliberately no public RPC wrapper: no client or Edge provider-write path.
