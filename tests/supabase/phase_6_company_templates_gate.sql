-- Phase 6B: same template owner, per-company defaults, revision races and legacy RPC.
-- All rows synthetic; single transaction is rolled back.
begin;
do $gate$
declare
 aid uuid; org uuid; other_org uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid();
 cfg jsonb:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
   'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 org_template jsonb; first_a jsonb; next_a jsonb; first_b jsonb; alternate jsonb;
 saved jsonb; denied boolean:=false; claims text;
begin
 select id,(raw_app_meta_data->>'organization_id')::uuid into aid,org
 from auth.users where raw_app_meta_data->>'role'='ADMIN' and deleted_at is null
 order by created_at limit 1;
 if aid is null or org is null then raise exception 'Disposable Admin required';end if;
 insert into public.organizations(id,name) values(other_org,'DISPOSABLE TEMPLATES OTHER ORG');
 insert into private.client_companies(id,organization_id,name)
 values(a,org,'TEMPLATE CLIENT A'),(b,org,'TEMPLATE CLIENT B'),
       (foreign_id,other_org,'FOREIGN TEMPLATE CLIENT');
 claims:=jsonb_build_object('sub',aid,'session_id',aid,'role','authenticated',
   'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text;
 perform set_config('request.jwt.claims',claims,true);
 execute 'set local role authenticated';
 if has_table_privilege('authenticated','public.photo_templates','UPDATE')
   or has_table_privilege('authenticated','private.client_companies','SELECT')
   or has_function_privilege('anon',
      'public.admin_save_company_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid,uuid,text,text)','EXECUTE')
 then raise exception 'Template direct/client grant leaked';end if;
 org_template:=public.admin_save_photo_template(
   gen_random_uuid(),'Org Standard','MOW',cfg,true,true,null);
 first_a:=public.admin_save_company_photo_template(
   gen_random_uuid(),'Company A Standard','MOW',cfg,true,true,null,
   a,'Scoped A','Company A instructions');
 first_b:=public.admin_save_company_photo_template(
   gen_random_uuid(),'Company B Standard','MOW',cfg,true,true,null,
   b,'Scoped B','Company B instructions');
 if first_a->>'company_id'<>a::text
   or first_a->>'description'<>'Scoped A'
   or first_a->>'instructions'<>'Company A instructions'
   or (select count(*) from public.photo_templates
        where organization_id=org and work_type='MOW' and active and is_default)<>3
 then raise exception 'Three independent defaults unavailable';end if;
 alternate:=public.admin_save_company_photo_template(
   gen_random_uuid(),'Company A Alternate','MOW',cfg,true,false,null,a,'','');
 next_a:=public.admin_save_company_photo_template(
   (alternate->>'id')::uuid,'Company A Alternate','MOW',cfg,true,true,
   (alternate->>'revision')::uuid,a,'More details','New instructions');
 if (select count(*) from public.photo_templates where organization_id=org
   and active and is_default and work_type='MOW' and company_id=a)<>1
   or (select is_default from public.photo_templates where id=(first_a->>'id')::uuid)
   or not (select is_default from public.photo_templates where id=(first_b->>'id')::uuid)
   or not (select is_default from public.photo_templates where id=(org_template->>'id')::uuid)
 then raise exception 'Company default changed a different scope';end if;
 denied:=false;
 begin
  perform public.admin_save_company_photo_template(
    (alternate->>'id')::uuid,'STALE','MOW',cfg,true,true,
    (alternate->>'revision')::uuid,a,'','');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale revision overwrote template';end if;
 denied:=false;
 begin
  perform public.admin_save_company_photo_template(
    (next_a->>'id')::uuid,'WRONG CLIENT','MOW',cfg,true,true,
    (next_a->>'revision')::uuid,b,'','');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Company template was transferred by ID';end if;
 denied:=false;
 begin
  perform public.admin_save_company_photo_template(
    gen_random_uuid(),'FOREIGN','MOW',cfg,true,false,null,foreign_id,'','');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Foreign client template accepted';end if;
 denied:=false;
 begin
  perform public.admin_save_photo_template(
    (next_a->>'id')::uuid,'LEGACY MOVED','MOW',cfg,true,true,
    (next_a->>'revision')::uuid);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Old RPC moved a company-scoped template';end if;
 saved:=public.admin_save_photo_template(
   (org_template->>'id')::uuid,'Org Standard','MOW',cfg,true,true,
   (org_template->>'revision')::uuid);
 if saved->>'company_id' is not null then
   raise exception 'Legacy RPC lost its org-only scope';end if;
 saved:=public.admin_save_company_photo_template(
   (next_a->>'id')::uuid,'Company A Alternate','MOW',cfg,false,true,
   (next_a->>'revision')::uuid,a,null,null);
 if saved->>'active'<>'false' or saved->>'is_default'<>'false'
   or saved->>'instructions'<>'New instructions'
 then raise exception 'Archive or metadata preservation failed';end if;
 raise notice 'Phase 6B company-scoped flat template/revision/legacy gate PASS';
end;
$gate$;
rollback;
