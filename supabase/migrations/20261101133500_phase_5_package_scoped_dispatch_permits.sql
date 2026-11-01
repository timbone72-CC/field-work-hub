-- Phase 5D: additive package-scoped dispatch authority. SOURCE ONLY.
-- This migration does not touch the original singleton dispatch/held photo,
-- create a scheduler, enable Send, contact Google, or activate the new worker.
-- The cutover stays disabled until a separately verified legacy-worker OFF gate.
--
-- One permit per immutable package; no timeout-driven takeover or global
-- permit clearing. Existing provider identities and outbox lease remain owners.
create table private.client_delivery_package_dispatch_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  legacy_worker_off_verified boolean not null default false,
  max_in_flight integer not null default 2 check (max_in_flight=2)
);
insert into private.client_delivery_package_dispatch_config(singleton)
  values(true);

create table private.client_delivery_package_dispatch_permits (
  package_id uuid primary key references private.client_packages(id) on delete restrict,
  organization_id uuid not null,
  destination_id uuid not null references private.client_delivery_destinations(id)
    on delete restrict,
  worker_id uuid not null,
  request_id uuid not null unique,
  generation bigint not null check (generation>0),
  acquired_at timestamptz not null default clock_timestamp()
);
create index client_delivery_package_permit_org_idx
  on private.client_delivery_package_dispatch_permits(organization_id);
alter table private.client_delivery_package_dispatch_config enable row level security;
alter table private.client_delivery_package_dispatch_permits enable row level security;
revoke all on private.client_delivery_package_dispatch_config,
  private.client_delivery_package_dispatch_permits
  from public,anon,authenticated,service_role;
-- Deliberately NO direct table grant and NO public mutating function.

-- Atomic exact eligible-package claim plus durable permit creation.
-- A single config row lock serializes capacity checks across Edge instances;
-- the target outbox row is locked BEFORE its state changes. Never invoke the
-- old broad claim (which can select a different queued package).
create function private.service_claim_package_and_acquire_dispatch(
  p_package uuid,p_destination uuid,p_root text,p_worker uuid,p_request uuid
) returns jsonb language plpgsql security definer
set search_path='' set lock_timeout='5s' as $claim$
declare
  cfg private.client_delivery_package_dispatch_config%rowtype;
  o private.client_delivery_outbox%rowtype;
  k private.client_packages%rowtype;
  taken uuid;
  next_generation bigint;
begin
  if p_package is null or p_destination is null or p_worker is null
    or p_request is null or p_root is null
    or p_root !~ '^[A-Za-z0-9_-]{10,160}$'
  then
    raise exception 'Exact package dispatch identities required'
      using errcode='22023';
  end if;
  select * into cfg from private.client_delivery_package_dispatch_config
    where singleton for update;
  if cfg.singleton is null then
    raise exception 'Package dispatch configuration missing'
      using errcode='42501';
  end if;
  -- The original singleton and original held attempt are NEVER repurposed.
  -- The migration leaves both switches false. Cutover is a separate gate.
  if not cfg.enabled or not cfg.legacy_worker_off_verified
  then return jsonb_build_object('claimed',false,'acquired',false);end if;
  if (select count(*) from private.client_delivery_package_dispatch_permits)
      >=cfg.max_in_flight
  then return jsonb_build_object('claimed',false,'acquired',false);end if;

  select * into o from private.client_delivery_outbox
    where package_id=p_package for update;
  if o.package_id is null or o.state<>'QUEUED'
    or o.attempts<>0 or o.worker_id is not null
  then return jsonb_build_object('claimed',false,'acquired',false);end if;
  select * into k from private.client_packages where id=p_package for update;
  if k.id is null or k.status<>'QUEUED'
    or k.destination_id is distinct from p_destination
    or o.destination_id is distinct from p_destination
    or o.approved_sha256 is distinct from k.approved_sha256
    or k.approved_sha256 is null
    or k.approved_manifest is null
    or k.approved_manifest->>'package_id' is distinct from p_package::text
    or k.approved_manifest->>'destination_id' is distinct from p_destination::text
    or k.approved_manifest->>'destination_root' is distinct from p_root
    or exists(select 1 from private.client_delivery_final_receipts f
       where f.package_id=p_package)
    or not exists(select 1 from private.client_delivery_runtime rt
       where rt.organization_id=k.organization_id and rt.worker_ready
         and rt.last_verified_at>=now()-interval '24 hours'
         and rt.worker_identity is not null)
    or not exists(select 1 from private.client_delivery_destinations d
       where d.id=p_destination and d.organization_id=k.organization_id
         and d.company_id=k.company_id and d.verified and d.active
         and d.root_folder_id=p_root
         and d.revision=(k.approved_manifest->>'destination_revision')::uuid)
  then raise exception 'Frozen package or destination not eligible'
    using errcode='42501';end if;

  next_generation:=o.lease_generation+1;
  if next_generation<=0 then
    raise exception 'Invalid lease generation' using errcode='40001';end if;
  insert into private.client_delivery_package_dispatch_permits(
    package_id,organization_id,destination_id,worker_id,request_id,generation
  ) values(p_package,k.organization_id,p_destination,p_worker,p_request,next_generation)
    on conflict (package_id) do nothing returning package_id into taken;
  if taken is null then
    return jsonb_build_object('claimed',false,'acquired',false);
  end if;
  update private.client_delivery_outbox
    set state='DELIVERING',worker_id=p_worker,
        lease_generation=next_generation,
        lease_until=clock_timestamp()+interval '2 minutes',
        last_heartbeat_at=clock_timestamp(),attempts=attempts+1
    where package_id=p_package and state='QUEUED'
      and attempts=0 and worker_id is null
    returning * into o;
  if o.package_id is null then
    raise exception 'Package claim confirmation uncertain'
      using errcode='40001';end if;
  update private.client_packages set status='DELIVERING'
    where id=p_package and status='QUEUED';
  if not found then
    raise exception 'Package status confirmation uncertain'
      using errcode='40001';end if;
  return jsonb_build_object(
    'claimed',true,'acquired',true,'package_id',p_package,
    'worker_id',p_worker,'request_id',p_request,
    'generation',next_generation,'expires_at',o.lease_until,
    'approved_sha256',o.approved_sha256,'destination_id',p_destination,
    'manifest',k.approved_manifest);
