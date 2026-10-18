-- Rollback-only current-access proof. Never run these fixtures on hosted Supabase.
begin;
set local timezone='UTC';
create function pg_temp.deny(p_sql text) returns void language plpgsql as $$
declare denied boolean:=false;
begin
  begin execute p_sql;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unexpected authorization: %',p_sql;end if;
end; $$;
create function pg_temp.claims(p_user uuid,p_role text,p_org uuid) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'session_id',p_user,
    'app_metadata',jsonb_build_object('role',p_role,'organization_id',p_org))::text,true);
$$;
create function pg_temp.recovery_fixture_photo(p_admin uuid,p_org uuid,p_team uuid,p_actor uuid,p_complete boolean)
returns uuid language plpgsql as $$
declare wo uuid; run uuid; instance uuid; rev uuid; set_id uuid:=gen_random_uuid(); photo uuid:=gen_random_uuid();
  cfg jsonb; photos jsonb; digest text; result jsonb;
begin
  cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_admin,'session_id',p_admin,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',p_org))::text,true);
  select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(false,'RECOVERY-'||photo,'TEST','TEST','',current_date,p_actor,cfg) j;
  update public.work_orders set responsible_team_id=p_team where id=wo;
  select current_run_id into run from public.work_orders where id=wo;
  select id into instance from public.work_order_assignments where run_id=run and assignment_ended_at is null;
  select (requirement_snapshot->>'revision')::uuid into rev from public.work_order_runs where id=run;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'session_id',p_actor,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',p_org))::text,true);
  result:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'START',to_char(now()-interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),rev,null,'');
  if result->>'outcome'<>'APPLIED' then raise exception 'Fixture Start failed: %',result;end if;
  photos:=jsonb_build_array(jsonb_build_object('id',photo,'item_id',null,'captured_at',to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  digest:=encode(sha256(convert_to(photos::text,'UTF8')),'hex');
  result:=public.register_photo_finish_set(set_id,wo,run,instance,rev,photos,digest,photos::text);
  if result->>'outcome'<>'APPLIED' then raise exception 'Fixture metadata failed: %',result;end if;
  if p_complete then
    result:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'COMPLETE',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),rev,set_id,digest);
    if result->>'outcome'<>'APPLIED' then raise exception 'Fixture Finish failed: %',result;end if;
  end if;
  return photo;
end;
$$;
do $gate$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 team uuid:='00000000-0000-0000-0000-000000000020';
 admin_id uuid:='00000000-0000-0000-0000-000000000010';
 a uuid:='00000000-0000-0000-0000-000000000011'; b uuid:='00000000-0000-0000-0000-000000000012';
 team_b uuid:=gen_random_uuid(); other_admin uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 wo uuid; wo_b uuid; unmapped uuid; legacy uuid; run uuid; instance uuid; photo uuid; other_photo uuid:=gen_random_uuid();
 template_id uuid:=gen_random_uuid(); cfg jsonb; response jsonb; fn record; relation text; n integer; cutoff uuid:=gen_random_uuid(); rev uuid;
