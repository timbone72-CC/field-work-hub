-- Phase 5D: preserve and resume a single expired package dispatch owner.
-- This is additive/default OFF. No legacy singleton, new permit, cleanup or scheduler.
-- A verified prior step and a fresh exact Google GET are required before renewal.
create or replace function private.service_read_pinned_package_dispatch(
 p_package uuid,p_destination uuid,p_root text
) returns jsonb language plpgsql security definer set search_path='' as $pinned$
declare
 cfg private.client_delivery_package_dispatch_config%rowtype;
 held private.client_delivery_package_dispatch_permits%rowtype;
 o private.client_delivery_outbox%rowtype;
 k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 proof jsonb;
begin
 if p_package is null or p_destination is null or p_root is null
  or p_root !~ '^[A-Za-z0-9_-]{10,160}$'
 then raise exception 'Exact pinned package scope required' using errcode='22023';end if;
 select * into cfg from private.client_delivery_package_dispatch_config where singleton;
 if cfg.singleton is null or not cfg.enabled or not cfg.legacy_worker_off_verified
 then return '{"present":false,"active":false}'::jsonb;end if;
 select * into held from private.client_delivery_package_dispatch_permits where package_id=p_package;
 if held.package_id is null then return '{"present":false,"active":false}'::jsonb;end if;
 if held.destination_id is distinct from p_destination
 then return '{"present":true,"active":false}'::jsonb;end if;
 proof:=private.service_read_package_dispatch_owner(
  p_package,held.worker_id,held.request_id,held.generation);
 if proof->>'active'='true'
  and proof->'manifest'->>'destination_root'=p_root
 then return proof||jsonb_build_object('present',true,'claimed',true,'acquired',true);end if;
 -- A descriptor does NOT authorize provider writes; a second RPC must prove
 -- fresh provider identity and atomically renew this EXACT existing owner.
 select * into o from private.client_delivery_outbox where package_id=p_package;
 select * into k from private.client_packages where id=p_package;
 select * into d from private.client_delivery_destinations where id=p_destination;
 if o.package_id is null or k.id is null or d.id is null
  or o.state<>'DELIVERING' or k.status<>'DELIVERING'
  or o.worker_id is distinct from held.worker_id
  or o.lease_generation is distinct from held.generation
  or o.destination_id is distinct from p_destination
  or k.destination_id is distinct from p_destination
  or k.organization_id is distinct from held.organization_id
  or k.organization_id is distinct from d.organization_id
  or k.company_id is distinct from d.company_id
  or d.active is distinct from true or d.verified is distinct from true
  or d.root_folder_id is distinct from p_root
  or k.approved_manifest->>'package_id' is distinct from p_package::text
  or k.approved_manifest->>'destination_root' is distinct from p_root
  or k.approved_manifest->>'destination_id' is distinct from p_destination::text
  or k.approved_manifest->>'destination_revision' is distinct from d.revision::text
  or o.approved_sha256 is null or o.approved_sha256 is distinct from k.approved_sha256
  or o.lease_until is null or o.lease_until>clock_timestamp()
  or o.lease_until<clock_timestamp()-interval '24 hours'
  or exists(select 1 from private.client_delivery_package_step_attempts s
    where s.package_id=p_package and s.verified_at is null)
  or not exists(select 1 from private.client_delivery_package_step_attempts s
    where s.package_id=p_package and s.worker_id=held.worker_id
      and s.request_id=held.request_id and s.generation=held.generation
      and s.verified_at is not null
      and s.verified_outcome in ('VERIFIED_METADATA_STEP','VERIFIED_PROVIDER_STEP'))
  or exists(select 1 from private.client_delivery_final_receipts f where f.package_id=p_package)
 then return '{"present":true,"active":false}'::jsonb;end if;
 return jsonb_build_object('present',true,'active',false,'resumable',true,
  'package_id',p_package,'destination_id',p_destination,
  'worker_id',held.worker_id,'request_id',held.request_id,
  'generation',held.generation);
end;
$pinned$;

create function private.service_resume_pinned_package_dispatch(
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
  or jsonb_typeof(k.approved_manifest->'selected_photos') is distinct from 'array'
  or jsonb_array_length(coalesce(k.approved_manifest->'selected_photos','[]'::jsonb))<>1
  or o.approved_sha256 is null or o.approved_sha256 is distinct from k.approved_sha256
  or lower(d.provider_identity) is distinct from lower(p_account)
  or provider.destination_id is null or provider.proof_drive_id is distinct from p_drive
  or o.lease_until is null or o.lease_until>clock_timestamp()
  or o.lease_until<clock_timestamp()-interval '24 hours'
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

create function public.service_resume_pinned_package_dispatch(
 p_package uuid,p_destination uuid,p_root text,p_worker uuid,p_request uuid,
 p_generation bigint,p_account text,p_drive text,p_permission text,
 p_observed_at timestamptz,p_proof_request uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_resume_pinned_package_dispatch(
  p_package,p_destination,p_root,p_worker,p_request,p_generation,
  p_account,p_drive,p_permission,p_observed_at,p_proof_request)
$wrap$;
revoke all on function
 private.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid),
 public.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid),
 public.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid)
 to service_role;
