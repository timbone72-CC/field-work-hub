-- Phase 5D candidate: explicit per-company, per-destination layout policy.
-- Private configuration foundation only: no admin UI/write RPC or Drive sends.
-- Existing companies without configuration remain on their original layout.
create table private.client_delivery_folder_layouts (
 destination_id uuid primary key references private.client_delivery_destinations(id) on delete restrict,
 organization_id uuid not null,
 company_id uuid not null,
 layout text not null check(layout in
  ('ADDRESS_WORK_ORDER','STATE_CITY_ADDRESS','STATE_COUNTY_CITY_ADDRESS')),
 revision uuid not null default gen_random_uuid(),
 configured_at timestamptz not null default clock_timestamp(),
 configured_by uuid not null,
 check (revision is not null)
);
alter table private.client_delivery_folder_layouts enable row level security;
revoke all on private.client_delivery_folder_layouts from public,anon,authenticated,service_role;
grant select on private.client_delivery_folder_layouts to service_role;

-- Read-only scope guard: a stored configuration must match the verified
-- destination exactly. Never infer a layout from address or client name.
create function private.phase_5_current_folder_layout(
 p_destination uuid,p_org uuid,p_company uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $layout$
declare c private.client_delivery_folder_layouts%rowtype;
 d private.client_delivery_destinations%rowtype;
begin
 select * into d from private.client_delivery_destinations where id=p_destination;
 if d.id is null or d.organization_id is distinct from p_org
  or d.company_id is distinct from p_company then
   raise exception 'Destination company scope mismatch' using errcode='42501';
 end if;
 select * into c from private.client_delivery_folder_layouts where destination_id=p_destination;
 if c.destination_id is null then
   return jsonb_build_object('configured',false,'layout','ADDRESS_WORK_ORDER');
 end if;
 if c.organization_id is distinct from p_org or c.company_id is distinct from p_company then
   raise exception 'Cross-company layout configuration denied' using errcode='42501';
 end if;
 return jsonb_build_object('configured',true,'layout',c.layout,'revision',c.revision);
end;
$layout$;
revoke all on function private.phase_5_current_folder_layout(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;

-- Replace the prior trigger without changing its existing geographic checks.
-- Installed AFTER it alphabetically, so explicit layout rules apply to all
-- new non-draft approvals, whether geographic or original address-only.
create function private.phase_5_guard_company_folder_layout()
returns trigger language plpgsql security definer set search_path='' as $guard$
declare selected jsonb; chosen text; configured boolean;
begin
 if new.status='DRAFT' then return new;end if;
 if tg_op='UPDATE' and old.status<>'DRAFT' then
   -- Previously approved packages preserve their original layout and
   -- revision even when company policy later changes.
   if new.approved_manifest is distinct from old.approved_manifest
     or new.approved_sha256 is distinct from old.approved_sha256
     or new.destination_id is distinct from old.destination_id then
     raise exception 'Approved package layout is immutable' using errcode='40001';
   end if;
   return new;
 end if;
 selected:=private.phase_5_current_folder_layout(
   new.destination_id,new.organization_id,new.company_id);
 configured:=selected->>'configured'='true';
 chosen:=new.approved_manifest->>'folder_layout';
 if configured then
   if chosen is distinct from selected->>'layout'
     or new.approved_manifest->>'folder_layout_revision'
         is distinct from selected->>'revision' then
     raise exception 'Approved layout does not match selected company policy'
       using errcode='42501';
   end if;
 else
   -- Legacy address-only approval remains supported until an Admin
   -- explicitly configures that company.
   if chosen is not null and chosen<>'ADDRESS_WORK_ORDER' then
     raise exception 'Explicit company folder layout configuration required'
       using errcode='42501';
   end if;
 end if;
 if coalesce(chosen,'ADDRESS_WORK_ORDER')='ADDRESS_WORK_ORDER'
   and new.approved_manifest ? 'geographic_path' then
   raise exception 'Address-only layout cannot claim geography'
     using errcode='42501';
 end if;
 if chosen='STATE_CITY_ADDRESS' then
   -- State/city freeze + parent chain are not yet implemented. Never
   -- accept an approval that would imply those folders exist.
   raise exception 'State/city layout approval not yet enabled'
     using errcode='42501';
 end if;
 return new;
end;
$guard$;
create trigger phase_5_company_folder_layout
 before insert or update on private.client_packages
 for each row execute function private.phase_5_guard_company_folder_layout();
revoke all on function private.phase_5_guard_company_folder_layout()
 from public,anon,authenticated,service_role;
