-- Phase 5D: reserve/read exactly STATE, COUNTY, CITY in existing immutable
-- parent ledger. The existing begin/confirm one-shot CAS remains sole owner.
-- NO provider executor activation, SQL deployment or browser grants.
create function private.service_geographic_parent_plan(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $plan$
declare k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 g jsonb; predecessor private.client_delivery_parent_maps%rowtype;
 key text; label text; ancestor text; predecessor_kind text;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 if p_kind not in ('STATE','COUNTY','CITY') then
   raise exception 'Exact geographic kind required' using errcode='22023';end if;
 select * into k from private.client_packages where id=p_package;
 if k.id is null or k.status<>'DELIVERING' or k.approved_sha256 is null
  or k.approved_manifest->>'folder_layout'<>'STATE_COUNTY_CITY_ADDRESS' then
   raise exception 'Approved geographic package required' using errcode='42501';end if;
 g:=private.service_plan_geographic_delivery_path(p_package,p_worker,p_generation);
 select * into d from private.client_delivery_destinations where id=k.destination_id;
 if d.id is null or d.organization_id is distinct from k.organization_id
   or d.company_id is distinct from k.company_id or not d.active or not d.verified
   or d.revision::text is distinct from g->>'destination_revision'
   or d.root_folder_id is distinct from g->>'destination_root' then
   raise exception 'Current verified company root required' using errcode='42501';end if;
 key:=case p_kind when 'STATE' then g->>'state_key'
   when 'COUNTY' then g->>'county_key' else g->>'city_key' end;
 label:=case p_kind when 'STATE' then g->>'state'
   when 'COUNTY' then g->>'county' else g->>'city' end;
 if key !~ '^[a-f0-9]{64}$' or char_length(label) not between 2 and 100 then
   raise exception 'Frozen geography path invalid' using errcode='42501';end if;
 if p_kind='STATE' then
   return jsonb_build_object('kind',p_kind,'key',key,'label',label,
     'parent_map_id',null,'parent_id',d.root_folder_id,
     'destination_id',d.id,'destination_revision',d.revision);
 end if;
 predecessor_kind:=case p_kind when 'COUNTY' then 'STATE' else 'COUNTY' end;
 ancestor:=case p_kind when 'COUNTY' then g->>'state_key' else g->>'county_key' end;
 select * into predecessor from private.client_delivery_parent_maps
 where organization_id=k.organization_id and company_id=k.company_id
  and destination_id=d.id and destination_revision=d.revision
  and kind=predecessor_kind and folder_key=ancestor;
 if predecessor.id is null or predecessor.state<>'VERIFIED' then
   raise exception 'Verified geographic ancestor required' using errcode='42501';end if;
 perform private.service_delivery_parent_guard(p_package,p_worker,p_generation,predecessor.id);
 return jsonb_build_object('kind',p_kind,'key',key,'label',label,
   'parent_map_id',predecessor.id,'parent_id',predecessor.remote_folder_id,
   'destination_id',d.id,'destination_revision',d.revision);
end;
$plan$;

create function private.service_read_geographic_parent(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $read$
declare plan jsonb; k private.client_packages%rowtype;
 f private.client_delivery_parent_maps%rowtype;
begin
 plan:=private.service_geographic_parent_plan(p_package,p_worker,p_generation,p_kind);
 select * into k from private.client_packages where id=p_package;
 select * into f from private.client_delivery_parent_maps where
  organization_id=k.organization_id and company_id=k.company_id
  and destination_id=(plan->>'destination_id')::uuid
  and destination_revision=(plan->>'destination_revision')::uuid
  and kind=p_kind and folder_key=plan->>'key';
 if f.id is null then return jsonb_build_object('exists',false,'kind',p_kind);end if;
 if f.parent_remote_id is distinct from plan->>'parent_id'
  or f.parent_map_id is distinct from (plan->>'parent_map_id')::uuid
  or f.remote_name is distinct from plan->>'label'
  or f.geographic_path_key is distinct from plan->>'key' then
   raise exception 'Existing geographic identity changed' using errcode='40001';end if;
 perform private.service_delivery_parent_guard(p_package,p_worker,p_generation,f.id);
 return jsonb_build_object('exists',true,'map_id',f.id,'kind',f.kind,
   'remote_folder_id',f.remote_folder_id,'parent_remote_id',f.parent_remote_id,
   'remote_name',f.remote_name,'state',f.state,
   'appProperties',jsonb_build_object('fwh_org',f.organization_id::text,
    'fwh_company',f.company_id::text,'fwh_destination',f.destination_id::text,
    'fwh_kind',f.kind,'fwh_key',f.folder_key));
end;
$read$;

create function private.service_reserve_geographic_parent(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text,
 p_remote_id text,p_parent_id text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $reserve$
declare plan jsonb; k private.client_packages%rowtype;
 f private.client_delivery_parent_maps%rowtype; g jsonb;
begin
 plan:=private.service_geographic_parent_plan(p_package,p_worker,p_generation,p_kind);
 if p_remote_id is null or p_remote_id !~ '^[A-Za-z0-9_-]{10,160}$'
   or p_parent_id is distinct from plan->>'parent_id' or p_remote_id=p_parent_id then
   raise exception 'Immutable preallocated geographic ID and parent required'
     using errcode='42501';end if;
 select * into k from private.client_packages where id=p_package;
 g:=k.approved_manifest->'geographic_path';
 insert into private.client_delivery_parent_maps(
  organization_id,company_id,destination_id,destination_revision,
  kind,folder_key,address_key,address_snapshot,work_order_id,
  parent_map_id,parent_remote_id,remote_folder_id,remote_name,
  geography_revision,geographic_path_key)
 values(k.organization_id,k.company_id,k.destination_id,
  (plan->>'destination_revision')::uuid,p_kind,plan->>'key',
  k.folder_address_key,k.folder_address_snapshot,null,
  (plan->>'parent_map_id')::uuid,p_parent_id,p_remote_id,plan->>'label',
  (g->>'geography_revision')::uuid,plan->>'key')
 on conflict(organization_id,company_id,destination_id,destination_revision,kind,folder_key)
   do nothing;
 select * into f from private.client_delivery_parent_maps
 where organization_id=k.organization_id and company_id=k.company_id
  and destination_id=k.destination_id
  and destination_revision=(plan->>'destination_revision')::uuid
  and kind=p_kind and folder_key=plan->>'key' for update;
 if f.id is null or f.remote_folder_id is distinct from p_remote_id
   or f.parent_remote_id is distinct from p_parent_id
   or f.parent_map_id is distinct from (plan->>'parent_map_id')::uuid
   or f.remote_name is distinct from plan->>'label' then
   raise exception 'Preallocated geographic ID cannot change'
     using errcode='40001';end if;
 perform private.service_delivery_parent_guard(p_package,p_worker,p_generation,f.id);
 return jsonb_build_object('map_id',f.id,'kind',f.kind,
  'remote_folder_id',f.remote_folder_id,'parent_remote_id',f.parent_remote_id,
  'state',f.state);
end;
$reserve$;
create function public.service_read_geographic_parent(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_read_geographic_parent(p_package,p_worker,p_generation,p_kind)
$wrap$;
create function public.service_reserve_geographic_parent(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text,
 p_remote_id text,p_parent_id text
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_reserve_geographic_parent(
  p_package,p_worker,p_generation,p_kind,p_remote_id,p_parent_id)
$wrap$;
revoke all on function private.service_geographic_parent_plan(uuid,uuid,bigint,text),
 private.service_read_geographic_parent(uuid,uuid,bigint,text),
 private.service_reserve_geographic_parent(uuid,uuid,bigint,text,text,text),
 public.service_read_geographic_parent(uuid,uuid,bigint,text),
 public.service_reserve_geographic_parent(uuid,uuid,bigint,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function private.service_geographic_parent_plan(uuid,uuid,bigint,text),
 private.service_read_geographic_parent(uuid,uuid,bigint,text),
 private.service_reserve_geographic_parent(uuid,uuid,bigint,text,text,text),
 public.service_read_geographic_parent(uuid,uuid,bigint,text),
 public.service_reserve_geographic_parent(uuid,uuid,bigint,text,text,text)
 to service_role;