begin
 insert into public.admin_teams(id,organization_id,name) values(team_b,org,'OTHER OFFICE');
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
  (other_admin,'office@example.invalid',now(),jsonb_build_object('role','ADMIN','organization_id',org)),
  (c,'other@example.invalid',now(),jsonb_build_object('role','CONTRACTOR','organization_id',org));
 insert into auth.sessions(id,user_id) values(other_admin,other_admin),(c,c);
 insert into private.account_work_access(organization_id,user_id,work_role,active) values(org,other_admin,'ADMIN',true),(org,c,'CONTRACTOR',true);
 insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(org,team_b,other_admin,true);
 insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values(org,team_b,c,true);
 perform pg_temp.claims(admin_id,'ADMIN',org);
 select work_order_id into wo from public.admin_create_work_order(false,'CUTOVER-'||gen_random_uuid(),'TEST','TEST','',current_date,a);
 if (select responsible_team_id from public.work_orders where id=wo)<>team then raise exception 'Dispatch omitted explicit team';end if;
 perform pg_temp.claims(other_admin,'ADMIN',org);
 select work_order_id into wo_b from public.admin_create_work_order(false,'CUTOVER-B-'||gen_random_uuid(),'TEST','TEST','',current_date,c);
 insert into public.work_orders(organization_id,assigned_user_id,wo_number,property_address,work_type,due_date)
 values(org,a,'UNMAPPED-'||gen_random_uuid(),'TEST','TEST',current_date) returning id into unmapped;
 -- Synthetic historical Admin assignment; disable only this test fixture INSERT guard.
 set constraints all immediate;
 alter table public.work_orders disable trigger work_orders_enforce_assignable_contractors;
 set constraints all deferred;
 insert into public.work_orders(organization_id,responsible_team_id,assigned_user_id,wo_number,property_address,work_type,due_date)
 values(org,team,admin_id,'LEGACY-'||gen_random_uuid(),'TEST','TEST',current_date) returning id into legacy;
 set constraints all immediate;
 alter table public.work_orders enable trigger work_orders_enforce_assignable_contractors;
 set constraints all deferred;
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 photo:=pg_temp.recovery_fixture_photo(admin_id,org,team,a,true);
 select work_order_id,run_id into wo_b,run from public.photos where id=photo;
 insert into public.photos(id,work_order_id,run_id,captured_by,captured_at) values(other_photo,wo_b,run,b,now());
 perform pg_temp.claims(admin_id,'ADMIN',org);execute 'set local role authenticated';
 response:=public.admin_save_photo_template(template_id,'CUTOVER-'||template_id,'TEST',cfg,true,false,null);
 if not exists(select 1 from public.work_orders where id=legacy) then raise exception 'Legacy Admin job not office-readable';end if;
 perform public.admin_update_work_order(legacy,(select wo_number from public.work_orders where id=legacy),'UPDATED','TEST','',current_date,admin_id);
 if not exists(select 1 from public.work_orders where id=legacy and assigned_user_id=admin_id and property_address='UPDATED') then raise exception 'Legacy Admin assignment not preserved on edit';end if;
 if exists(select 1 from public.work_orders where responsible_team_id=team_b or id=unmapped)
   or exists(select 1 from public.field_assignments() j where j->>'responsible_team_id'=team_b::text or j->>'id'=unmapped::text)
   or exists(select 1 from public.admin_list_assignable_users() u where u.user_id=c) then raise exception 'Office crossed team/unmapped boundary';end if;
 perform pg_temp.deny(format('select * from public.start_work(%L)',legacy));
 perform pg_temp.deny(format('select * from public.acknowledge_assignment_received(%L)',legacy));
 perform pg_temp.deny(format('select * from public.admin_create_work_order(false,%L,%L,%L,%L,current_date,%L)','DENIED','TEST','TEST','',c));
 perform pg_temp.deny(format('select * from public.admin_update_work_order(%L,%L,%L,%L,%L,current_date,%L)',wo,'DENIED','TEST','TEST','',c));
 perform pg_temp.deny(format('select * from public.admin_set_photo_requirements(%L,null,%L::jsonb)',unmapped,cfg));
 perform pg_temp.deny(format('select * from public.admin_update_work_order(%L,%L,%L,%L,%L,current_date,%L)',unmapped,'DENIED','TEST','TEST','',a));
 execute 'reset role';
 select id into wo_b from public.work_orders where responsible_team_id=team_b limit 1;
 execute 'set local role authenticated';
 perform pg_temp.deny(format('select * from public.admin_update_work_order(%L,%L,%L,%L,%L,current_date,%L)',wo_b,'DENIED','TEST','TEST','',c));
 -- Retained engines cannot be invoked around the new guards, through either schema.
 for fn in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='private' and (p.proname like '%\_phase4\_engine' escape '\' or p.proname='accept_field_action_legacy_v3') loop
   if has_function_privilege('authenticated',fn.signature,'EXECUTE') or has_function_privilege('anon',fn.signature,'EXECUTE') then raise exception 'Retained engine exposed: %',fn.signature;end if;
 end loop;
 perform pg_temp.claims(a,'CONTRACTOR',org);
 if (select count(*) from public.photos where id in(photo,other_photo))<>1
   or exists(select 1 from public.photos where id=other_photo) then raise exception 'Contractor read another capturer';end if;
 -- Reassignment does not turn someone else's existing photos into evidence access.
 execute 'reset role';update public.work_orders set assigned_user_id=b where id=(select work_order_id from public.photos where id=photo);
 execute 'set local role authenticated';
 if not exists(select 1 from public.photos where id=photo) then raise exception 'Active capturing owner lost own historical evidence';end if;
 perform pg_temp.claims(b,'CONTRACTOR',org);
 if exists(select 1 from public.photos where id=photo) then raise exception 'New assignee gained former owner photos';end if;
 -- Missing session and stale organization/role metadata cannot operate installed APIs.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 perform pg_temp.deny('select * from public.field_assignments()');
 if exists(select 1 from public.work_orders) then raise exception 'Missing session retained reads';end if;
 perform pg_temp.claims(admin_id,'ADMIN',gen_random_uuid());
 perform pg_temp.deny('select * from public.admin_list_assignable_users()');
 if exists(select 1 from public.work_orders) then raise exception 'Stale org retained reads';end if;
 execute 'reset role';
 perform pg_temp.claims(admin_id,'ADMIN',org);
 update private.account_work_access set active=false,suspension_authority='OWNER',suspension_reason='TEST',disabled_at=now() where user_id=admin_id;
 execute 'set local role authenticated';
 foreach relation in array array['organizations','work_orders','work_order_runs','work_order_assignments','photos','photo_finish_sets','field_actions'] loop
   execute format('select count(*) from public.%I',relation) into n;
   if n<>0 then raise exception 'Disabled account retained operational %',relation;end if;
 end loop;
 perform pg_temp.deny('select * from public.field_assignments()');
 perform pg_temp.deny('select * from public.admin_list_assignable_users()');
 perform pg_temp.deny('select * from public.photo_templates');
 perform pg_temp.deny(format('select * from public.admin_save_photo_template(%L,%L,%L,%L::jsonb,true,false,null)',gen_random_uuid(),'DENIED','TEST',cfg));
 perform pg_temp.deny(format('select * from public.admin_create_work_order(false,%L,%L,%L,%L,current_date,%L)','DENIED','TEST','TEST','',a));
 perform pg_temp.deny(format('select * from public.admin_update_work_order(%L,%L,%L,%L,%L,current_date,%L)',wo,'DENIED','TEST','TEST','',a));
 execute 'reset role';
 -- Freeze before Contractor disablement: recovery survives but operational access does not.
 select revision into rev from private.account_work_access where user_id=a;
 perform private.freeze_photo_recovery_scope(cutoff,org,a,rev,'{}','TEST');
 update private.account_work_access set active=false,suspension_authority='OWNER',suspension_reason='TEST',disabled_at=now() where user_id=a;
 perform private.complete_photo_recovery_grant(cutoff);
 perform pg_temp.claims(a,'CONTRACTOR',org);execute 'set local role authenticated';
 if not private.can_recover_photo(photo) then raise exception 'Work denial removed exact existing recovery rights';end if;
 if exists(select 1 from public.photos) or exists(select 1 from public.work_orders) then raise exception 'Recovery granted operational table access';end if;
 perform pg_temp.deny('select * from public.field_assignments()');
 perform pg_temp.deny(format('select * from public.start_work(%L)',wo));
 perform pg_temp.deny(format('select * from public.complete_field_work(%L)',wo));
 perform pg_temp.deny(format('select * from public.acknowledge_assignment_received(%L)',wo));
 perform pg_temp.deny(format('select public.accept_field_action(%L,%L,%L,%L,%L,%L)',gen_random_uuid(),wo,run,gen_random_uuid(),'START',now()::text));
 perform pg_temp.deny(format('select public.accept_field_action_v4(%L,%L,%L,%L,%L,%L,null,null,%L)',gen_random_uuid(),wo,run,gen_random_uuid(),'START',now()::text,''));
 perform pg_temp.deny(format('select public.register_photo_finish_set(%L,%L,%L,%L,null,%L::jsonb,%L,%L)',gen_random_uuid(),wo,run,gen_random_uuid(),'[]',repeat('0',64),'[]'));
 perform pg_temp.deny(format('insert into public.photos(work_order_id,run_id,captured_by,captured_at) values(%L,%L,%L,now())',wo,run,a));
 execute 'reset role';
 raise notice 'Phase 5 legacy work access: current/session/team/recovery/compatibility gates PASS';
end; $gate$;
rollback;
