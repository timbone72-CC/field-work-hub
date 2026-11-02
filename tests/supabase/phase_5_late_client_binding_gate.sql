-- Exact synthetic Phase 5A late company binding and immutable field evidence.
-- No hosted changes; all fixtures and binding writes roll back.
begin;
create function pg_temp.late_client_wo(p_number text,p_finish boolean,p_remote boolean)
returns uuid language plpgsql as $fixture$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 admin_id uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011';
 team uuid:='00000000-0000-0000-0000-000000000020';
 wo uuid; run uuid; instance uuid; revision uuid;
 photo uuid:=gen_random_uuid(); finish_set uuid:=gen_random_uuid(); digest text;
 cfg jsonb; pictures jsonb; reply jsonb;
begin
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
    'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
   'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(
   false,p_number,'DISPOSABLE LATE CLIENT','INSPECTION','',current_date,contractor,cfg) j;
 update public.work_orders set responsible_team_id=team where id=wo;
 select current_run_id into run from public.work_orders where id=wo;
 select id into instance from public.work_order_assignments
   where run_id=run and assignment_ended_at is null;
 select (requirement_snapshot->>'revision')::uuid into revision
   from public.work_order_runs where id=run;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor,
   'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
 reply:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'START',
   to_char(now()-interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),revision,null,'');
 if reply->>'outcome'<>'APPLIED' then raise exception 'Synthetic Start failed';end if;
 if p_finish then
   pictures:=jsonb_build_array(jsonb_build_object('id',photo,'item_id',null,
     'captured_at',to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
   digest:=encode(sha256(convert_to(pictures::text,'UTF8')),'hex');
   reply:=public.register_photo_finish_set(finish_set,wo,run,instance,revision,pictures,digest,pictures::text);
   if reply->>'outcome'<>'APPLIED' then raise exception 'Synthetic original photo set failed';end if;
   reply:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'COMPLETE',
     to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),revision,finish_set,digest);
   if reply->>'outcome'<>'APPLIED' then raise exception 'Synthetic Finish failed';end if;
   if p_remote then
     update public.photos set remote_file_id='legacy-provider-object'
       where work_order_id=wo;
   end if;
 end if;
 return wo;
end;
$fixture$;
do $gate$
declare org uuid:='00000000-0000-0000-0000-000000000001';
 admin_id uuid:='00000000-0000-0000-0000-000000000010';
 company uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid();
 other_org uuid:=gen_random_uuid(); foreign_company uuid:=gen_random_uuid();
 wo uuid; in_progress uuid; legacy_remote uuid; rev uuid; action uuid:=gen_random_uuid();
 response jsonb; replay jsonb; denied boolean;
 before_photo jsonb; after_photo jsonb; before_actions jsonb; after_actions jsonb;
 old_run uuid; old_finish uuid; before_wo jsonb; after_wo jsonb;
