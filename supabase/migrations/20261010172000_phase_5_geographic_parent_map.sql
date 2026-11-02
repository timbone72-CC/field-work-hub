-- Phase 5D candidate: extend the SAME protected parent identity ledger with
-- STATE -> COUNTY -> CITY. Does not activate Google Drive delivery.
-- The approved package must already freeze the exact geography revision/path.
alter table private.client_delivery_parent_maps
  add column geography_revision uuid,
  add column geographic_path_key text;

-- The original address/WO check was unnamed by the DDL author, so inspect the
-- catalog and fail if the expected exact constraint cannot be identified.
do $replace$
declare constraint_name text; matches integer;
begin
 select count(*), min(c.conname) into matches,constraint_name
 from pg_constraint c
 where c.conrelid='private.client_delivery_parent_maps'::regclass
   and c.contype='c'
   and pg_get_constraintdef(c.oid) like '%kind = %ADDRESS%'
   and pg_get_constraintdef(c.oid) like '%WORK_ORDER%'
   and pg_get_constraintdef(c.oid) like '%folder_key%';
 if matches<>1 then
   raise exception 'Unexpected legacy parent-map constraints; migration refused';
 end if;
 execute format('alter table private.client_delivery_parent_maps drop constraint %I',constraint_name);
end;
$replace$;

alter table private.client_delivery_parent_maps
  drop constraint client_delivery_parent_maps_kind_check,
  add constraint client_delivery_parent_maps_kind_check
    check (kind in ('STATE','COUNTY','CITY','ADDRESS','WORK_ORDER')),
  add constraint client_delivery_parent_identity_check check (
    (kind='STATE'
      and work_order_id is null and parent_map_id is null
      and folder_key ~ '^[a-f0-9]{64}$'
      and geography_revision is not null
      and geographic_path_key=folder_key)
    or (kind in ('COUNTY','CITY')
      and work_order_id is null and parent_map_id is not null
      and folder_key ~ '^[a-f0-9]{64}$'
      and geography_revision is not null
      and geographic_path_key=folder_key)
    or (kind='ADDRESS'
      and work_order_id is null
      and folder_key=address_key
      and ((geography_revision is null and parent_map_id is null)
        or (geography_revision is not null and parent_map_id is not null
          and geographic_path_key ~ '^[a-f0-9]{64}$')))
    or (kind='WORK_ORDER'
      and work_order_id is not null
      and parent_map_id is not null
      and folder_key=work_order_id::text)
  );

-- Geographic folder keys have a path-derived hash, not a global city name.
-- Retain the old immutable unique company/destination/revision/kind/key index.
-- Reserve/read functions for geographic kinds require a frozen approved path
-- and are deliberately NOT granted until the manifest-freeze revision exists.
create function private.geo_parent_path_key(
 p_parent_key text,p_kind text,p_name text
) returns text language plpgsql immutable set search_path='' as $key$
declare label text;
begin
 if p_kind not in ('STATE','COUNTY','CITY')
   or p_parent_key !~ '^[a-f0-9]{64}$'
   or p_name is null then
   raise exception 'Geographic path input required' using errcode='22023';
 end if;
 label:=lower(btrim(p_name));
 if char_length(label) not between 2 and 100 then
   raise exception 'Invalid geographic label' using errcode='22023';end if;
 return encode(sha256(convert_to(p_parent_key||':'||p_kind||':'||label,'UTF8')),'hex');
end;
$key$;
revoke all on function private.geo_parent_path_key(text,text,text)
 from public,anon,authenticated;
-- No public or authenticated geographic parent writes are exposed here.
