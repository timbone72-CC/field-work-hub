-- 6A-T01 disposable read-only queue and authorization boundary; always rolled back.
begin;
do $queue_gate$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 actor uuid:='00000000-0000-0000-0000-000000000010';
 worker uuid:='00000000-0000-0000-0000-000000000011';
 cfg jsonb:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
  'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 ids uuid[]:='{}'; wo uuid; run uuid; assignment uuid; finish uuid:=gen_random_uuid();
 digest text:=repeat('f',64); result jsonb; page2 jsonb; n integer; denied boolean;
 company uuid:=gen_random_uuid(); foreign_team uuid:=gen_random_uuid();
 baseline_packages bigint; baseline_receipts bigint; baseline_actions bigint;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,
  'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 insert into private.client_companies(id,organization_id,name) values(company,org,'QUEUE COMPANY');
 -- Match the organization's calendar day, including hours when UTC is tomorrow.
 for n in 1..1000 loop
   select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(false,
    'QUEUE-'||lpad(n::text,4,'0'),'Queue literal 50%_* property '||n,'INSPECTION','Queue only',
    (now() at time zone 'America/Chicago')::date-1,worker,cfg) j;
   ids:=array_append(ids,wo);
 end loop;
 update public.work_orders set client_company_id=company where id=any(ids);
 insert into private.admin_alert_organization_config(organization_id,timezone)
 values(org,'America/Chicago') on conflict(organization_id) do update set timezone=excluded.timezone;
 -- Current accepted zero-photo Finish is reviewable, never Completed without delivery.
 wo:=ids[1];select current_run_id into run from public.work_orders where id=wo;
 select id into assignment from public.work_order_assignments where run_id=run and assignment_ended_at is null;
 insert into public.photo_finish_sets(id,actor_user_id,organization_id,work_order_id,run_id,
  assignment_instance_id,photos,digest) values(finish,worker,org,wo,run,assignment,'[]',digest);
 insert into public.field_actions(action_id,actor_user_id,organization_id,work_order_id,run_id,
  assignment_instance_id,action_kind,event_time_text,event_at,accepted_at,result,finish_set_id,finish_digest)
 values(gen_random_uuid(),worker,org,wo,run,assignment,'COMPLETE',
  to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'),now(),now(),'{"outcome":"APPLIED"}',finish,digest);
 update public.work_orders set field_status='FIELD_COMPLETE',field_completed_at=now() where id=wo;
 update public.work_order_runs set field_status='FIELD_COMPLETE',field_completed_at=now() where id=run;
 -- An unaccepted field-status label cannot become received/reviewable/completed.
 update public.work_orders set field_status='FIELD_COMPLETE',field_completed_at=now() where id=ids[2];
 -- An inaccessible team in the SAME tenant must not leak a row OR a count.
 insert into public.admin_teams(id,organization_id,name) values(foreign_team,org,'UNAUTHORIZED QUEUE TEAM');
 insert into public.work_orders(organization_id,responsible_team_id,wo_number,property_address,work_type,due_date)
 values(org,foreign_team,'QUEUE-HIDDEN','Queue literal 50%_* hidden','TEST',current_date);
 select count(*) into baseline_packages from private.client_packages;
 select count(*) into baseline_receipts from private.client_delivery_final_receipts;
 select count(*) into baseline_actions from public.field_actions;
 execute 'set local role authenticated';
 if has_function_privilege('anon','public.admin_work_order_page(jsonb)','EXECUTE')
 or has_function_privilege('authenticated','private.admin_work_order_facts(uuid,timestamptz)','EXECUTE')
 or has_table_privilege('authenticated','private.client_packages','SELECT')
 then raise exception 'Read projection leaked private permission';end if;
 result:=public.admin_work_order_page(jsonb_build_object('search','Queue literal','size',25));
 if (result->>'total')::int<>1000 or jsonb_array_length(result->'rows')<>25
 or (result->'counts'->>'ALL')::int<>1000
 or (result->'counts'->>'AWAITING_REVIEW')::int<>1
 or (result->'counts'->>'PROBLEMS')::int<>1
 or (result->'counts'->>'OVERDUE')::int<>998
 or (result->'counts'->>'COMPLETED')::int<>0
 then raise exception 'Exact queue counts differ from scoped facts: %',result->'counts';end if;
 page2:=public.admin_work_order_page(jsonb_build_object('search','Queue literal','size',25,'offset',25));
 if (page2->>'scope_fingerprint') is distinct from (result->>'scope_fingerprint')
 or exists(select 1 from jsonb_array_elements(result->'rows') a
  join jsonb_array_elements(page2->'rows') b on a->>'id'=b->>'id')
 then raise exception 'Stable page scope/order overlapped';end if;
 result:=public.admin_work_order_page(jsonb_build_object('search','Queue literal','queue','AWAITING_REVIEW'));
 if (result->>'total')::int<>1 or result->'rows'->0->>'id'<>ids[1]::text
 or result->'rows'->0->'operational'->>'primary'<>'AWAITING_REVIEW'
 then raise exception 'Review queue does not match its exact row';end if;
 result:=public.admin_work_order_page(jsonb_build_object('search','50%_*','company',company,'companySearch','queue company'));
 if (result->>'total')::int<>1000 then raise exception 'Literal search or company filter failed';end if;
 result:=public.admin_work_order_page(jsonb_build_object('search','Queue literal','company',gen_random_uuid()));
 if (result->>'total')::int<>0 or exists(select 1 from jsonb_each(result->'counts') where value<>'0'::jsonb)
 then raise exception 'Foreign/empty filter leaked counts';end if;
 for n in 1..4 loop
   denied:=false;
   begin
     result:=public.admin_work_order_page(case n
       when 1 then '{"size":1000}'::jsonb when 2 then '{"queue":"eq.COMPLETED,ALL"}'::jsonb
       when 3 then '{"sort":"id);drop table work_orders"}'::jsonb
       else '{"organization_id":"00000000-0000-0000-0000-000000000001"}'::jsonb end);
   exception when sqlstate '22023' then denied:=true;end;
   if not denied then raise exception 'Unbounded/injected filter accepted';end if;
 end loop;
 execute 'reset role';
 if (select count(*) from private.client_packages)<>baseline_packages
 or (select count(*) from private.client_delivery_final_receipts)<>baseline_receipts
 or (select count(*) from public.field_actions)<>baseline_actions
 then raise exception 'Read page mutated protected records';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'session_id',worker,
  'role','authenticated','app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
 execute 'set local role authenticated';denied:=false;
 begin result:=public.admin_work_order_page('{}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor acquired office queue/count authority';end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,
  'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 -- Stale JWT remains denied immediately after current work entitlement changes.
 update private.account_work_access set active=false where user_id=actor and organization_id=org;
 execute 'set local role authenticated';denied:=false;
 begin result:=public.admin_work_order_page('{}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Disabled work session could list/count';end if;
 execute 'reset role';
end;$queue_gate$;
rollback;
