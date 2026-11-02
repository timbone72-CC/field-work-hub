-- Phase 5D: geographic ADDRESS and WORK_ORDER leaves use the same
-- preallocated immutable map and one-attempt provider CAS as all parents.
-- No hosted migration, Google POST, scheduler, or delivery activation.
create function private.service_geographic_leaf_plan(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $plan$
declare k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 g jsonb; predecessor private.client_delivery_parent_maps%rowtype;
 ancestor_key text; ancestor_kind text; leaf_key text; leaf_name text;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 if p_kind not in ('ADDRESS','WORK_ORDER') then
  raise exception 'Geographic leaf kind required' using errcode='22023';end if;
 select * into k from private.client_packages where id=p_package;
 if k.id is null or k.status<>'DELIVERING'
   or k.approved_manifest->>'folder_layout'<>'STATE_COUNTY_CITY_ADDRESS'
   or k.folder_address_key is null then
  raise exception 'Frozen geographic package required' using errcode='42501';end if;
 g:=private.service_plan_geographic_delivery_path(p_package,p_worker,p_generation);
 select * into d from private.client_delivery_destinations where id=k.destination_id;
 if d.id is null or not d.active or not d.verified
   or d.organization_id is distinct from k.organization_id
   or d.company_id is distinct from k.company_id
   or d.revision::text is distinct from g->>'destination_revision'
   or d.root_folder_id is distinct from g->>'destination_root' then
  raise exception 'Verified exact client destination required' using errcode='42501';end if;
 ancestor_kind:=case p_kind when 'ADDRESS' then 'CITY' else 'ADDRESS' end;
 ancestor_key:=case p_kind when 'ADDRESS' then g->>'city_key' else k.folder_address_key end;
 leaf_key:=case p_kind when 'ADDRESS' then k.folder_address_key else k.work_order_id::text end;
 leaf_name:=case p_kind when 'ADDRESS' then
  left(regexp_replace(k.folder_address_snapshot,'[[:cntrl:]/]',' ','g'),100)
  ||' - '||left(k.folder_address_key,12)
  else 'work-order-'||k.work_order_id::text end;
 select * into predecessor from private.client_delivery_parent_maps
  where organization_id=k.organization_id and company_id=k.company_id
   and destination_id=d.id and destination_revision=d.revision
   and kind=ancestor_kind and folder_key=ancestor_key;
 if predecessor.id is null or predecessor.state<>'VERIFIED' then
  raise exception 'Verified exact geographic predecessor required' using errcode='42501';end if;
 perform private.service_delivery_parent_guard(p_package,p_worker,p_generation,predecessor.id);
 return jsonb_build_object('kind',p_kind,'key',leaf_key,'name',leaf_name,
   'parent_map_id',predecessor.id,'parent_id',predecessor.remote_folder_id,
   'destination_id',d.id,'destination_revision',d.revision,
   'geography_revision',g->>'geography_revision',
   'city_key',g->>'city_key','address_key',k.folder_address_key);
end;
$plan$;
create function private.service_read_geographic_leaf(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $read$
declare plan jsonb; k private.client_packages%rowtype;
 f private.client_delivery_parent_maps%rowtype;
begin
 plan:=private.service_geographic_leaf_plan(p_package,p_worker,p_generation,p_kind);
 select * into k from private.client_packages where id=p_package;
 select * into f from private.client_delivery_parent_maps where
  organization_id=k.organization_id and company_id=k.company_id
  and destination_id=(plan->>'destination_id')::uuid
  and destination_revision=(plan->>'destination_revision')::uuid
  and kind=p_kind and folder_key=plan->>'key';
 if f.id is null then return jsonb_build_object('exists',false,'kind',p_kind);end if;
 if f.parent_map_id is distinct from (plan->>'parent_map_id')::uuid
  or f.parent_remote_id is distinct from plan->>'parent_id'
  or f.remote_name is distinct from plan->>'name'
  or f.address_key is distinct from plan->>'address_key'
  or f.geography_revision::text is distinct from plan->>'geography_revision' then
  raise exception 'Existing geographic leaf identity changed' using errcode='40001';end if;
 perform private.service_delivery_parent_guard(p_package,p_worker,p_generation,f.id);
 return jsonb_build_object('exists',true,'map_id',f.id,'kind',f.kind,
  'remote_folder_id',f.remote_folder_id,'parent_remote_id',f.parent_remote_id,
  'remote_name',f.remote_name,'state',f.state,
  'appProperties',jsonb_build_object('fwh_org',f.organization_id::text,
    'fwh_company',f.company_id::text,'fwh_destination',f.destination_id::text,
    'fwh_kind',f.kind,'fwh_key',f.folder_key));
end;
$read$;
create function private.service_reserve_geographic_leaf(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text,
 p_remote_id text,p_parent_id text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $reserve$
declare plan jsonb; k private.client_packages%rowtype;
 f private.client_delivery_parent_maps%rowtype;
begin
 plan:=private.service_geographic_leaf_plan(p_package,p_worker,p_generation,p_kind);
 if p_remote_id is null or p_remote_id !~ '^[A-Za-z0-9_-]{10,160}$'
   or p_parent_id is distinct from plan->>'parent_id'
   or p_remote_id=p_parent_id then
  raise exception 'Exact preallocated geographic leaf ID required' using errcode='42501';end if;
 select * into k from private.client_packages where id=p_package;
 insert into private.client_delivery_parent_maps(
  organization_id,company_id,destination_id,destination_revision,
  kind,folder_key,address_key,address_snapshot,work_order_id,
  parent_map_id,parent_remote_id,remote_folder_id,remote_name,
  geography_revision,geographic_path_key)
 values(k.organization_id,k.company_id,k.destination_id,
   (plan->>'destination_revision')::uuid,p_kind,plan->>'key',
   k.folder_address_key,k.folder_address_snapshot,
   case when p_kind='WORK_ORDER' then k.work_order_id else null end,
   (plan->>'parent_map_id')::uuid,p_parent_id,p_remote_id,plan->>'name',
   (plan->>'geography_revision')::uuid,
   case when p_kind='ADDRESS' then plan->>'city_key' else null end)
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
  or f.remote_name is distinct from plan->>'name'
  or f.geography_revision::text is distinct from plan->>'geography_revision' then
  raise exception 'Preallocated geographic leaf identity immutable' using errcode='40001';end if;
 perform private.service_delivery_parent_guard(p_package,p_worker,p_generation,f.id);
 return jsonb_build_object('map_id',f.id,'kind',f.kind,
   'remote_folder_id',f.remote_folder_id,'parent_remote_id',f.parent_remote_id,
   'state',f.state);
end;
$reserve$;
create function public.service_read_geographic_leaf(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_read_geographic_leaf(p_package,p_worker,p_generation,p_kind)
$wrap$;
create function public.service_reserve_geographic_leaf(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text,
 p_remote_id text,p_parent_id text
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_reserve_geographic_leaf(
   p_package,p_worker,p_generation,p_kind,p_remote_id,p_parent_id)
$wrap$;
revoke all on function private.service_geographic_leaf_plan(uuid,uuid,bigint,text),
 private.service_read_geographic_leaf(uuid,uuid,bigint,text),
 private.service_reserve_geographic_leaf(uuid,uuid,bigint,text,text,text),
 public.service_read_geographic_leaf(uuid,uuid,bigint,text),
 public.service_reserve_geographic_leaf(uuid,uuid,bigint,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function private.service_geographic_leaf_plan(uuid,uuid,bigint,text),
 private.service_read_geographic_leaf(uuid,uuid,bigint,text),
 private.service_reserve_geographic_leaf(uuid,uuid,bigint,text,text,text),
 public.service_read_geographic_leaf(uuid,uuid,bigint,text),
 public.service_reserve_geographic_leaf(uuid,uuid,bigint,text,text,text)
 to service_role;
