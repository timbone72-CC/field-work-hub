-- Phase 5D candidate: one existing create/confirm journal now validates the
-- frozen selected geographic ancestor chain. Does NOT reserve remote IDs,
-- grant new entry points, create Google folders, or enable worker delivery.
create or replace function private.service_delivery_parent_guard(
  p_package uuid,p_worker uuid,p_generation bigint,p_map uuid
) returns private.client_delivery_parent_maps
language plpgsql security definer set search_path='' set lock_timeout='5s' as $guard$
declare
 k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 f private.client_delivery_parent_maps%rowtype;
 p private.client_delivery_parent_maps%rowtype;
 m jsonb; geo jsonb;
 expected_kind text; expected_key text; expected_parent text;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into k from private.client_packages where id=p_package;
 if k.id is null or k.status<>'DELIVERING' or k.approved_manifest is null
   or k.folder_address_key is null then
   raise exception 'Current frozen package required' using errcode='42501';end if;
 m:=k.approved_manifest;
 select * into d from private.client_delivery_destinations where id=k.destination_id;
 if d.id is null or d.organization_id is distinct from k.organization_id
  or d.company_id is distinct from k.company_id or not d.verified or not d.active
  or d.revision::text is distinct from m->>'destination_revision'
  or d.root_folder_id is distinct from m->>'destination_root' then
  raise exception 'Frozen client destination required' using errcode='42501';end if;
 select * into f from private.client_delivery_parent_maps where id=p_map for update;
 if f.id is null or f.organization_id is distinct from k.organization_id
  or f.company_id is distinct from k.company_id or f.destination_id is distinct from d.id
  or f.destination_revision is distinct from d.revision
  or f.address_key is distinct from k.folder_address_key
  or f.state='UNCERTAIN' then
  raise exception 'Exact company-scoped folder map required' using errcode='42501';end if;
 if coalesce(m->>'folder_layout','ADDRESS_WORK_ORDER')='ADDRESS_WORK_ORDER' then
   if f.geography_revision is not null or f.geographic_path_key is not null
     or f.kind not in ('ADDRESS','WORK_ORDER') then
     raise exception 'Legacy layout may not reference geographic nodes'
       using errcode='42501';end if;
   if f.kind='ADDRESS' then
     if f.work_order_id is not null or f.parent_map_id is not null
       or f.parent_remote_id is distinct from d.root_folder_id then
       raise exception 'Legacy address must be under client root' using errcode='42501';end if;
     return f;
   end if;
   expected_kind:='ADDRESS';
 else
   if m->>'folder_layout'<>'STATE_COUNTY_CITY_ADDRESS'
     or jsonb_typeof(m->'geographic_path')<>'object' then
     raise exception 'Unsupported/unfrozen geographic layout' using errcode='42501';end if;
   geo:=m->'geographic_path';
   if geo->>'organization_id' is distinct from k.organization_id::text
     or geo->>'company_id' is distinct from k.company_id::text
     or geo->>'destination_id' is distinct from d.id::text
     or geo->>'destination_revision' is distinct from d.revision::text
     or geo->>'destination_root' is distinct from d.root_folder_id
     or geo->>'work_order_id' is distinct from k.work_order_id::text
     or geo->>'address_key' is distinct from k.folder_address_key
     or (geo->>'geography_revision') is null then
     raise exception 'Frozen company geography required' using errcode='42501';end if;
   if f.kind not in ('STATE','COUNTY','CITY','ADDRESS','WORK_ORDER')
     or f.geography_revision::text is distinct from geo->>'geography_revision' then
     raise exception 'Folder is not in approved geography revision' using errcode='42501';end if;
   expected_key:=case f.kind
     when 'STATE' then geo->>'state_key'
     when 'COUNTY' then geo->>'county_key'
     when 'CITY' then geo->>'city_key'
     when 'ADDRESS' then k.folder_address_key
     else k.work_order_id::text end;
   if f.folder_key is distinct from expected_key then
     raise exception 'Frozen geographic key mismatch' using errcode='42501';end if;
   if f.kind='STATE' then
     if f.parent_map_id is not null
       or f.parent_remote_id is distinct from d.root_folder_id
       or f.geographic_path_key is distinct from geo->>'state_key' then
       raise exception 'STATE must be under exact client root' using errcode='42501';end if;
     return f;
   end if;
   expected_kind:=case f.kind
     when 'COUNTY' then 'STATE' when 'CITY' then 'COUNTY'
     when 'ADDRESS' then 'CITY' else 'ADDRESS' end;
   if f.kind='COUNTY' and f.geographic_path_key is distinct from geo->>'county_key'
     or f.kind='CITY' and f.geographic_path_key is distinct from geo->>'city_key'
     or f.kind='ADDRESS' and f.geographic_path_key is distinct from geo->>'city_key' then
     raise exception 'Parent geography path key mismatch' using errcode='42501';end if;
 end if;
 if f.kind='WORK_ORDER' and f.work_order_id is distinct from k.work_order_id
   or f.kind<>'WORK_ORDER' and f.work_order_id is not null then
   raise exception 'Work-order identity mismatch' using errcode='42501';end if;
 select * into p from private.client_delivery_parent_maps where id=f.parent_map_id;
 if p.id is null or p.kind is distinct from expected_kind or p.state<>'VERIFIED'
   or p.organization_id is distinct from f.organization_id
   or p.company_id is distinct from f.company_id
   or p.destination_id is distinct from f.destination_id
   or p.destination_revision is distinct from f.destination_revision
   or p.address_key is distinct from f.address_key
   or f.parent_remote_id is distinct from p.remote_folder_id then
   raise exception 'Verified exact-company predecessor required' using errcode='42501';end if;
 if coalesce(m->>'folder_layout','ADDRESS_WORK_ORDER')<>'ADDRESS_WORK_ORDER' then
   if p.geography_revision is distinct from f.geography_revision
     or (f.kind='COUNTY' and p.folder_key is distinct from geo->>'state_key')
     or (f.kind='CITY' and p.folder_key is distinct from geo->>'county_key')
     or (f.kind='ADDRESS' and p.folder_key is distinct from geo->>'city_key')
     or (f.kind='WORK_ORDER' and p.folder_key is distinct from k.folder_address_key) then
      raise exception 'Verified geographic predecessor key mismatch' using errcode='42501';end if;
 end if;
 return f;
end;
$guard$;
revoke all on function private.service_delivery_parent_guard(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_delivery_parent_guard(uuid,uuid,bigint,uuid)
 to service_role;
