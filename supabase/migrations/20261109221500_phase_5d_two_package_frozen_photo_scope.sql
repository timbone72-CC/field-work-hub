-- Phase 5D SOURCE ONLY: bounded 1..200 frozen photo IDs for package-local
-- provider proof and SAME-OWNER expired lease renewal. This migration is
-- ADDITIVE and deliberately leaves cfg.enabled / legacy_worker_off_verified
-- OFF. No worker deployment, Send, provider call, new permit, scheduler,
-- legacy resume, cleanup, original evidence mutation or package selection.
-- Applies only through separately authorized TEST migration deployment.

-- Service-defined validation only: one immutable ID per photo, bounded to
-- the established 200-photo manifest maximum, case-insensitive uniqueness.
-- Keep the helper private/non-exposed and never accept caller-picked IDs.
create function private.service_bounded_frozen_photo_ids(p_photos jsonb)
returns boolean language plpgsql immutable security invoker
set search_path='' as $photos$
declare valid boolean;
begin
  if jsonb_typeof(p_photos) is distinct from 'array' then return false;end if;
  if jsonb_array_length(p_photos) not between 1 and 200 then return false;end if;
  select count(*)=count(distinct lower(photo_id))
      and coalesce(bool_and(photo_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),false)
  into valid
  from (select v->>'photo_id' as photo_id from jsonb_array_elements(p_photos) as v) x;
  return coalesce(valid,false);
end;
$photos$;
revoke all on function private.service_bounded_frozen_photo_ids(jsonb)
from public,anon,authenticated,service_role;

