-- Phase 6B: extend the existing flat Phase 4 template owner.
-- Source candidate only; do not apply to a hosted Team database until the governed release gate.
-- Existing org-wide template IDs, revisions, historical run snapshots and RPC stay valid.
alter table public.photo_templates
 add column company_id uuid,
 add column description text not null default '' check(char_length(description)<=2000),
 add column instructions text not null default '' check(char_length(instructions)<=4000),
 add constraint photo_templates_company_same_org_fk
   foreign key(organization_id,company_id)
   references private.client_companies(organization_id,id) on delete restrict;

-- The old single-org name/default indexes must not suppress separate company choices.
-- Names remain unique within each scope, and existing null-company rows retain identity.
alter table public.photo_templates drop constraint photo_templates_organization_id_name_key;
create unique index photo_templates_org_name_idx
 on public.photo_templates(organization_id,name) where company_id is null;
create unique index photo_templates_company_name_idx
 on public.photo_templates(organization_id,company_id,name) where company_id is not null;
drop index public.photo_templates_one_default_idx;
create unique index photo_templates_org_default_idx
 on public.photo_templates(organization_id,lower(btrim(work_type)))
 where active and is_default and company_id is null;
create unique index photo_templates_company_default_idx
 on public.photo_templates(organization_id,company_id,lower(btrim(work_type)))
 where active and is_default and company_id is not null;

-- Keep one mutation owner and serialize each org's short template transactions.
-- Server-authoritative account/team checks are inherited from the established
-- Phase 5 legacy office gate; client-selected company UUID never grants access.
create function private.admin_save_company_photo_template(
 p_id uuid,p_name text,p_work_type text,p_requirements jsonb,
 p_active boolean,p_is_default boolean,p_expected_revision uuid,
 p_company_id uuid,p_description text,p_instructions text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $save$
declare
 o uuid; t public.photo_templates%rowtype;
 new_description text; new_instructions text;
begin
 perform private.lock_legacy_work_authority();
 o:=private.phase4_admin_org();
 perform private.validate_photo_requirements(p_requirements);
 if p_id is null or p_active is null or p_is_default is null
   or coalesce(char_length(btrim(p_name)) between 1 and 100,false) is false
   or coalesce(char_length(btrim(p_work_type)) between 1 and 200,false) is false
   or (p_description is not null and char_length(p_description)>2000)
   or (p_instructions is not null and char_length(p_instructions)>4000)
 then raise exception 'Invalid template details' using errcode='22023';end if;
 if p_company_id is not null and not exists (
   select 1 from private.client_companies c where c.id=p_company_id
    and c.organization_id=o and c.active
 ) then raise exception 'Company unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('fwh.template.org.'||o::text,0));
 select * into t from public.photo_templates where id=p_id for update;
 if t.id is not null then
   if t.organization_id is distinct from o
     or t.company_id is distinct from p_company_id then
     raise exception 'Template unavailable in selected company scope' using errcode='42501';end if;
   if t.revision is distinct from p_expected_revision then
     raise exception 'Template changed. Reload and retry.' using errcode='40001';end if;
 elsif p_expected_revision is not null then
   raise exception 'Template unavailable' using errcode='40001';
 end if;
 new_description:=coalesce(p_description,t.description,'');
 new_instructions:=coalesce(p_instructions,t.instructions,'');
 -- Update only the exact same default scope; company B cannot demote A/org.
 if p_is_default and p_active then
   update public.photo_templates set
      is_default=false,revision=gen_random_uuid(),updated_at=clock_timestamp()
   where organization_id=o and company_id is not distinct from p_company_id
     and lower(btrim(work_type))=lower(btrim(p_work_type))
     and id<>p_id and active and is_default;
 end if;
 if t.id is not null then
   update public.photo_templates set name=btrim(p_name),work_type=btrim(p_work_type),
      requirements=p_requirements,active=p_active,is_default=p_active and p_is_default,
      description=new_description,instructions=new_instructions,
      revision=gen_random_uuid(),updated_at=clock_timestamp()
    where id=p_id returning * into t;
 else
   insert into public.photo_templates(
     id,organization_id,company_id,name,work_type,requirements,
     active,is_default,description,instructions
   ) values(p_id,o,p_company_id,btrim(p_name),btrim(p_work_type),p_requirements,
      p_active,p_active and p_is_default,new_description,new_instructions)
     returning * into t;
 end if;
 return to_jsonb(t);
end;
$save$;

-- Preserve the installed seven-argument Phase 4 RPC, while preventing it from
-- silently changing company-scoped templates. Null metadata preserves existing.
create or replace function private.admin_save_photo_template(
 p_id uuid,p_name text,p_work_type text,p_requirements jsonb,
 p_active boolean,p_is_default boolean,p_expected_revision uuid
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $legacy$
begin
 return private.admin_save_company_photo_template(
   p_id,p_name,p_work_type,p_requirements,p_active,p_is_default,
   p_expected_revision,null,null,null);
end;
$legacy$;

create function public.admin_save_company_photo_template(
 p_id uuid,p_name text,p_work_type text,p_requirements jsonb,
 p_active boolean,p_is_default boolean,p_expected_revision uuid,
 p_company_id uuid,p_description text,p_instructions text
) returns jsonb language sql security invoker set search_path='' as $public$
 select private.admin_save_company_photo_template(
   p_id,p_name,p_work_type,p_requirements,p_active,p_is_default,
   p_expected_revision,p_company_id,p_description,p_instructions);
$public$;
revoke all on function private.admin_save_company_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_save_company_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid,uuid,text,text)
 to authenticated,service_role;
revoke all on function public.admin_save_company_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_save_company_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid,uuid,text,text)
 to authenticated,service_role;
