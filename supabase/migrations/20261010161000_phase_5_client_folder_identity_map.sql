-- Phase 5D: immutable, company-scoped address/WO parent identities.
-- Candidate migration only. Does NOT create Drive folders or enable delivery.
-- Package create/CAS and provider writes remain separately gated.
alter table private.client_packages
  add column folder_address_snapshot text,
  add column folder_address_key text;
alter table private.client_packages
  add constraint client_package_frozen_address check(
    (folder_address_snapshot is null and folder_address_key is null and status='DRAFT')
    or (folder_address_snapshot is not null and
      char_length(folder_address_snapshot) between 3 and 320
      and folder_address_key ~ '^[a-f0-9]{64}$'));

-- Freeze the authoritative WO address when the package becomes approved.
-- Later WO address edits or reassignment cannot change an approved package.
create function private.freeze_client_package_folder_address()
returns trigger language plpgsql security definer set search_path='' as $freeze$
declare w public.work_orders%rowtype; canonical text;
begin
  if tg_op='UPDATE' and old.folder_address_key is not null then
    if new.folder_address_key is distinct from old.folder_address_key
      or new.folder_address_snapshot is distinct from old.folder_address_snapshot then
      raise exception 'Frozen package address cannot change' using errcode='40001';
    end if;
    return new;
  end if;
  if new.status='DRAFT' then
    if new.folder_address_snapshot is not null or new.folder_address_key is not null then
      raise exception 'Draft cannot supply frozen folder path' using errcode='42501';
    end if;
    return new;
  end if;
  if new.folder_address_snapshot is not null or new.folder_address_key is not null then
    raise exception 'Folder path must be captured from the current work order'
      using errcode='42501';
  end if;
  select * into w from public.work_orders where id=new.work_order_id for share;
  if w.id is null or w.organization_id is distinct from new.organization_id
    or w.client_company_id is distinct from new.company_id then
    raise exception 'Company-scoped work order required' using errcode='42501';
  end if;
  canonical:=lower(regexp_replace(btrim(w.property_address),'[[:space:]]+',' ','g'));
  if char_length(canonical) not between 3 and 320 then
    raise exception 'Address grouping unavailable' using errcode='22023';
  end if;
  new.folder_address_snapshot:=btrim(w.property_address);
  new.folder_address_key:=encode(sha256(convert_to(canonical,'UTF8')),'hex');
  if char_length(new.folder_address_snapshot)>320 then
    raise exception 'Address snapshot too long' using errcode='22023';
  end if;
  return new;
end;
$freeze$;
create trigger freeze_client_package_folder_address
  before insert or update on private.client_packages
  for each row execute function private.freeze_client_package_folder_address();
revoke all on function private.freeze_client_package_folder_address() from public,anon,authenticated;

-- Address groups may be reused within the EXACT company/destination revision.
-- One WO folder remains one identity despite subsequent assignment changes.
-- No provider-created identity can be rewritten, upserted or reallocated.
create table private.client_delivery_parent_maps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null,
  destination_id uuid not null references private.client_delivery_destinations(id) on delete restrict,
  destination_revision uuid not null,
  kind text not null check(kind in ('ADDRESS','WORK_ORDER')),
  folder_key text not null check(char_length(folder_key) between 36 and 64),
  address_key text not null check(address_key ~ '^[a-f0-9]{64}$'),
  address_snapshot text not null check(char_length(address_snapshot) between 3 and 320),
  work_order_id uuid references public.work_orders(id) on delete restrict,
  parent_map_id uuid references private.client_delivery_parent_maps(id) on delete restrict,
  parent_remote_id text not null check(parent_remote_id ~ '^[A-Za-z0-9_-]{3,160}$'),
  remote_folder_id text not null unique check(remote_folder_id ~ '^[A-Za-z0-9_-]{10,160}$'),
  remote_name text not null check(char_length(remote_name) between 3 and 160),
  state text not null default 'RESERVED' check(state in ('RESERVED','ATTEMPTED','VERIFIED','UNCERTAIN')),
  create_attempts integer not null default 0 check(create_attempts between 0 and 1),
  verified_at timestamptz,
  remote_evidence jsonb,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(organization_id,company_id)
    references private.client_companies(organization_id,id) on delete restrict,
  unique(organization_id,company_id,destination_id,destination_revision,kind,folder_key),
  check((kind='ADDRESS' and work_order_id is null and parent_map_id is null
         and folder_key=address_key)
    or (kind='WORK_ORDER' and work_order_id is not null and parent_map_id is not null
         and folder_key=work_order_id::text)),
  check((state='VERIFIED' and verified_at is not null and remote_evidence is not null)
    or (state<>'VERIFIED' and verified_at is null)),
  check((state='RESERVED' and create_attempts=0)
    or (state<>'RESERVED' and create_attempts=1))
);
create index delivery_parent_maps_package_path on private.client_delivery_parent_maps
  (organization_id,company_id,destination_id,kind,work_order_id);
