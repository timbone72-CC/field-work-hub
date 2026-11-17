-- Disposable PostgreSQL authority and atomic company/dispatch gate; no provider calls.
begin;
do $gate$
declare
 org uuid:='00000000-0000-0000-0000-000000000001'; actor uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011'; company uuid:=gen_random_uuid(); inactive uuid:=gen_random_uuid();
 foreign_org uuid:=gen_random_uuid(); foreign_company uuid:=gen_random_uuid(); cfg jsonb; payload jsonb;
 draft jsonb; rev uuid; result jsonb; replay jsonb; choices jsonb; denied boolean; before_work bigint; wo uuid; procedure regprocedure;
begin
 insert into public.organizations(id,name) values(foreign_org,'SYNTHETIC FOREIGN');
 insert into private.client_companies(id,organization_id,name,active) values
  (company,org,'SYNTHETIC ACTIVE',true),(inactive,org,'SYNTHETIC INACTIVE',false),(foreign_company,foreign_org,'SYNTHETIC FOREIGN',true);
 select count(*) into before_work from public.work_orders;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,'role','authenticated',
  'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 execute 'set local role authenticated';
 choices:=public.admin_creation_client_choices();
 if choices->>'organization_id'<>org::text or not exists(select 1 from jsonb_array_elements(choices->'companies') c where c->>'id'=company::text)
  or exists(select 1 from jsonb_array_elements(choices->'companies') c where c->>'id' in (inactive::text,foreign_company::text))
 then raise exception 'Client choices leaked scope or included inactive company';end if;
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 payload:=jsonb_build_object('woNumber','COMPANY-'||gen_random_uuid(),'propertyAddress','Synthetic address','workType','TEST',
  'instructions','Saved without company','dueDate',current_date::text,'assignedUserId',contractor::text,
  'requirements',cfg,'requirementsLegacy',false,'expectedRevision',null,'numberMode','custom','rememberNumberMode',false,'sourceTemplateId',null);
 draft:=public.admin_save_job_draft(null,payload,null,null,gen_random_uuid());rev:=(draft->'draft'->>'revision')::uuid;
 denied:=false;begin perform public.admin_create_work_order_from_draft(rev);exception when sqlstate '22023' then denied:=true;end;
 if not denied or public.admin_job_draft_state(null)->'draft'->>'revision'<>rev::text then raise exception 'Missing company dispatched or lost draft';end if;
 foreach wo in array array[foreign_company,inactive] loop
  payload:=payload||jsonb_build_object('clientCompanyId',wo::text);
  draft:=public.admin_save_job_draft(null,payload,rev,null,gen_random_uuid());rev:=(draft->'draft'->>'revision')::uuid;
  denied:=false;begin perform public.admin_create_work_order_from_draft(rev);exception when insufficient_privilege then denied:=true;end;
  if not denied or public.admin_job_draft_state(null)->'draft'->>'revision'<>rev::text then raise exception 'Foreign/inactive client dispatched or lost draft';end if;
 end loop;
 execute 'reset role';
 if (select count(*) from public.work_orders)<>before_work then raise exception 'Rejected client created partial work';end if;
 execute 'set local role authenticated';
 payload:=payload||jsonb_build_object('clientCompanyId',company::text);
 draft:=public.admin_save_job_draft(null,payload,rev,null,gen_random_uuid());rev:=(draft->'draft'->>'revision')::uuid;
 select j into result from public.admin_create_work_order_from_draft(rev) j;
 select j into replay from public.admin_create_work_order_from_draft(rev) j;
 wo:=(result->>'work_order_id')::uuid;
 if result is distinct from replay or result->>'client_company_id'<>company::text
  or public.admin_job_draft_state(null)->'draft'<>'null'::jsonb then raise exception 'Company creation/consume/replay failed';end if;
 execute 'reset role';
 if (select count(*) from public.work_orders)<>before_work+1
  or (select client_company_id from public.work_orders where id=wo) is distinct from company
  or (select count(*) from public.work_order_runs where work_order_id=wo)<>1
  or (select count(*) from public.work_order_assignments a join public.work_order_runs r on r.id=a.run_id where r.work_order_id=wo)<>1
  or (select count(*) from private.client_company_assignment_actions where work_order_id=wo)<>1
 then raise exception 'Creation and exact client binding were not one transaction';end if;
 foreach procedure in array array[
  'public.admin_create_work_order(boolean,text,text,text,text,date,uuid)'::regprocedure,
  'private.admin_create_work_order(boolean,text,text,text,text,date,uuid)'::regprocedure,
  'public.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb)'::regprocedure,
  'private.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb)'::regprocedure] loop
  if has_function_privilege('authenticated',procedure,'EXECUTE') or has_function_privilege('anon',procedure,'EXECUTE')
  then raise exception 'Legacy creation can bypass client requirement';end if;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor,'role','authenticated',
  'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
 execute 'set local role authenticated';
 denied:=false;begin perform public.admin_creation_client_choices();exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor listed office clients';end if;
 denied:=false;begin perform public.admin_create_work_order_from_draft(rev);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor replayed office creation';end if;
 execute 'reset role';
end;$gate$;
rollback;