-- Replace ONLY the frozen selection shape assertion in these existing
-- service-only definer RPCs. All signed-in/anonymous EXECUTE rights remain
-- revoked, all existing provider, root, org, lease, fence and receipt checks
-- remain bit-for-bit as in their immediately preceding definitions.
create or replace function private.service_record_pinned_package_provider_check(
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
  or not private.service_bounded_frozen_photo_ids(k.approved_manifest->'selected_photos')
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

create or replace function private.service_resume_pinned_package_dispatch(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,p_request uuid,
 p_generation bigint,p_account text,p_drive text,p_permission text,
 p_observed_at timestamptz,p_proof_request uuid
) returns jsonb language plpgsql security definer
set search_path='' set lock_timeout='5s' as $resume$
declare
 cfg private.client_delivery_package_dispatch_config%rowtype;
 held private.client_delivery_package_dispatch_permits%rowtype;
 o private.client_delivery_outbox%rowtype;
 k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 provider private.client_destination_provider_proof_receipts%rowtype;
 renewed private.client_delivery_outbox%rowtype;
 owner jsonb;
begin
 if p_package is null or p_destination is null or p_worker is null
  or p_request is null or p_generation is null or p_generation<1
  or p_proof_request is null or p_root is null
  or p_root !~ '^[A-Za-z0-9_-]{10,160}$'
  or p_drive is null or p_drive !~ '^[A-Za-z0-9_-]{10,160}$'
  or p_account is null or p_permission is null
  or char_length(p_permission) not between 5 and 160
  or p_permission !~ '^[A-Za-z0-9_-]+$'
  or p_observed_at is null
  or p_observed_at<clock_timestamp()-interval '45 seconds'
  or p_observed_at>clock_timestamp()+interval '1 second'
 then raise exception 'Fresh exact resume evidence required' using errcode='22023';end if;
 select * into cfg from private.client_delivery_package_dispatch_config
  where singleton for share;
 if cfg.singleton is null or not cfg.enabled or not cfg.legacy_worker_off_verified
 then raise exception 'Package cutover OFF' using errcode='42501';end if;
 select * into held from private.client_delivery_package_dispatch_permits
  where package_id=p_package for update;
 if held.package_id is null
  or held.worker_id is distinct from p_worker
  or held.request_id is distinct from p_request
  or held.generation is distinct from p_generation
  or held.destination_id is distinct from p_destination
 then raise exception 'Original exact permit required' using errcode='42501';end if;
 select * into o from private.client_delivery_outbox where package_id=p_package for update;
 select * into k from private.client_packages where id=p_package for share;
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into provider from private.client_destination_provider_proof_receipts
  where destination_id=p_destination;
 if o.package_id is null or k.id is null or d.id is null
  or o.state<>'DELIVERING' or k.status<>'DELIVERING'
  or o.worker_id is distinct from p_worker
  or o.lease_generation is distinct from p_generation
  or o.destination_id is distinct from p_destination
  or k.destination_id is distinct from p_destination
  or k.organization_id is distinct from held.organization_id
  or k.organization_id is distinct from d.organization_id
  or k.company_id is distinct from d.company_id
  or d.active is distinct from true or d.verified is distinct from true
  or d.root_folder_id is distinct from p_root
  or d.revision::text is distinct from k.approved_manifest->>'destination_revision'
  or k.approved_manifest->>'destination_root' is distinct from p_root
  or k.approved_manifest->>'destination_id' is distinct from p_destination::text
  or k.approved_manifest->>'package_id' is distinct from p_package::text
  or not private.service_bounded_frozen_photo_ids(k.approved_manifest->'selected_photos')
  or o.approved_sha256 is null or o.approved_sha256 is distinct from k.approved_sha256
  or lower(d.provider_identity) is distinct from lower(p_account)
  or provider.destination_id is null or provider.proof_drive_id is distinct from p_drive
  or o.lease_until is null or o.lease_until>clock_timestamp()
  or exists(select 1 from private.client_delivery_final_receipts f where f.package_id=p_package)
  or exists(select 1 from private.client_delivery_package_step_attempts s
    where s.package_id=p_package and s.verified_at is null)
  or exists(select 1 from private.client_delivery_package_step_attempts s
    where s.package_id=p_package
      and (s.worker_id is distinct from p_worker
       or s.request_id is distinct from p_request
       or s.generation is distinct from p_generation))
  or not exists(select 1 from private.client_delivery_package_step_attempts s
    where s.package_id=p_package and s.worker_id=p_worker
      and s.request_id=p_request and s.generation=p_generation
      and s.verified_at is not null
      and s.verified_outcome in ('VERIFIED_METADATA_STEP','VERIFIED_PROVIDER_STEP'))
 then raise exception 'Package owner, verified steps or provider changed'
   using errcode='42501';end if;
 insert into private.client_delivery_package_provider_checks(
  request_id,package_id,destination_id,destination_revision,root_folder_id,
  provider_identity,drive_id,permission_hash
 ) values(p_proof_request,p_package,p_destination,d.revision,p_root,
  lower(p_account),p_drive,
  encode(sha256(convert_to(p_permission,'UTF8')),'hex'));
 update private.client_delivery_outbox
  set lease_until=clock_timestamp()+interval '2 minutes',
      last_heartbeat_at=clock_timestamp()
  where package_id=p_package and state='DELIVERING'
    and worker_id=p_worker and lease_generation=p_generation
    and lease_until<=clock_timestamp()
  returning * into renewed;
 if renewed.package_id is null then raise exception 'Package lease renewal uncertain'
   using errcode='40001';end if;
 owner:=private.service_read_package_dispatch_owner(p_package,p_worker,p_request,p_generation);
 if owner->>'active'<>'true'
 then raise exception 'Renewed owner not verified' using errcode='40001';end if;
 return owner||jsonb_build_object(
  'resumed',true,'present',true,'claimed',true,'acquired',true);
end;
$resume$;

-- Explicitly preserve narrow existing role grants; PostgreSQL CREATE OR
-- REPLACE retains the original function ownership and privilege records.
revoke all on function
  private.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid),
  private.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid)
from public,anon,authenticated;
grant execute on function
  private.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid),
  private.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid)
to service_role;
