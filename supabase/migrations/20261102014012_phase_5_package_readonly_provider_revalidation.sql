-- Phase 5D additive: package-local provider READ-ONLY revalidation.
-- Global worker readiness renewal is barred by the held original lease.
-- This trusted new-package proof never alters that lease, singleton or old runtime.
-- Provider GET and identity checks occur in the existing private Edge worker.
create table private.client_delivery_package_provider_checks(
 request_id uuid primary key,
 package_id uuid not null references private.client_packages(id) on delete restrict,
 destination_id uuid not null references private.client_delivery_destinations(id) on delete restrict,
 destination_revision uuid not null,
 root_folder_id text not null,
 provider_identity text not null,
 drive_id text not null,
 permission_hash text not null check(permission_hash ~ '^[a-f0-9]{64}$'),
 checked_at timestamptz not null default clock_timestamp()
);
create index client_delivery_package_provider_check_latest_idx
 on private.client_delivery_package_provider_checks(package_id,checked_at desc);
alter table private.client_delivery_package_provider_checks enable row level security;
revoke all on private.client_delivery_package_provider_checks
 from public,anon,authenticated,service_role;

create function private.service_record_pinned_package_provider_check(
 p_package uuid,p_destination uuid,p_root text,p_account text,
 p_drive text,p_permission text,p_observed_at timestamptz,p_request uuid
) returns jsonb language plpgsql security definer
set search_path='' set lock_timeout='5s' as $check$
declare
 cfg private.client_delivery_package_dispatch_config%rowtype;
 k private.client_packages%rowtype;
 o private.client_delivery_outbox%rowtype;
 d private.client_delivery_destinations%rowtype;
 proof private.client_destination_provider_proof_receipts%rowtype;
 rt private.client_delivery_runtime%rowtype;
 accepted uuid;
begin
 if p_package is null or p_destination is null or p_request is null
  or p_root is null or p_root !~ '^[A-Za-z0-9_-]{10,160}$'
  or p_drive is null or p_drive !~ '^[A-Za-z0-9_-]{10,160}$'
  or p_account is null or p_permission is null
  or char_length(p_permission) not between 5 and 160
  or p_permission !~ '^[A-Za-z0-9_-]+$'
  or p_observed_at is null
  or p_observed_at < clock_timestamp()-interval '45 seconds'
  or p_observed_at > clock_timestamp()+interval '1 second'
 then raise exception 'Fresh exact provider verification required'
  using errcode='22023';end if;
 select * into cfg from private.client_delivery_package_dispatch_config
  where singleton for share;
 if cfg.singleton is null or not cfg.enabled or not cfg.legacy_worker_off_verified
 then raise exception 'New package TEST cutover not active'
   using errcode='42501';end if;
 select * into o from private.client_delivery_outbox
  where package_id=p_package for share;
 select * into k from private.client_packages
  where id=p_package for share;
 select * into d from private.client_delivery_destinations
  where id=p_destination;
 select * into proof from private.client_destination_provider_proof_receipts
  where destination_id=p_destination;
 select * into rt from private.client_delivery_runtime
  where organization_id=k.organization_id;
 if k.id is null or k.status<>'QUEUED' or o.package_id is null
  or o.state<>'QUEUED' or o.attempts<>0 or o.worker_id is not null
  or o.destination_id is distinct from p_destination
  or o.approved_sha256 is distinct from k.approved_sha256
  or k.destination_id is distinct from p_destination
  or k.approved_manifest->>'package_id' is distinct from p_package::text
  or k.approved_manifest->>'destination_id' is distinct from p_destination::text
  or k.approved_manifest->>'destination_root' is distinct from p_root
  or jsonb_typeof(k.approved_manifest->'selected_photos') is distinct from 'array'
  or jsonb_array_length(coalesce(k.approved_manifest->'selected_photos','[]'::jsonb))<>1
  or d.id is null or not d.active or not d.verified
  or d.organization_id is distinct from k.organization_id
  or d.company_id is distinct from k.company_id
  or d.revision::text is distinct from k.approved_manifest->>'destination_revision'
  or d.root_folder_id is distinct from p_root
  or lower(d.provider_identity) is distinct from lower(p_account)
  or proof.destination_id is null or proof.proof_drive_id is distinct from p_drive
  or not coalesce(rt.worker_ready,false) or rt.worker_identity is null
  or exists(select 1 from private.client_delivery_package_dispatch_permits held
     where held.package_id=p_package)
 then raise exception 'Pinned approved package or provider identity changed'
   using errcode='42501';end if;
 insert into private.client_delivery_package_provider_checks(
  request_id,package_id,destination_id,destination_revision,root_folder_id,
  provider_identity,drive_id,permission_hash
 ) values(
  p_request,p_package,p_destination,d.revision,p_root,
  lower(p_account),p_drive,
  encode(sha256(convert_to(p_permission,'UTF8')),'hex'))
 returning request_id into accepted;
 return jsonb_build_object('verified',true,'package_id',p_package,'request_id',accepted);
end;
$check$;

create function public.service_record_pinned_package_provider_check(
 p_package uuid,p_destination uuid,p_root text,p_account text,
 p_drive text,p_permission text,p_observed_at timestamptz,p_request uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_record_pinned_package_provider_check(
  p_package,p_destination,p_root,p_account,p_drive,p_permission,p_observed_at,p_request)
$wrap$;
revoke all on function
 private.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid),
 public.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid),
 public.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid)
 to service_role;

-- The existing new-package claim remains exact/atomic, but requires a fresh
-- package-specific GET receipt instead of refreshing the global legacy stamp.
create or replace function private.service_claim_package_and_acquire_dispatch(
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
          and rt.worker_identity is not null)
     or not exists(select 1 from private.client_delivery_package_provider_checks probe
        where probe.package_id=p_package and probe.destination_id=p_destination
          and probe.destination_revision=(k.approved_manifest->>'destination_revision')::uuid
          and probe.root_folder_id=p_root
          and probe.checked_at>=clock_timestamp()-interval '5 minutes')
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
