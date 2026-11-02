-- Phase 5D: exact disposable TEST original-lease recovery (source only).
-- Canonical timestamp was created by the operator using Supabase CLI.
-- Does not deploy, run Google Drive, reclaim another worker, enable cron,
-- requeue, change package identity, or authorize customer Send.
-- The existing service_delivery_guard still rejects expired leases until a
-- separately verified one-shot recovery transaction succeeds.

create table private.client_delivery_test_lease_recoveries (
  package_id uuid primary key references private.client_packages(id) on delete restrict,
  worker_id uuid not null,
  lease_generation bigint not null check (lease_generation = 1),
  original_lease_until timestamptz not null,
  parent_map_id uuid not null references private.client_delivery_parent_maps(id) on delete restrict,
  remote_folder_id text not null,
  observed_at timestamptz not null,
  request_id uuid not null unique,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table private.client_delivery_test_lease_recoveries enable row level security;
revoke all on private.client_delivery_test_lease_recoveries
  from public, anon, authenticated, service_role;
create trigger test_delivery_lease_recovery_immutable
  before update or delete on private.client_delivery_test_lease_recoveries
  for each row execute function private.protect_photo_transfer_ledger();

-- Read only one exact two-photo TEST package's original expired reservation.
-- No generic listing, client-supplied worker, provider ID or replacement ID.
create function private.service_read_expired_test_delivery_reservation(
  p_package uuid, p_destination uuid, p_root text
)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $read$
declare
  k private.client_packages%rowtype;
  o private.client_delivery_outbox%rowtype;
  f private.client_delivery_parent_maps%rowtype;
  members bigint;
  matched bigint;
  distinct_photos bigint;
begin
  if p_package is null or p_destination is null or p_root is null
    or p_root !~ '^[A-Za-z0-9_-]{10,160}$'
  then raise exception 'Exact TEST recovery identities required' using errcode='22023'; end if;

  select * into k from private.client_packages where id=p_package;
  select * into o from private.client_delivery_outbox where package_id=p_package;
  if k.id is null or o.package_id is null
    or k.status <> 'DELIVERING' or o.state <> 'DELIVERING'
    or k.destination_id is distinct from p_destination
    or o.destination_id is distinct from p_destination
    or k.approved_sha256 is null
    or k.approved_sha256 !~ '^[a-f0-9]{64}$'
    or o.approved_sha256 is distinct from k.approved_sha256
    or k.approved_manifest is null
    or k.approved_manifest->>'package_id' is distinct from p_package::text
    or k.approved_manifest->>'destination_id' is distinct from p_destination::text
    or k.approved_manifest->>'destination_root' is distinct from p_root
    or coalesce(k.approved_manifest->>'folder_layout','ADDRESS_WORK_ORDER') <> 'ADDRESS_WORK_ORDER'
    or k.folder_address_key is null
    or o.worker_id is null or o.lease_generation <> 1 or o.attempts <> 1
    or o.lease_until is null or o.lease_until >= clock_timestamp()
    or o.uncertain_reason is not null
  then raise exception 'Original expired TEST lease not eligible' using errcode='42501'; end if;

  -- Business names are supplementary TEST fences, never persistent identity.
  if not exists (
    select 1 from public.work_orders w
    join private.client_companies c
      on c.id=k.company_id and c.organization_id=k.organization_id
    join private.client_delivery_destinations d
      on d.id=p_destination and d.company_id=k.company_id
     and d.organization_id=k.organization_id
    where w.id=k.work_order_id and w.organization_id=k.organization_id
      and w.client_company_id=k.company_id
      and w.wo_number='TEST-0003-DASHBOARD'
      and c.name='FWH TEST CLIENT' and c.active
      and d.provider='GOOGLE_DRIVE' and d.verified and d.active
      and d.root_folder_id=p_root
      and d.revision::text=k.approved_manifest->>'destination_revision'
  ) then raise exception 'Frozen TEST customer destination denied' using errcode='42501'; end if;

  if jsonb_typeof(k.approved_manifest->'selected_photos') is distinct from 'array'
    or jsonb_array_length(k.approved_manifest->'selected_photos') <> 2
  then raise exception 'Exactly two frozen TEST photos required' using errcode='42501'; end if;

  select count(*) into members from private.client_package_photos
    where package_id=p_package;
  select count(*),count(distinct x.value->>'photo_id') into matched,distinct_photos
    from jsonb_array_elements(k.approved_manifest->'selected_photos') x(value)
    join private.client_package_photos cp
      on cp.package_id=p_package and cp.photo_id::text=x.value->>'photo_id';
  if members<>2 or matched<>2 or distinct_photos<>2
  then raise exception 'Exact frozen TEST photo membership required' using errcode='42501'; end if;

  if exists(select 1 from private.client_delivery_outbox
      where package_id<>p_package and state='DELIVERING')
    or exists(select 1 from private.client_delivery_file_plans where package_id=p_package)
    or exists(select 1 from private.client_delivery_upload_sessions where package_id=p_package)
    or exists(select 1 from private.client_delivery_final_receipts where package_id=p_package)
    or exists(select 1 from private.client_delivery_dispatch_permit)
    or exists(select 1 from private.client_delivery_test_lease_recoveries where package_id=p_package)
  then raise exception 'Existing delivery evidence requires separate reconciliation' using errcode='42501'; end if;

  select * into f from private.client_delivery_parent_maps
   where organization_id=k.organization_id and company_id=k.company_id
     and destination_id=p_destination
     and destination_revision=(k.approved_manifest->>'destination_revision')::uuid
     and kind='ADDRESS' and folder_key=k.folder_address_key;
  if f.id is null or f.state <> 'RESERVED' or f.create_attempts <> 0
    or f.verified_at is not null or f.remote_evidence is not null
    or f.parent_remote_id is distinct from p_root or f.parent_map_id is not null
    or f.work_order_id is not null
    or f.address_key is distinct from k.folder_address_key
    or f.geography_revision is not null or f.geographic_path_key is not null
    or f.remote_folder_id is null
    or f.remote_folder_id !~ '^[A-Za-z0-9_-]{10,160}$'
    or f.remote_folder_id = p_root
    or exists(select 1 from private.client_delivery_parent_maps other
       where other.destination_id=p_destination
         and other.destination_revision=f.destination_revision
         and other.id<>f.id)
  then raise exception 'Only untouched original ADDRESS reservation may recover' using errcode='42501'; end if;

  return jsonb_build_object(
    'state','EXPIRED_RESERVED_PARENT',
    'package_id',p_package,'destination_id',p_destination,
    'worker_id',o.worker_id,'generation',o.lease_generation,'attempts',o.attempts,
    'lease_until',o.lease_until,'approved_sha256',o.approved_sha256,
    'manifest',k.approved_manifest,
    'file_plans',0,'upload_sessions',0,'final_receipts',0,'dispatch_permits',0,
    'parent',jsonb_build_object('map_id',f.id,'kind',f.kind,'state',f.state,
      'create_attempts',f.create_attempts,'remote_folder_id',f.remote_folder_id,
      'parent_remote_id',f.parent_remote_id)
  );
end;
$read$;

create function public.service_read_expired_test_delivery_reservation(
  p_package uuid,p_destination uuid,p_root text
)
returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_read_expired_test_delivery_reservation(
    p_package,p_destination,p_root)
$wrap$;

-- Only a trusted backend with a fresh same-ID provider GET-404 observation
-- can assert absence. Database reconfirms unchanged immutable identities,
-- original expiration and all zero-attempt/downstream invariants atomically.
-- This single-use action NEVER changes worker ID, generation or attempt count.
create function private.service_resume_exact_test_expired_delivery(
  p_package uuid,p_destination uuid,p_root text,p_worker uuid,
  p_generation bigint,p_map uuid,p_remote_id text,
  p_expected_lease_until timestamptz,p_observed_at timestamptz,
  p_probe_result text,p_request uuid
)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $resume$
declare
  o private.client_delivery_outbox%rowtype;
  verified jsonb;
  lease_end timestamptz;
begin
  if p_worker is null or p_map is null or p_request is null
    or p_generation<>1 or p_remote_id is null
    or p_probe_result is distinct from 'GOOGLE_FILE_ID_NOT_FOUND'
    or p_expected_lease_until is null or p_observed_at is null
    or p_observed_at>clock_timestamp()
    or p_observed_at<clock_timestamp()-interval '30 seconds'
  then raise exception 'Current same-ID provider absence proof required'
    using errcode='42501'; end if;
  -- Serialize renewal with all original service_delivery_guard transactions.
  select * into o from private.client_delivery_outbox
    where package_id=p_package for update;
  if o.package_id is null or o.state<>'DELIVERING'
    or o.worker_id is distinct from p_worker
    or o.lease_generation is distinct from p_generation
    or o.attempts<>1 or o.lease_until is distinct from p_expected_lease_until
    or o.lease_until >= clock_timestamp() or o.uncertain_reason is not null
  then raise exception 'Expired original lease changed; deny recovery'
    using errcode='40001'; end if;

  verified:=private.service_read_expired_test_delivery_reservation(
    p_package,p_destination,p_root);
  if verified->>'state'<>'EXPIRED_RESERVED_PARENT'
    or verified->>'worker_id' is distinct from p_worker::text
    or (verified->>'generation')::bigint is distinct from p_generation
    or verified->'parent'->>'map_id' is distinct from p_map::text
    or verified->'parent'->>'remote_folder_id' is distinct from p_remote_id
    or (verified->>'lease_until')::timestamptz is distinct from p_expected_lease_until
    or not exists (select 1 from private.client_delivery_runtime rt
      join private.client_packages k on k.organization_id=rt.organization_id
     where k.id=p_package and rt.worker_ready
       and rt.worker_identity is not null
       and rt.last_verified_at>=now()-interval '24 hours')
  then raise exception 'Original TEST identity or worker readiness changed'
    using errcode='42501'; end if;

  -- Lock the immutable parent record before recording the one-shot recovery.
  perform 1 from private.client_delivery_parent_maps
    where id=p_map and remote_folder_id=p_remote_id and state='RESERVED'
      and create_attempts=0 and verified_at is null and remote_evidence is null
    for update;
  if not found then raise exception 'Original reserved remote ID changed'
    using errcode='40001'; end if;

  insert into private.client_delivery_test_lease_recoveries(
    package_id,worker_id,lease_generation,original_lease_until,
    parent_map_id,remote_folder_id,observed_at,request_id
  ) values (p_package,p_worker,p_generation,p_expected_lease_until,
    p_map,p_remote_id,p_observed_at,p_request);

  update private.client_delivery_outbox
    set lease_until=clock_timestamp()+interval '2 minutes',
        last_heartbeat_at=clock_timestamp()
    where package_id=p_package and worker_id=p_worker
      and lease_generation=p_generation and attempts=1
      and state='DELIVERING' and lease_until=p_expected_lease_until
    returning lease_until into lease_end;
  if lease_end is null
  then raise exception 'Original lease recovery CAS failed' using errcode='40001'; end if;

  return jsonb_build_object('status','ORIGINAL_TEST_LEASE_RESUMED',
    'package_id',p_package,'worker_id',p_worker,'generation',p_generation,
    'map_id',p_map,'remote_folder_id',p_remote_id,'expires_at',lease_end);
end;
$resume$;

create function public.service_resume_exact_test_expired_delivery(
  p_package uuid,p_destination uuid,p_root text,p_worker uuid,
  p_generation bigint,p_map uuid,p_remote_id text,
  p_expected_lease_until timestamptz,p_observed_at timestamptz,
  p_probe_result text,p_request uuid
)
returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_resume_exact_test_expired_delivery(
    p_package,p_destination,p_root,p_worker,p_generation,p_map,p_remote_id,
    p_expected_lease_until,p_observed_at,p_probe_result,p_request)
$wrap$;

revoke all on function
  private.service_read_expired_test_delivery_reservation(uuid,uuid,text),
  public.service_read_expired_test_delivery_reservation(uuid,uuid,text),
  private.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid),
  public.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function
  private.service_read_expired_test_delivery_reservation(uuid,uuid,text),
  public.service_read_expired_test_delivery_reservation(uuid,uuid,text),
  private.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid),
  public.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)
  to service_role;
