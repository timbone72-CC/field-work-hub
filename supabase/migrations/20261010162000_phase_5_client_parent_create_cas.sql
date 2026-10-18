-- Phase 5D source-only: current-lease, one-shot ADDRESS/WO folder create journal.
-- Remote Google POST/GET is NOT performed by this migration. Never blindly
-- replay a POST after the attempt is persisted, even following timeout/crash.
create function private.service_delivery_parent_guard(
  p_package uuid,p_worker uuid,p_generation bigint,p_map uuid
) returns private.client_delivery_parent_maps
language plpgsql security definer set search_path='' set lock_timeout='5s' as $guard$
declare k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 f private.client_delivery_parent_maps%rowtype;
 p private.client_delivery_parent_maps%rowtype;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into k from private.client_packages where id=p_package;
 if k.id is null or k.status<>'DELIVERING' or k.approved_manifest is null
   or k.folder_address_key is null then
   raise exception 'Current frozen package required' using errcode='42501';end if;
 select * into d from private.client_delivery_destinations where id=k.destination_id;
 if d.id is null or d.organization_id is distinct from k.organization_id
  or d.company_id is distinct from k.company_id or not d.verified or not d.active
  or d.revision::text is distinct from k.approved_manifest->>'destination_revision'
  or d.root_folder_id is distinct from k.approved_manifest->>'destination_root' then
  raise exception 'Frozen client destination required' using errcode='42501';end if;
 select * into f from private.client_delivery_parent_maps where id=p_map for update;
 if f.id is null or f.organization_id is distinct from k.organization_id
  or f.company_id is distinct from k.company_id or f.destination_id is distinct from d.id
  or f.destination_revision is distinct from d.revision
  or f.address_key is distinct from k.folder_address_key
  or f.state='UNCERTAIN' then
  raise exception 'Exact company-scoped folder map required' using errcode='42501';end if;
 if f.kind='ADDRESS' then
   if f.work_order_id is not null or f.parent_map_id is not null
     or f.parent_remote_id is distinct from d.root_folder_id then
     raise exception 'Address folder must remain directly below destination root'
        using errcode='42501';end if;
 else
   if f.kind<>'WORK_ORDER' or f.work_order_id is distinct from k.work_order_id then
     raise exception 'Wrong work-order folder' using errcode='42501';end if;
   select * into p from private.client_delivery_parent_maps
     where id=f.parent_map_id;
   if p.id is null or p.kind<>'ADDRESS' or p.state<>'VERIFIED'
      or p.organization_id is distinct from f.organization_id
      or p.company_id is distinct from f.company_id
      or p.destination_id is distinct from f.destination_id
      or p.destination_revision is distinct from f.destination_revision
      or p.address_key is distinct from f.address_key
      or f.parent_remote_id is distinct from p.remote_folder_id then
      raise exception 'Verified same-company address parent required'
        using errcode='42501';end if;
 end if;
 return f;
end;
$guard$;
revoke all on function private.service_delivery_parent_guard(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_delivery_parent_guard(uuid,uuid,bigint,uuid)
 to service_role;

create function private.service_begin_delivery_parent_create(
 p_package uuid,p_worker uuid,p_generation bigint,p_map uuid
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $begin$
declare f private.client_delivery_parent_maps%rowtype;
begin
 f:=private.service_delivery_parent_guard(p_package,p_worker,p_generation,p_map);
 if f.state='RESERVED' then
   update private.client_delivery_parent_maps
     set state='ATTEMPTED',create_attempts=1 where id=f.id;
   return jsonb_build_object('state','MAY_CREATE','map_id',f.id,
     'file_id',f.remote_folder_id,'parent_id',f.parent_remote_id);
 end if;
 -- Already ATTEMPTED or VERIFIED: only independent provider GET is safe.
 return jsonb_build_object('state','VERIFY_EXISTING','map_id',f.id,
   'file_id',f.remote_folder_id,'parent_id',f.parent_remote_id);
end;
$begin$;
create function public.service_begin_delivery_parent_create(
 p_package uuid,p_worker uuid,p_generation bigint,p_map uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_begin_delivery_parent_create(p_package,p_worker,p_generation,p_map)
$wrap$;
revoke all on function private.service_begin_delivery_parent_create(uuid,uuid,bigint,uuid),
 public.service_begin_delivery_parent_create(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_begin_delivery_parent_create(uuid,uuid,bigint,uuid),
 public.service_begin_delivery_parent_create(uuid,uuid,bigint,uuid)
 to service_role;

-- Called ONLY after a trusted worker has independently GET-verified the
-- original preallocated folder ID, parent, name, company and Shared Drive.
-- Service-role access is NOT itself proof that the provider GET occurred.
create function private.service_confirm_delivery_parent(
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
   or nullif(d.verification_receipt->>'drive_id','') is null
   or p_proof->>'drive_id' is distinct from d.verification_receipt->>'drive_id' then
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
create function public.service_confirm_delivery_parent(
 p_package uuid,p_worker uuid,p_generation bigint,p_map uuid,p_proof jsonb
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_confirm_delivery_parent(p_package,p_worker,p_generation,p_map,p_proof)
$wrap$;
revoke all on function private.service_confirm_delivery_parent(uuid,uuid,bigint,uuid,jsonb),
 public.service_confirm_delivery_parent(uuid,uuid,bigint,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.service_confirm_delivery_parent(uuid,uuid,bigint,uuid,jsonb),
 public.service_confirm_delivery_parent(uuid,uuid,bigint,uuid,jsonb)
 to service_role;
