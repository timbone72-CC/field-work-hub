-- Disposable Phase 5A/5C company-policy gate, synthetic actors only.
begin;
do $test$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 admin_id uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011';
 team uuid:='00000000-0000-0000-0000-000000000020';
 company uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid();
 wo uuid; cfg jsonb; rev uuid; action uuid:=gen_random_uuid(); got jsonb; replay jsonb; denied boolean;
begin
 insert into public.organizations(id,name) values(other_org,'OTHER COMPANY TEST');
 insert into private.client_companies(id,organization_id,name)
 values(company,org,'DISPOSABLE CLIENT'),(other_company,other_org,'FOREIGN CLIENT');
 insert into private.client_delivery_destinations(organization_id,company_id,provider,provider_identity,root_folder_id)
 values(org,company,'GOOGLE_DRIVE','test@example.invalid','NOT-VERIFIED-ROOT');
 if exists(select 1 from private.client_delivery_destinations where active or verified)
 then raise exception 'Unverified destinations activated';end if;
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
 'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
 'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 select (j->>'work_order_id')::uuid into wo from
 public.admin_create_work_order_v4(false,'DISPOSABLE COMPANY TEST','TEST','TEST','',current_date,contractor,cfg) j;
 update public.work_orders set responsible_team_id=team where id=wo;
 select review_policy_revision into rev from public.work_orders where id=wo;
 if (select client_company_id from public.work_orders where id=wo) is not null
 or not (select review_required from public.work_orders where id=wo)
 then raise exception 'Company guessed or review not required by default';end if;
 execute 'set local role authenticated';
 denied:=false;
 begin perform public.admin_assign_client_company(gen_random_uuid(),wo,other_company,rev);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Cross-org company binding allowed';end if;
 got:=public.admin_assign_client_company(gen_random_uuid(),wo,company,rev);
 if got->>'company_id'<>company::text then raise exception 'Company binding failed';end if;
 rev:=(got->>'review_policy_revision')::uuid;
 got:=public.admin_set_review_required(action,wo,rev,false,'Review not required for test');
 replay:=public.admin_set_review_required(action,wo,rev,false,'Review not required for test');
 if got<>replay or got->>'review_required'<>'false'
 then raise exception 'Review toggle did not replay';end if;
 denied:=false;
 begin perform public.admin_set_review_required(gen_random_uuid(),wo,rev,true,'Stale setting');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale policy was accepted';end if;
 execute 'reset role';
 if (select count(*) from private.review_policy_actions where work_order_id=wo)<>1
 then raise exception 'Policy audit was not immutable or replay-safe';end if;
 if has_table_privilege('authenticated','private.client_companies','select')
 or has_table_privilege('authenticated','private.client_delivery_destinations','select')
 or has_table_privilege('authenticated','private.review_policy_actions','select')
 then raise exception 'Private client metadata exposed';end if;
 raise notice 'Phase 5 client mapping, default-deny destination, revision and audit PASS';
end;
$test$;
rollback;
