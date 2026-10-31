-- Phase 5D source-only: fail-closed geographic lookup for the existing
-- company-scoped delivery lease. No folder creation or delivery activation.
-- Parent-map migration must consume this verified result before new geographic
-- levels may be reserved; a missing record cannot be inferred from a ZIP.
create function private.service_verified_delivery_geography(
  p_package uuid, p_worker uuid, p_generation bigint
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s'
as $geo$
declare
  k private.client_packages%rowtype;
  g private.client_delivery_geography%rowtype;
begin
  perform private.service_delivery_guard(p_package,p_worker,p_generation);
  select * into k from private.client_packages where id=p_package;
  if k.id is null or k.status<>'DELIVERING'
     or k.approved_manifest is null or k.approved_sha256 is null
     or k.folder_address_key is null then
    raise exception 'Frozen approved package required' using errcode='42501';
  end if;
  select * into g from private.client_delivery_geography
    where organization_id=k.organization_id
      and company_id=k.company_id
      and work_order_id=k.work_order_id;
  if g.id is null or g.verification_source is null
     or g.verified_by is null or g.verified_at is null
     or g.verified_at>clock_timestamp()
     or g.normalized_state='' or g.normalized_county=''
     or g.normalized_city='' then
    raise exception 'Verified state, county and city required'
      using errcode='42501';
  end if;
  -- The selected hierarchy revision must later be frozen into the approval
  -- manifest; this reader alone cannot authorize an actual Drive POST.
  return jsonb_build_object(
    'organization_id',g.organization_id,
    'company_id',g.company_id,
    'work_order_id',g.work_order_id,
    'state',g.normalized_state,
    'county',g.normalized_county,
    'city',g.normalized_city,
    'geography_revision',g.revision,
    'verified_at',g.verified_at);
end;
$geo$;
create function public.service_verified_delivery_geography(
  p_package uuid,p_worker uuid,p_generation bigint
) returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_verified_delivery_geography(p_package,p_worker,p_generation)
$wrap$;
revoke all on function private.service_verified_delivery_geography(uuid,uuid,bigint),
 public.service_verified_delivery_geography(uuid,uuid,bigint)
 from public,anon,authenticated,service_role;
grant execute on function private.service_verified_delivery_geography(uuid,uuid,bigint),
 public.service_verified_delivery_geography(uuid,uuid,bigint)
 to service_role;
