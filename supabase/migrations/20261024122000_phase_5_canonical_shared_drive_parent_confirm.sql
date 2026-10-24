-- Phase 5D: repair the existing canonical immutable TEST destination proof key.
-- Earlier provider verification/activation stored "shared_drive_id"; the
-- original parent confirmation function incorrectly read "drive_id".
-- Recreate ONLY that same private owner with those two key references changed.
-- Preserve every package/worker/lease/company/parent/name/appProperties guard,
-- one-shot ATTEMPTED journal and service-role-only wrapper/grants unchanged.
-- This migration does NOT confirm any folder, release a dispatch permit,
-- re-claim a lease, call Google, enable Send, or alter a stored provider receipt.
create or replace function private.service_confirm_delivery_parent(
 p_package uuid,p_worker uuid,p_generation bigint,p_map uuid,p_proof jsonb
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $confirm$
declare f private.client_delivery_parent_maps%rowtype;
 d private.client_delivery_destinations%rowtype;
 expected jsonb;
begin
 f:=private.service_delivery_parent_guard(p_package,p_worker,p_generation,p_map);
 select * into d from private.client_delivery_destinations where id=f.destination_id;
 if jsonb_typeof(p_proof)<>'object'
   or coalesce(p_proof->>'id','')<>f.remote_folder_id
   or coalesce(p_proof->>'parent','')<>f.parent_remote_id
   or coalesce(p_proof->>'name','')<>f.remote_name
   or coalesce(p_proof->>'mime','')<>'application/vnd.google-apps.folder'
   or p_proof->'trashed' is distinct from 'false'::jsonb
   or nullif(d.verification_receipt->>'shared_drive_id','') is null
   or p_proof->>'drive_id' is distinct from d.verification_receipt->>'shared_drive_id' then
    raise exception 'Exact independent provider folder receipt required'
      using errcode='42501';end if;
 expected:=jsonb_build_object('fwh_org',f.organization_id::text,
   'fwh_company',f.company_id::text,
   'fwh_destination',f.destination_id::text,
   'fwh_kind',f.kind,'fwh_key',f.folder_key);
 if p_proof->'appProperties' is distinct from expected then
   raise exception 'Folder app identity mismatch' using errcode='42501';end if;
 if f.state='VERIFIED' then
   if f.remote_evidence is distinct from p_proof then
     raise exception 'Verified remote receipt changed' using errcode='40001';end if;
   return jsonb_build_object('state','VERIFIED','map_id',f.id,'replayed',true);
 end if;
 if f.state<>'ATTEMPTED' or f.create_attempts<>1 then
   raise exception 'Provider create attempt must be recorded before confirmation'
      using errcode='40001';end if;
 update private.client_delivery_parent_maps set
   state='VERIFIED',verified_at=clock_timestamp(),remote_evidence=p_proof
   where id=f.id;
 return jsonb_build_object('state','VERIFIED','map_id',f.id,'replayed',false);
end;
$confirm$;
