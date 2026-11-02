-- Phase 5D: the existing trusted worker may be registered ONLY by a narrowly
-- scoped, audited service-role action after genuine operator-reviewed provider
-- and protected-Storage evidence. This migration NEVER registers/enables a
-- worker, queues a package, changes Google files, starts cron or cleans photos.
-- Installation leaves every organization NOT READY (existing default OFF).
--
-- A successful hosted credential/crypto READ-ONLY probe alone is NOT approval
-- to call this service action. The operator must separately confirm the live
-- joined provider/private-byte/immutable-ID evidence and exact source digest.
-- The service caller is trusted to attest those external facts, just as the
-- existing verified destination provider receipt is operator-attested; SQL
-- validates their frozen destination binding, not Google HTTP history.
-- Pause by a separate action; NEVER erase the original provider/worker records.

create table private.client_delivery_worker_readiness_actions (
  action_id uuid primary key,
  destination_id uuid not null references private.client_delivery_destinations(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  destination_revision uuid not null,
  provider_identity text not null,
  expected_root_folder_id text not null,
  provider_proof_folder_id text not null,
  worker_identity text not null,
  worker_source_sha256 text not null check (worker_source_sha256 ~ '^[a-f0-9]{64}$'),
  external_evidence_sha256 text not null check (external_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  verified_probe_result text not null check (verified_probe_result = 'TEST_WORKER_CRYPTO_PROVIDER_READ_ONLY'),
  requested_ready boolean not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create trigger client_delivery_worker_readiness_action_immutable
  before update or delete on private.client_delivery_worker_readiness_actions
  for each row execute function private.protect_photo_transfer_ledger();
alter table private.client_delivery_worker_readiness_actions enable row level security;
revoke all on private.client_delivery_worker_readiness_actions
  from public,anon,authenticated,service_role;

create function private.service_set_delivery_worker_ready(
 p_action uuid, p_destination uuid, p_expected_revision uuid,
 p_expected_provider_identity text, p_expected_root text,
 p_expected_proof_folder text, p_worker_identity text,
 p_source_sha256 text, p_external_evidence_sha256 text,
 p_probe_result text, p_ready boolean
) returns jsonb language plpgsql security definer set search_path=''
  set lock_timeout='5s' as $ready$
declare
 d private.client_delivery_destinations%rowtype;
 prior private.client_delivery_worker_readiness_actions%rowtype;
 rt private.client_delivery_runtime%rowtype;
 proof private.client_destination_provider_proof_receipts%rowtype;
 reserved private.client_destination_provider_proof_reservations%rowtype;
begin
 if p_action is null or p_destination is null or p_expected_revision is null
   or p_expected_provider_identity is null or p_expected_root is null
   or p_expected_proof_folder is null or p_worker_identity is null
   or length(p_worker_identity)<12 or length(p_worker_identity)>128
   or p_worker_identity !~ '^[A-Za-z0-9._:-]+$'
   or p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$'
   or p_external_evidence_sha256 is null
   or p_external_evidence_sha256 !~ '^[a-f0-9]{64}$'
   or p_probe_result is distinct from 'TEST_WORKER_CRYPTO_PROVIDER_READ_ONLY'
   or p_ready is null
 then raise exception 'Exact verified worker readiness action required' using errcode='22023';end if;

 select * into d from private.client_delivery_destinations
   where id=p_destination for update;
 if d.id is null or d.provider<>'GOOGLE_DRIVE'
   or d.revision is distinct from p_expected_revision
   or d.provider_identity is distinct from p_expected_provider_identity
   or d.root_folder_id is distinct from p_expected_root
   or d.verification_receipt->>'proof_folder_id' is distinct from p_expected_proof_folder
 then raise exception 'Frozen provider identity or revision mismatch' using errcode='42501';end if;

 select * into prior from private.client_delivery_worker_readiness_actions
   where action_id=p_action;
 if prior.action_id is not null then
   if prior.destination_id is distinct from p_destination
     or prior.organization_id is distinct from d.organization_id
     or prior.destination_revision is distinct from p_expected_revision
     or prior.provider_identity is distinct from p_expected_provider_identity
     or prior.expected_root_folder_id is distinct from p_expected_root
     or prior.provider_proof_folder_id is distinct from p_expected_proof_folder
     or prior.worker_identity is distinct from p_worker_identity
     or prior.worker_source_sha256 is distinct from p_source_sha256
     or prior.external_evidence_sha256 is distinct from p_external_evidence_sha256
     or prior.verified_probe_result is distinct from p_probe_result
     or prior.requested_ready is distinct from p_ready then
     raise exception 'Readiness action UUID reused with changed evidence'
       using errcode='40001';end if;
   select * into rt from private.client_delivery_runtime
     where organization_id=d.organization_id;
   return jsonb_build_object('organization_id',d.organization_id,
      'worker_ready',coalesce(rt.worker_ready,false),'replayed',true);
 end if;

 -- A pause is possible even if the destination was subsequently deactivated.
 -- Activation requires all original provider-root proof records and an active
 -- exact current destination; a mere uploaded source bundle is insufficient.
 if p_ready then
   select * into proof from private.client_destination_provider_proof_receipts
     where destination_id=d.id;
   select * into reserved from private.client_destination_provider_proof_reservations
     where destination_id=d.id;
   if not d.active or not d.verified or d.verified_at is null
     or d.verification_receipt->>'type' is distinct from
       'CLIENT_ROOT_DISPOSABLE_FOLDER_GET_LIST_V1'
     or reserved.destination_id is null or proof.destination_id is null
     or reserved.organization_id is distinct from d.organization_id
     or reserved.company_id is distinct from d.company_id
     or reserved.expected_revision is distinct from d.revision
     or reserved.provider_identity is distinct from d.provider_identity
     or reserved.root_folder_id is distinct from d.root_folder_id
     or reserved.proof_folder_id is distinct from p_expected_proof_folder
     or proof.proof_folder_id is distinct from reserved.proof_folder_id
     or proof.proof_drive_id is distinct from reserved.drive_id
     or not exists (select 1 from private.client_destination_activation_actions a
       where a.destination_id=d.id and a.organization_id=d.organization_id
         and a.company_id=d.company_id
         and a.expected_revision=d.revision and a.requested_active
         and a.expected_provider_identity=d.provider_identity
         and a.expected_root_folder_id=d.root_folder_id
         and a.expected_proof_folder_id=p_expected_proof_folder)
   then raise exception 'Independently verified active destination required'
     using errcode='42501';end if;
   -- Never change identity while a delivery or uncertain dispatch is present.
   if exists(select 1 from private.client_delivery_dispatch_permit)
     or exists(select 1 from private.client_delivery_outbox)
     or exists(select 1 from private.client_delivery_file_plans)
     or exists(select 1 from private.client_delivery_upload_sessions)
   then raise exception 'Delivery or uncertain provider evidence must reconcile first'
     using errcode='42501';end if;
 end if;

 select * into rt from private.client_delivery_runtime
   where organization_id=d.organization_id for update;
 if p_ready and coalesce(rt.worker_ready,false) then
   raise exception 'Worker already registered; reconcile original action'
     using errcode='40001';end if;
 if not p_ready and not coalesce(rt.worker_ready,false) then
   raise exception 'Worker already paused' using errcode='40001';end if;

 if p_ready then
   insert into private.client_delivery_runtime
     (organization_id,worker_ready,worker_identity,last_verified_at)
   values(d.organization_id,true,p_worker_identity,clock_timestamp())
   on conflict(organization_id) do update
   set worker_ready=true,worker_identity=excluded.worker_identity,
       last_verified_at=excluded.last_verified_at;
 else
   update private.client_delivery_runtime set worker_ready=false
     where organization_id=d.organization_id;
 end if;
 insert into private.client_delivery_worker_readiness_actions (
   action_id,destination_id,organization_id,destination_revision,
   provider_identity,expected_root_folder_id,provider_proof_folder_id,
   worker_identity,worker_source_sha256,external_evidence_sha256,
   verified_probe_result,requested_ready
 ) values(
   p_action,d.id,d.organization_id,d.revision,
   d.provider_identity,d.root_folder_id,p_expected_proof_folder,
   p_worker_identity,p_source_sha256,p_external_evidence_sha256,
   p_probe_result,p_ready
 );
 return jsonb_build_object('organization_id',d.organization_id,
   'worker_ready',p_ready,'replayed',false);
end;
$ready$;

create function public.service_set_delivery_worker_ready(
 p_action uuid, p_destination uuid, p_expected_revision uuid,
 p_expected_provider_identity text, p_expected_root text,
 p_expected_proof_folder text, p_worker_identity text,
 p_source_sha256 text, p_external_evidence_sha256 text,
 p_probe_result text, p_ready boolean
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_set_delivery_worker_ready(
  p_action,p_destination,p_expected_revision,p_expected_provider_identity,
  p_expected_root,p_expected_proof_folder,p_worker_identity,
  p_source_sha256,p_external_evidence_sha256,p_probe_result,p_ready)
$wrap$;

revoke all on function
 private.service_set_delivery_worker_ready(
  uuid,uuid,uuid,text,text,text,text,text,text,text,boolean),
 public.service_set_delivery_worker_ready(
  uuid,uuid,uuid,text,text,text,text,text,text,text,boolean)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_set_delivery_worker_ready(
  uuid,uuid,uuid,text,text,text,text,text,text,text,boolean),
 public.service_set_delivery_worker_ready(
  uuid,uuid,uuid,text,text,text,text,text,text,text,boolean)
 to service_role;
