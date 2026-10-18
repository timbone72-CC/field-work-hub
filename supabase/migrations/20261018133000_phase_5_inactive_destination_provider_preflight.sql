-- Phase 5A/D: trusted, non-activating client-root verification after the
-- already-approved inactive Admin proposal migration. No client Send authority.
-- This version is source-only until the canonical migration deployment gate.
create table private.client_delivery_destination_preflights (
  action_id uuid primary key,
  destination_id uuid not null references private.client_delivery_destinations(id) on delete restrict,
  organization_id uuid not null,
  company_id uuid not null,
  expected_revision uuid not null,
  provider_identity text not null,
  root_folder_id text not null,
  shared_drive_id text not null,
  checked_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, company_id)
    references private.client_companies(organization_id,id) on delete restrict,
  unique(destination_id,action_id)
);
create trigger client_delivery_destination_preflight_immutable
 before update or delete on private.client_delivery_destination_preflights
 for each row execute function private.protect_photo_transfer_ledger();
alter table private.client_delivery_destination_preflights enable row level security;
revoke all on private.client_delivery_destination_preflights
 from public,anon,authenticated,service_role;

-- Service-only exact snapshot: trusted provider code reads the original proposed
-- account/root from Supabase, NEVER from a browser POST or visible folder name.
create function private.service_read_client_destination_candidate(p_destination uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $read$
declare d private.client_delivery_destinations%rowtype;
        p private.client_delivery_destination_proposals%rowtype;
begin
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into p from private.client_delivery_destination_proposals
   where destination_id=p_destination;
 if d.id is null or p.action_id is null or d.verified or d.active
   or d.organization_id is distinct from p.organization_id
   or d.company_id is distinct from p.company_id
   or d.provider<>'GOOGLE_DRIVE'
   or d.provider_identity is distinct from p.expected_provider_identity
   or d.root_folder_id is distinct from p.expected_root_folder_id then
   raise exception 'Inactive proposed client destination required' using errcode='42501';
 end if;
 return jsonb_build_object(
  'destination_id',d.id,'organization_id',d.organization_id,
  'company_id',d.company_id,'revision',d.revision,
  'provider',d.provider,'provider_identity',d.provider_identity,
  'root_folder_id',d.root_folder_id,'verified',false,'active',false);
end;
$read$;
create function public.service_read_client_destination_candidate(p_destination uuid)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_read_client_destination_candidate(p_destination)
$wrap$;
revoke all on function
 private.service_read_client_destination_candidate(uuid),
 public.service_read_client_destination_candidate(uuid)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_read_client_destination_candidate(uuid),
 public.service_read_client_destination_candidate(uuid) to service_role;

-- Record only fresh, exact GET metadata checked by the trusted Google adapter.
-- The caller is an independently authenticated service worker. This audit
-- DOES NOT make the destination verified/active and cannot enable Send.
create function private.service_record_client_destination_preflight(
 p_action uuid,p_destination uuid,p_expected_revision uuid,
 p_provider_identity text,p_root text,p_shared_drive text)
returns jsonb language plpgsql security definer
 set search_path='' set lock_timeout='5s' as $record$
declare d private.client_delivery_destinations%rowtype;
        p private.client_delivery_destination_proposals%rowtype;
        prior private.client_delivery_destination_preflights%rowtype;
        account text:=lower(btrim(coalesce(p_provider_identity,'')));
begin
 if p_action is null or p_destination is null or p_expected_revision is null
    or p_provider_identity is distinct from account
    or account !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$'
    or length(account)>254
    or p_root !~ '^[A-Za-z0-9_-]{10,160}$'
    or p_shared_drive !~ '^[A-Za-z0-9_-]{10,160}$'
    or p_root=p_shared_drive
 then raise exception 'Exact trusted client-root preflight required' using errcode='22023';end if;

 -- Serialize root/revision checks and exact same-action retry.
 select * into d from private.client_delivery_destinations where id=p_destination for update;
 select * into p from private.client_delivery_destination_proposals
   where destination_id=p_destination;
 if d.id is null or p.action_id is null or d.active or d.verified
   or d.revision is distinct from p_expected_revision
   or d.organization_id is distinct from p.organization_id
   or d.company_id is distinct from p.company_id
   or d.provider<>'GOOGLE_DRIVE' or d.provider_identity is distinct from account
   or d.root_folder_id is distinct from p_root
   or p.expected_provider_identity is distinct from account
   or p.expected_root_folder_id is distinct from p_root
 then raise exception 'Current matching inactive proposal required' using errcode='42501';end if;

 select * into prior from private.client_delivery_destination_preflights
  where action_id=p_action;
 if prior.action_id is not null then
   if prior.destination_id is distinct from d.id
     or prior.organization_id is distinct from d.organization_id
     or prior.company_id is distinct from d.company_id
     or prior.expected_revision is distinct from p_expected_revision
     or prior.provider_identity is distinct from account
     or prior.root_folder_id is distinct from p_root
     or prior.shared_drive_id is distinct from p_shared_drive
   then raise exception 'Preflight action conflict' using errcode='40001';end if;
   return jsonb_build_object('destination_id',d.id,
     'company_id',d.company_id,'preflight_recorded',true,
     'verified',false,'active',false,'replayed',true);
 end if;
 insert into private.client_delivery_destination_preflights
   (action_id,destination_id,organization_id,company_id,expected_revision,
    provider_identity,root_folder_id,shared_drive_id)
 values(p_action,d.id,d.organization_id,d.company_id,p_expected_revision,
    account,p_root,p_shared_drive);
 return jsonb_build_object('destination_id',d.id,
   'company_id',d.company_id,'preflight_recorded',true,
   'verified',false,'active',false,'replayed',false);
end;
$record$;
create function public.service_record_client_destination_preflight(
 p_action uuid,p_destination uuid,p_expected_revision uuid,
 p_provider_identity text,p_root text,p_shared_drive text)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_record_client_destination_preflight(
 p_action,p_destination,p_expected_revision,p_provider_identity,p_root,p_shared_drive)
$wrap$;
revoke all on function
 private.service_record_client_destination_preflight(uuid,uuid,uuid,text,text,text),
 public.service_record_client_destination_preflight(uuid,uuid,uuid,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_record_client_destination_preflight(uuid,uuid,uuid,text,text,text),
 public.service_record_client_destination_preflight(uuid,uuid,uuid,text,text,text)
 to service_role;
