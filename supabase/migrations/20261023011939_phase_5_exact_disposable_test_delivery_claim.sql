-- Phase 5D: one approved disposable TEST package, atomic exact claim.
-- SOURCE ONLY: this migration neither queues nor dispatches provider work.
-- Retain the existing private.service_claim_delivery transaction/lease owner.
-- An unintended broad claim RAISES, rolling back all status mutations.

create function private.service_claim_exact_test_delivery(
  p_worker uuid,
  p_package uuid,
  p_destination uuid,
  p_root text
)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $claim$
declare
  target private.client_packages%rowtype;
  result jsonb;
  member_count bigint;
  matched_count bigint;
  distinct_count bigint;
begin
  if p_worker is null or p_package is null or p_destination is null
    or p_root is null or p_root !~ '^[A-Za-z0-9_-]{10,160}$'
  then
    raise exception 'Exact disposable TEST identities required'
      using errcode='22023';
  end if;

  select * into target
    from private.client_packages where id=p_package;

  if target.id is null
    or target.destination_id is distinct from p_destination
    or target.approved_sha256 is null
    or target.approved_sha256 !~ '^[a-f0-9]{64}$'
    or target.approved_manifest is null
    or target.approved_manifest->>'package_id' is distinct from p_package::text
    or target.approved_manifest->>'destination_id' is distinct from p_destination::text
    or target.approved_manifest->>'destination_root' is distinct from p_root
  then
    raise exception 'Frozen disposable TEST package identity denied'
      using errcode='42501';
  end if;

  -- Business labels are an additional TEST-only fence, never the identity:
  -- the actual work order, company, package and root retain their UUID/ID.
  if not exists (
    select 1
      from public.work_orders w
      join private.client_companies c
        on c.id=target.company_id
       and c.organization_id=target.organization_id
      join private.client_delivery_destinations d
        on d.id=p_destination
       and d.organization_id=target.organization_id
       and d.company_id=target.company_id
     where w.id=target.work_order_id
       and w.organization_id=target.organization_id
       and w.client_company_id=target.company_id
       and w.wo_number='TEST-0003-DASHBOARD'
       and c.name='FWH TEST CLIENT' and c.active
       and d.provider='GOOGLE_DRIVE' and d.verified and d.active
       and d.root_folder_id=p_root
       and target.approved_manifest->>'destination_revision'=d.revision::text
  ) then
    raise exception 'Disposable TEST destination denied'
      using errcode='42501';
  end if;

  if jsonb_typeof(target.approved_manifest->'selected_photos')
       is distinct from 'array'
     or jsonb_array_length(target.approved_manifest->'selected_photos')<>2
  then
    raise exception 'Exactly two frozen TEST photos required'
      using errcode='42501';
  end if;

  select count(*) into member_count
    from private.client_package_photos where package_id=p_package;
  select count(*),count(distinct selected.photo->>'photo_id')
    into matched_count,distinct_count
    from jsonb_array_elements(
      target.approved_manifest->'selected_photos'
    ) as selected(photo)
    join private.client_package_photos cp
      on cp.package_id=p_package
     and cp.photo_id::text=selected.photo->>'photo_id';
  if member_count<>2 or matched_count<>2 or distinct_count<>2 then
    raise exception 'Frozen TEST photos do not match package membership'
      using errcode='42501';
  end if;

  -- No target queued: no claim. Never start unrelated queued work.
  if target.status<>'QUEUED' or not exists(
    select 1 from private.client_delivery_outbox o
     where o.package_id=p_package
       and o.destination_id=p_destination
       and o.approved_sha256=target.approved_sha256
       and o.state='QUEUED' and o.attempts=0 and o.worker_id is null
  ) then
    return jsonb_build_object('claimed',false);
  end if;

  -- The existing claim performs its original locks, lease and validation.
  -- PostgreSQL rolls back ALL of its DB writes if the result is not exactly
  -- the authorized package, even if a different queued item sorted first.
  result:=private.service_claim_delivery(p_worker);

  if result->>'claimed'='false' then
    return result;
  end if;
  if result->>'claimed' is distinct from 'true'
    or result->>'package_id' is distinct from p_package::text
    or result->>'destination_id' is distinct from p_destination::text
    or result->>'approved_sha256' is distinct from target.approved_sha256
    or result->'manifest' is distinct from target.approved_manifest
  then
    raise exception 'Unexpected claim rolled back'
      using errcode='42501';
  end if;
  return result;
end;
$claim$;

-- Keep an invoker wrapper in exposed public; permit only trusted service JWT.
create function public.service_claim_exact_test_delivery(
  p_worker uuid,p_package uuid,p_destination uuid,p_root text
)
returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_claim_exact_test_delivery(
    p_worker,p_package,p_destination,p_root
  )
$wrap$;

revoke all on function
  private.service_claim_exact_test_delivery(uuid,uuid,uuid,text),
  public.service_claim_exact_test_delivery(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function
  private.service_claim_exact_test_delivery(uuid,uuid,uuid,text),
  public.service_claim_exact_test_delivery(uuid,uuid,uuid,text)
  to service_role;
