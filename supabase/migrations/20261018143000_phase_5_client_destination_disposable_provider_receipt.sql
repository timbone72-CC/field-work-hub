-- Phase 5D: immutable TEST client destination create/GET/LIST provider proof.
-- Depends on the already held inactive proposal and service-only GET preflight.
-- No delivery worker, scheduler, package/Send, photo or ACL changes.
create table private.client_destination_provider_proof_reservations (
 destination_id uuid primary key references private.client_delivery_destinations(id) on delete restrict,
 action_id uuid not null unique,
 preflight_action_id uuid not null references private.client_delivery_destination_preflights(action_id) on delete restrict,
 organization_id uuid not null,
 company_id uuid not null,
 expected_revision uuid not null,
 provider_identity text not null,
 root_folder_id text not null,
 drive_id text not null,
 proof_folder_id text not null unique,
 proof_folder_name text not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(organization_id,company_id)
   references private.client_companies(organization_id,id) on delete restrict
);
create trigger client_destination_provider_proof_reservation_immutable
 before update or delete on private.client_destination_provider_proof_reservations
 for each row execute function private.protect_photo_transfer_ledger();
alter table private.client_destination_provider_proof_reservations enable row level security;
revoke all on private.client_destination_provider_proof_reservations
 from public,anon,authenticated,service_role;

create table private.client_destination_provider_proof_receipts (
 destination_id uuid primary key references private.client_destination_provider_proof_reservations(destination_id) on delete restrict,
 action_id uuid not null unique,
 proof_folder_id text not null,
 proof_drive_id text not null,
 confirmed_at timestamptz not null default clock_timestamp()
);
create trigger client_destination_provider_proof_receipt_immutable
 before update or delete on private.client_destination_provider_proof_receipts
 for each row execute function private.protect_photo_transfer_ledger();
alter table private.client_destination_provider_proof_receipts enable row level security;
revoke all on private.client_destination_provider_proof_receipts
 from public,anon,authenticated,service_role;