begin
 insert into private.client_companies(id,organization_id,name)
   values(company,org,'LATE TEST CLIENT'),(other_company,org,'LATE OTHER CLIENT');
 insert into public.organizations(id,name) values(other_org,'LATE FOREIGN ORG');
 insert into private.client_companies(id,organization_id,name)
   values(foreign_company,other_org,'LATE FOREIGN CLIENT');
 wo:=pg_temp.late_client_wo('LATE-COMPLETE-'||gen_random_uuid(),true,false);
 in_progress:=pg_temp.late_client_wo('LATE-START-'||gen_random_uuid(),false,false);
 legacy_remote:=pg_temp.late_client_wo('LATE-REMOTE-'||gen_random_uuid(),true,true);
 select review_policy_revision,current_run_id into rev,old_run from public.work_orders where id=wo;
 select finish_set_id into old_finish from public.photos where work_order_id=wo;
 select to_jsonb(p) into before_photo from public.photos p where work_order_id=wo;
 select jsonb_agg(to_jsonb(a) order by a.action_kind) into before_actions
   from public.field_actions a where work_order_id=wo;
 select to_jsonb(w)-'client_company_id'-'review_policy_revision'-'updated_at'
   into before_wo from public.work_orders w where id=wo;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
  'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 execute 'set local role authenticated';
 denied:=false;
 begin perform public.admin_assign_client_company(gen_random_uuid(),wo,foreign_company,rev);
 exception when others then if sqlstate<>'42501' then raise;end if;denied:=true;end;
 if not denied then raise exception 'Foreign org late company allowed';end if;
 denied:=false;
 begin perform public.admin_assign_client_company(gen_random_uuid(),in_progress,company,
   (select review_policy_revision from public.work_orders where id=in_progress));
 exception when others then if sqlstate<>'42501' then raise;end if;denied:=true;end;
 if not denied then raise exception 'Started incomplete work late-bound';end if;
 denied:=false;
 begin perform public.admin_assign_client_company(gen_random_uuid(),legacy_remote,company,
   (select review_policy_revision from public.work_orders where id=legacy_remote));
 exception when others then if sqlstate<>'42501' then raise;end if;denied:=true;end;
 if not denied then raise exception 'Legacy provider photo identity rebound';end if;
 response:=public.admin_assign_client_company(action,wo,company,rev);
 if response->>'company_id'<>company::text then raise exception 'First binding did not persist';end if;
 replay:=public.admin_assign_client_company(action,wo,company,rev);
 if response is distinct from replay then raise exception 'Exact action replay changed outcome';end if;
 denied:=false;
 begin perform public.admin_assign_client_company(action,wo,other_company,rev);
 exception when others then if sqlstate<>'22023' then raise;end if;denied:=true;end;
 if not denied then raise exception 'Changed-payload replay was accepted';end if;
 denied:=false;
 begin perform public.admin_assign_client_company(gen_random_uuid(),wo,other_company,
  (response->>'review_policy_revision')::uuid);
 exception when others then if sqlstate<>'42501' then raise;end if;denied:=true;end;
 if not denied then raise exception 'Established client company changed';end if;
 denied:=false;
 begin perform public.admin_assign_client_company(gen_random_uuid(),wo,company,rev);
 exception when others then if sqlstate<>'PT409' then raise;end if;denied:=true;end;
 if not denied then raise exception 'Stale client revision was accepted';end if;
 execute 'reset role';
 select to_jsonb(p) into after_photo from public.photos p where work_order_id=wo;
 select jsonb_agg(to_jsonb(a) order by a.action_kind) into after_actions
   from public.field_actions a where work_order_id=wo;
 select to_jsonb(w)-'client_company_id'-'review_policy_revision'-'updated_at'
   into after_wo from public.work_orders w where id=wo;
 if before_photo is distinct from after_photo or before_actions is distinct from after_actions
    or before_wo is distinct from after_wo
    or (select current_run_id from public.work_orders where id=wo)<>old_run
    or (select finish_set_id from public.photos where work_order_id=wo)<>old_finish
 then raise exception 'Immutable photo, field actions or WO context changed';end if;
 if (select client_company_id from public.work_orders where id=wo)<>company
   or (select count(*) from private.client_company_assignment_actions where work_order_id=wo)<>1
   or (select actor_user_id from private.client_company_assignment_actions where action_id=action)<>admin_id
   or (select count(*) from private.client_packages where work_order_id=wo)<>0
 then raise exception 'Audited first-time binding or package protection failed';end if;
 if has_table_privilege('authenticated','private.client_company_assignment_actions','SELECT')
    or has_table_privilege('anon','private.client_company_assignment_actions','SELECT')
 then raise exception 'Private company binding audit exposed';end if;
 raise notice 'Phase 5 first-time client binding: completed legacy photo, same-org, idempotent revision, freeze and evidence PASS';
end;
$gate$;
rollback;