end;
$claim$;

-- Release is deliberately stricter than the historical per-step permit:
-- only an independently durable final delivery receipt may close this slot.
-- A bounded worker continuation/reconciliation RPC must be designed before
-- a long-running in-progress package can be resumed across invocations.
-- UNCERTAIN, partial, expired, lost-reply or failed operations retain permit.
create function private.service_release_package_dispatch(
  p_package uuid,p_worker uuid,p_request uuid,p_generation bigint
) returns jsonb language plpgsql security definer
set search_path='' set lock_timeout='5s' as $release$
declare
  cfg private.client_delivery_package_dispatch_config%rowtype;
  held private.client_delivery_package_dispatch_permits%rowtype;
  o private.client_delivery_outbox%rowtype;
  receipt private.client_delivery_final_receipts%rowtype;
begin
  if p_package is null or p_worker is null or p_request is null
    or p_generation is null or p_generation<1
  then raise exception 'Exact package dispatch owner required'
    using errcode='22023';end if;
  select * into cfg from private.client_delivery_package_dispatch_config
    where singleton for update;
  if cfg.singleton is null or not cfg.legacy_worker_off_verified
  then raise exception 'Package dispatch cutover not verified'
    using errcode='42501';end if;
  select * into held from private.client_delivery_package_dispatch_permits
    where package_id=p_package for update;
  select * into o from private.client_delivery_outbox
    where package_id=p_package for update;
  select * into receipt from private.client_delivery_final_receipts
    where package_id=p_package;
  if held.package_id is null
    or held.worker_id is distinct from p_worker
    or held.request_id is distinct from p_request
    or held.generation is distinct from p_generation
    or o.package_id is null or o.lease_generation<>p_generation
    or o.state<>'DELIVERED' or receipt.package_id is null
    or receipt.approved_sha256 is distinct from o.approved_sha256
    or receipt.destination_id is distinct from held.destination_id
  then raise exception 'Original package owner/final receipt not verified'
    using errcode='42501';end if;
  delete from private.client_delivery_package_dispatch_permits
    where package_id=p_package and request_id=p_request
      and worker_id=p_worker and generation=p_generation;
  if not found then raise exception 'Permit release not confirmed'
    using errcode='40001';end if;
  return jsonb_build_object('released',true);
end;
$release$;

create function public.service_claim_package_and_acquire_dispatch(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,p_request uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_claim_package_and_acquire_dispatch(
   p_package,p_destination,p_root,p_worker,p_request)
$wrap$;
create function public.service_release_package_dispatch(
 p_package uuid,p_worker uuid,p_request uuid,p_generation bigint
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_release_package_dispatch(
   p_package,p_worker,p_request,p_generation)
$wrap$;

revoke all on function
  private.service_claim_package_and_acquire_dispatch(uuid,uuid,text,uuid,uuid),
  public.service_claim_package_and_acquire_dispatch(uuid,uuid,text,uuid,uuid),
  private.service_release_package_dispatch(uuid,uuid,uuid,bigint),
  public.service_release_package_dispatch(uuid,uuid,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function
  private.service_claim_package_and_acquire_dispatch(uuid,uuid,text,uuid,uuid),
  public.service_claim_package_and_acquire_dispatch(uuid,uuid,text,uuid,uuid),
  private.service_release_package_dispatch(uuid,uuid,uuid,bigint),
  public.service_release_package_dispatch(uuid,uuid,uuid,bigint)
  to service_role;