-- A read is mandatory before generating another Google file ID. A reserved
-- identity is immutable, so crash/retry can GET/LIST but never blindly POST.
create function private.service_read_client_destination_provider_proof(p_destination uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $read$
declare r private.client_destination_provider_proof_reservations%rowtype;
        receipt private.client_destination_provider_proof_receipts%rowtype;
begin
 if p_destination is null then raise exception 'Exact client destination required' using errcode='22023';end if;
 select * into r from private.client_destination_provider_proof_reservations
   where destination_id=p_destination;
 if r.destination_id is null then return jsonb_build_object('exists',false);end if;
 select * into receipt from private.client_destination_provider_proof_receipts
   where destination_id=r.destination_id;
 return jsonb_build_object('exists',true,'completed',receipt.destination_id is not null,
  'action_id',r.action_id,'preflight_action_id',r.preflight_action_id,
  'destination_id',r.destination_id,'organization_id',r.organization_id,
  'company_id',r.company_id,'revision',r.expected_revision,
  'provider_identity',r.provider_identity,'root_folder_id',r.root_folder_id,
  'drive_id',r.drive_id,'folder_id',r.proof_folder_id,'folder_name',r.proof_folder_name);
end;
$read$;
create function public.service_read_client_destination_provider_proof(p_destination uuid)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_read_client_destination_provider_proof(p_destination)
$wrap$;
revoke all on function private.service_read_client_destination_provider_proof(uuid),
 public.service_read_client_destination_provider_proof(uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_read_client_destination_provider_proof(uuid),
 public.service_read_client_destination_provider_proof(uuid) to service_role;

create function private.service_reserve_client_destination_provider_proof(
 p_destination uuid,p_action uuid,p_preflight uuid,p_revision uuid,
 p_file_id text,p_drive_id text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $reserve$
declare d private.client_delivery_destinations%rowtype;
        p private.client_delivery_destination_proposals%rowtype;
        f private.client_delivery_destination_preflights%rowtype;
        r private.client_destination_provider_proof_reservations%rowtype;
        name text;
begin
 if p_destination is null or p_action is null or p_preflight is null or p_revision is null
  or p_file_id !~ '^[A-Za-z0-9_-]{10,160}$'
  or p_drive_id !~ '^[A-Za-z0-9_-]{10,160}$'
 then raise exception 'Exact preallocated provider proof required' using errcode='22023';end if;
 select * into d from private.client_delivery_destinations where id=p_destination for update;
 select * into p from private.client_delivery_destination_proposals where destination_id=p_destination;
 select * into f from private.client_delivery_destination_preflights where action_id=p_preflight;
 if d.id is null or p.action_id is null or f.action_id is null or d.active or d.verified
  or d.revision is distinct from p_revision or d.provider<>'GOOGLE_DRIVE'
  or f.destination_id is distinct from d.id or f.organization_id is distinct from d.organization_id
  or f.company_id is distinct from d.company_id or f.expected_revision is distinct from d.revision
  or f.provider_identity is distinct from d.provider_identity
  or f.root_folder_id is distinct from d.root_folder_id
  or f.shared_drive_id is distinct from p_drive_id or p_file_id=d.root_folder_id
  or p_file_id=p_drive_id or p_drive_id=d.root_folder_id
  or p.organization_id is distinct from d.organization_id
  or p.company_id is distinct from d.company_id
  or p.expected_provider_identity is distinct from d.provider_identity
  or p.expected_root_folder_id is distinct from d.root_folder_id
 then raise exception 'Current scoped preflight required before provider reservation' using errcode='42501';end if;
 select * into r from private.client_destination_provider_proof_reservations
   where destination_id=p_destination;
 if r.destination_id is not null then
  if r.action_id is distinct from p_action or r.preflight_action_id is distinct from p_preflight
    or r.expected_revision is distinct from p_revision
    or r.proof_folder_id is distinct from p_file_id or r.drive_id is distinct from p_drive_id
  then raise exception 'Reserved provider proof identity is immutable' using errcode='40001';end if;
  return jsonb_build_object('reserved',true,'replayed',true,
   'folder_id',r.proof_folder_id,'folder_name',r.proof_folder_name,
   'destination_id',d.id,'organization_id',d.organization_id,'company_id',d.company_id,
   'root_folder_id',d.root_folder_id,'drive_id',p_drive_id);
 end if;
 name:='FWH DISPOSABLE CLIENT PROOF '||substring(replace(p_action::text,'-',''),1,12);
 insert into private.client_destination_provider_proof_reservations
  (destination_id,action_id,preflight_action_id,organization_id,company_id,
   expected_revision,provider_identity,root_folder_id,drive_id,proof_folder_id,proof_folder_name)
 values(d.id,p_action,p_preflight,d.organization_id,d.company_id,
   d.revision,d.provider_identity,d.root_folder_id,p_drive_id,p_file_id,name);
 return jsonb_build_object('reserved',true,'replayed',false,
   'folder_id',p_file_id,'folder_name',name,'destination_id',d.id,
   'organization_id',d.organization_id,'company_id',d.company_id,
   'root_folder_id',d.root_folder_id,'drive_id',p_drive_id);
end;
$reserve$;
create function public.service_reserve_client_destination_provider_proof(
 p_destination uuid,p_action uuid,p_preflight uuid,p_revision uuid,
 p_file_id text,p_drive_id text)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_reserve_client_destination_provider_proof(
 p_destination,p_action,p_preflight,p_revision,p_file_id,p_drive_id)
$wrap$;
revoke all on function
 private.service_reserve_client_destination_provider_proof(uuid,uuid,uuid,uuid,text,text),
 public.service_reserve_client_destination_provider_proof(uuid,uuid,uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_reserve_client_destination_provider_proof(uuid,uuid,uuid,uuid,text,text),
 public.service_reserve_client_destination_provider_proof(uuid,uuid,uuid,uuid,text,text)
 to service_role;

-- Called ONLY after an independent Google files.get plus exact parent-scoped
-- files.list has proved the reserved folder identity and nontrashed status.
-- This is a verified-but-INACTIVE destination: delivery has a separate gate.
create function private.service_confirm_client_destination_provider_proof(
 p_destination uuid,p_action uuid,p_preflight uuid,p_revision uuid,
 p_file_id text,p_drive_id text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $confirm$
declare d private.client_delivery_destinations%rowtype;
        r private.client_destination_provider_proof_reservations%rowtype;
        receipt private.client_destination_provider_proof_receipts%rowtype;
        p private.client_delivery_destination_proposals%rowtype;
        f private.client_delivery_destination_preflights%rowtype;
        proof jsonb;
begin
 select * into d from private.client_delivery_destinations where id=p_destination for update;
 select * into r from private.client_destination_provider_proof_reservations
  where destination_id=p_destination;
 select * into receipt from private.client_destination_provider_proof_receipts
  where destination_id=p_destination;
 select * into p from private.client_delivery_destination_proposals where destination_id=p_destination;
 select * into f from private.client_delivery_destination_preflights where action_id=p_preflight;
 if d.id is null or r.destination_id is null or p.action_id is null or f.action_id is null
  or d.active or d.revision is distinct from p_revision
  or r.action_id is distinct from p_action or r.preflight_action_id is distinct from p_preflight
  or r.expected_revision is distinct from p_revision
  or r.proof_folder_id is distinct from p_file_id or r.drive_id is distinct from p_drive_id
  or r.root_folder_id is distinct from d.root_folder_id
  or r.provider_identity is distinct from d.provider_identity
  or r.organization_id is distinct from d.organization_id or r.company_id is distinct from d.company_id
  or p.organization_id is distinct from d.organization_id or p.company_id is distinct from d.company_id
  or p.expected_provider_identity is distinct from d.provider_identity
  or p.expected_root_folder_id is distinct from d.root_folder_id
  or f.destination_id is distinct from d.id or f.organization_id is distinct from d.organization_id
  or f.company_id is distinct from d.company_id or f.expected_revision is distinct from d.revision
  or f.provider_identity is distinct from d.provider_identity
  or f.root_folder_id is distinct from d.root_folder_id
  or f.shared_drive_id is distinct from p_drive_id then
  raise exception 'Reserved scoped provider proof mismatch' using errcode='42501';end if;
 if receipt.destination_id is not null then
  if receipt.action_id is distinct from p_action or receipt.proof_folder_id is distinct from p_file_id
   or receipt.proof_drive_id is distinct from p_drive_id or not d.verified
   or d.verification_receipt->>'proof_folder_id' is distinct from p_file_id then
   raise exception 'Provider proof replay conflict' using errcode='40001';end if;
  return jsonb_build_object('destination_id',d.id,'verified',true,'active',false,'replayed',true);
 end if;
 if d.verified or d.verification_receipt is not null or d.verified_at is not null then
  raise exception 'Already verified or conflicting destination proof' using errcode='40001';end if;
 proof:=jsonb_build_object('type','CLIENT_ROOT_DISPOSABLE_FOLDER_GET_LIST_V1',
  'destination_id',d.id,'organization_id',d.organization_id,'company_id',d.company_id,
  'provider_identity',d.provider_identity,'root_folder_id',d.root_folder_id,
  'shared_drive_id',p_drive_id,'proof_folder_id',p_file_id,
  'proof_folder_name',r.proof_folder_name,'source_revision',d.revision);
 insert into private.client_destination_provider_proof_receipts
  (destination_id,action_id,proof_folder_id,proof_drive_id)
 values(d.id,p_action,p_file_id,p_drive_id);
 update private.client_delivery_destinations
  set verified=true,verified_at=clock_timestamp(),verification_receipt=proof
  where id=d.id and not active and not verified and revision=p_revision;
 if not found then raise exception 'Destination proof state changed' using errcode='40001';end if;
 return jsonb_build_object('destination_id',d.id,'verified',true,'active',false,'replayed',false);
end;
$confirm$;
create function public.service_confirm_client_destination_provider_proof(
 p_destination uuid,p_action uuid,p_preflight uuid,p_revision uuid,
 p_file_id text,p_drive_id text)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_confirm_client_destination_provider_proof(
 p_destination,p_action,p_preflight,p_revision,p_file_id,p_drive_id)
$wrap$;
revoke all on function
 private.service_confirm_client_destination_provider_proof(uuid,uuid,uuid,uuid,text,text),
 public.service_confirm_client_destination_provider_proof(uuid,uuid,uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_confirm_client_destination_provider_proof(uuid,uuid,uuid,uuid,text,text),
 public.service_confirm_client_destination_provider_proof(uuid,uuid,uuid,uuid,text,text)
 to service_role;