alter table private.client_delivery_parent_maps enable row level security;
revoke all on private.client_delivery_parent_maps from public,anon,authenticated,service_role;
grant select on private.client_delivery_parent_maps to service_role;

-- Each call is guarded by the CURRENT delivery outbox lease and frozen manifest.
-- Reserved IDs must come from trusted Google generateIds and be persisted before
-- attempting remote create. Never auto-replace an existing reserved remote ID.
create function private.service_reserve_delivery_parent(
  p_package uuid,p_worker uuid,p_generation bigint,p_kind text,
  p_remote_id text,p_parent_id text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $reserve$
declare
  k private.client_packages%rowtype;
  o private.client_delivery_outbox%rowtype;
  d private.client_delivery_destinations%rowtype;
  parent private.client_delivery_parent_maps%rowtype;
  found private.client_delivery_parent_maps%rowtype;
  m jsonb; expected_parent text; part text; label text; map_parent uuid;
begin
  perform private.service_delivery_guard(p_package,p_worker,p_generation);
  if p_kind not in ('ADDRESS','WORK_ORDER')
     or p_remote_id is null or p_remote_id !~ '^[A-Za-z0-9_-]{10,160}$'
     or p_parent_id is null or p_parent_id !~ '^[A-Za-z0-9_-]{3,160}$'
     or p_remote_id=p_parent_id then
    raise exception 'Immutable remote folder and parent IDs required' using errcode='22023';
  end if;
  select * into k from private.client_packages where id=p_package;
  select * into o from private.client_delivery_outbox where package_id=p_package;
  if k.id is null or o.package_id is null or k.status<>'DELIVERING'
    or k.folder_address_key is null
    or k.approved_sha256 is distinct from o.approved_sha256
    or k.destination_id is distinct from o.destination_id then
    raise exception 'Frozen package and current delivery required' using errcode='42501';
  end if;
  m:=k.approved_manifest;
  -- Geographic layouts may not silently reserve legacy address-under-root
  -- parents until their complete immutable ancestor chain is enabled.
  if coalesce(m->>'folder_layout','ADDRESS_WORK_ORDER')<>'ADDRESS_WORK_ORDER' then
    raise exception 'Geographic parent reservations require verified full hierarchy'
      using errcode='42501';
  end if;
  select * into d from private.client_delivery_destinations where id=k.destination_id;
  if d.id is null or d.organization_id is distinct from k.organization_id
     or d.company_id is distinct from k.company_id
     or not d.verified or not d.active
     or d.revision::text is distinct from m->>'destination_revision'
     or d.root_folder_id is distinct from m->>'destination_root' then
    raise exception 'Frozen company destination revision required' using errcode='42501';
  end if;
  if p_kind='ADDRESS' then
    part:=k.folder_address_key;
    expected_parent:=d.root_folder_id;
    label:=left(regexp_replace(k.folder_address_snapshot,'[[:cntrl:]/]',' ','g'),100)
      ||' - '||left(part,12);
    map_parent:=null;
  else
    part:=k.work_order_id::text;
    select * into parent from private.client_delivery_parent_maps
     where organization_id=k.organization_id and company_id=k.company_id
       and destination_id=d.id and destination_revision=d.revision
       and kind='ADDRESS' and folder_key=k.folder_address_key;
    if parent.id is null or parent.address_key<>k.folder_address_key then
      raise exception 'First reserve this package address group' using errcode='42501';
    end if;
    expected_parent:=parent.remote_folder_id;
    label:='work-order-'||k.work_order_id::text;
    map_parent:=parent.id;
  end if;
  if expected_parent is distinct from p_parent_id then
    raise exception 'Cross-company or unexpected folder parent' using errcode='42501';
  end if;
  insert into private.client_delivery_parent_maps(
    organization_id,company_id,destination_id,destination_revision,kind,folder_key,
    address_key,address_snapshot,work_order_id,parent_map_id,parent_remote_id,
    remote_folder_id,remote_name)
  values(k.organization_id,k.company_id,d.id,d.revision,p_kind,part,
    k.folder_address_key,k.folder_address_snapshot,
    case when p_kind='WORK_ORDER' then k.work_order_id else null end,
    map_parent,expected_parent,p_remote_id,label)
  on conflict(organization_id,company_id,destination_id,destination_revision,kind,folder_key)
    do nothing;
  select * into found from private.client_delivery_parent_maps
   where organization_id=k.organization_id and company_id=k.company_id
     and destination_id=d.id and destination_revision=d.revision
     and kind=p_kind and folder_key=part for update;
  if found.id is null or found.remote_folder_id is distinct from p_remote_id
    or found.parent_remote_id is distinct from expected_parent
    or found.parent_map_id is distinct from map_parent
    or found.address_key is distinct from k.folder_address_key
    or found.work_order_id is distinct from
       (case when p_kind='WORK_ORDER' then k.work_order_id else null end) then
    raise exception 'Existing remote folder identity must be preserved' using errcode='40001';
  end if;
  return jsonb_build_object('map_id',found.id,'kind',found.kind,
    'remote_folder_id',found.remote_folder_id,'parent_remote_id',found.parent_remote_id,
    'state',found.state,'address_key',found.address_key);
end;
$reserve$;
create function public.service_reserve_delivery_parent(
  p_package uuid,p_worker uuid,p_generation bigint,p_kind text,
  p_remote_id text,p_parent_id text
) returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_reserve_delivery_parent(
    p_package,p_worker,p_generation,p_kind,p_remote_id,p_parent_id)
$wrap$;
revoke all on function private.service_reserve_delivery_parent(uuid,uuid,bigint,text,text,text),
 public.service_reserve_delivery_parent(uuid,uuid,bigint,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function private.service_reserve_delivery_parent(uuid,uuid,bigint,text,text,text),
 public.service_reserve_delivery_parent(uuid,uuid,bigint,text,text,text) to service_role;


-- Before generating another Drive ID, inspect the existing ID behind the
-- same CURRENT service delivery lease. A second package at the same address
-- must reuse the original mapped parent rather than create a competing folder.
create function private.service_read_delivery_parent(
  p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $read$
declare
  k private.client_packages%rowtype;
  o private.client_delivery_outbox%rowtype;
  d private.client_delivery_destinations%rowtype;
  existing private.client_delivery_parent_maps%rowtype;
  part text;
begin
  perform private.service_delivery_guard(p_package,p_worker,p_generation);
  if p_kind not in ('ADDRESS','WORK_ORDER') then
    raise exception 'Exact folder kind required' using errcode='22023';end if;
  select * into k from private.client_packages where id=p_package;
  select * into o from private.client_delivery_outbox where package_id=p_package;
  if k.id is null or o.package_id is null or k.status<>'DELIVERING'
    or k.approved_sha256 is distinct from o.approved_sha256
    or k.destination_id is distinct from o.destination_id
    or k.folder_address_key is null then
    raise exception 'Frozen package and lease required' using errcode='42501';end if;
  select * into d from private.client_delivery_destinations where id=k.destination_id;
  if d.id is null or d.organization_id is distinct from k.organization_id
     or d.company_id is distinct from k.company_id or not d.verified or not d.active
     or d.revision::text is distinct from k.approved_manifest->>'destination_revision'
     or d.root_folder_id is distinct from k.approved_manifest->>'destination_root' then
     raise exception 'Frozen company destination revision required' using errcode='42501';end if;
  part:=case when p_kind='ADDRESS' then k.folder_address_key else k.work_order_id::text end;
  select * into existing from private.client_delivery_parent_maps
    where organization_id=k.organization_id and company_id=k.company_id
      and destination_id=d.id and destination_revision=d.revision
      and kind=p_kind and folder_key=part;
  if existing.id is null then
    return jsonb_build_object('exists',false,'kind',p_kind);
  end if;
  if existing.address_key is distinct from k.folder_address_key
    or (p_kind='WORK_ORDER' and existing.work_order_id is distinct from k.work_order_id) then
    raise exception 'Existing parent folder belongs to another frozen identity'
      using errcode='42501';end if;
  return jsonb_build_object('exists',true,'map_id',existing.id,'kind',existing.kind,
    'remote_folder_id',existing.remote_folder_id,'parent_remote_id',existing.parent_remote_id,
    'remote_name',existing.remote_name,'state',existing.state,
    'appProperties',jsonb_build_object('fwh_org',existing.organization_id::text,
      'fwh_company',existing.company_id::text,
      'fwh_destination',existing.destination_id::text,
      'fwh_kind',existing.kind,'fwh_key',existing.folder_key));
end;
$read$;
create function public.service_read_delivery_parent(
  p_package uuid,p_worker uuid,p_generation bigint,p_kind text
) returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_read_delivery_parent(p_package,p_worker,p_generation,p_kind)
$wrap$;
revoke all on function private.service_read_delivery_parent(uuid,uuid,bigint,text),
 public.service_read_delivery_parent(uuid,uuid,bigint,text)
 from public,anon,authenticated,service_role;
grant execute on function private.service_read_delivery_parent(uuid,uuid,bigint,text),
 public.service_read_delivery_parent(uuid,uuid,bigint,text) to service_role;
