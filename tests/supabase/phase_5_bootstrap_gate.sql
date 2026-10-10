-- Controlled disposable database only; the whole fixture rolls back.
begin;
do $gate$
declare
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid(); contractor uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid();
  other_admin uuid:=gen_random_uuid(); team uuid:=gen_random_uuid(); action uuid:=gen_random_uuid();
  wo uuid:=gen_random_uuid(); other_wo uuid:=gen_random_uuid(); legacy_wo uuid:=gen_random_uuid();
  snapshot jsonb; result jsonb; replay jsonb; before_rows jsonb; after_rows jsonb;
  denied boolean; invalid_snapshot jsonb; n integer;
begin
  insert into public.organizations(id,name) values(org,'BOOTSTRAP TEST'),(other_org,'UNMAPPED TEST');
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    (admin_id,'admin@example.invalid',now(),jsonb_build_object('organization_id',org,'role','ADMIN')),
    (contractor,'contractor@example.invalid',now(),jsonb_build_object('organization_id',org,'role','CONTRACTOR')),
    (owner_id,'owner@example.invalid',now(),'{}'),
    (other_admin,'other@example.invalid',now(),jsonb_build_object('organization_id',other_org,'role','ADMIN'));
  insert into auth.sessions(id,user_id) values(admin_id,admin_id),(owner_id,owner_id);
  -- Only this synthetic fixture temporarily bypasses the later assignee guard.
  alter table public.work_orders disable trigger work_orders_enforce_assignable_contractors;
  insert into public.work_orders(id,organization_id,assigned_user_id,wo_number,property_address,work_type,due_date)
    values(wo,org,contractor,'BOOTSTRAP-'||wo,'TEST','TEST',current_date),
      (other_wo,other_org,null,'UNMAPPED-'||other_wo,'TEST','TEST',current_date);
  -- Simulate pre-guard legacy data: bootstrap must preserve, not repair, assignment.
  insert into public.work_orders(id,organization_id,assigned_user_id,wo_number,property_address,work_type,due_date)
    values(legacy_wo,org,admin_id,'LEGACY-'||legacy_wo,'TEST','TEST',current_date);
  set constraints all immediate;
  alter table public.work_orders enable trigger work_orders_enforce_assignable_contractors;
  set constraints all deferred;
  snapshot:=private.initial_team_work_snapshot(org);
  select jsonb_agg(to_jsonb(w)-'responsible_team_id'-'updated_at' order by w.id)
    into before_rows from public.work_orders w where organization_id=org;

  -- Forged owner claims cannot reach the operator function or inventory helper.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
    'app_metadata',jsonb_build_object('role','OWNER','tier',3))::text,true);
  execute 'set local role authenticated';
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Authenticated self-bootstrap allowed';end if;
  denied:=false;
  begin perform private.initial_team_work_snapshot(other_org);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Authenticated bootstrap inventory exposed';end if;
  execute 'reset role';
  execute 'set local role anon';
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Anonymous bootstrap allowed';end if;
  execute 'reset role';

  -- Exact inventory; incomplete, foreign, duplicate and stale snapshots fail.
  foreach invalid_snapshot in array array['[]'::jsonb,snapshot||snapshot,
    snapshot||private.initial_team_work_snapshot(other_org),
    jsonb_set(snapshot,'{0,updated_at}','"2000-01-01T00:00:00+00:00"'::jsonb)] loop
    denied:=false;
    begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],invalid_snapshot,'TEST','Reviewed');
    exception when serialization_failure then denied:=true;end;
    if not denied then raise exception 'Incorrect reviewed inventory allowed';end if;
  end loop;
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor,contractor],snapshot,'TEST','Reviewed');
  exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Duplicate Contractor accepted';end if;
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial','{}'::uuid[],snapshot,'TEST','Reviewed');
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Contractor inventory omission accepted';end if;
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,other_admin,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Foreign Admin accepted';end if;
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,null,'Reviewed');
  exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Missing environment accepted';end if;

  update auth.users set email_confirmed_at=null where id=owner_id;
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unverified owner accepted';end if;
  update auth.users set email_confirmed_at=now() where id=owner_id;
  update auth.users set banned_until=now()+interval '1 day' where id=contractor;
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Banned Contractor silently reactivated';end if;
  update auth.users set banned_until=null where id=contractor;
  -- A second Admin requires deliberate multi-team mapping, never inferred grouping.
  update auth.users set raw_app_meta_data=jsonb_build_object('organization_id',org,'role','ADMIN') where id=other_admin;
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Multiple Admins auto-mapped';end if;
  update auth.users set raw_app_meta_data=jsonb_build_object('organization_id',other_org,'role','ADMIN') where id=other_admin;
  insert into private.platform_owner_capabilities(user_id,active,environment,verified_at) values(owner_id,false,'TEST',now());
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Inactive existing owner overwritten';end if;
  delete from private.platform_owner_capabilities where user_id=owner_id;
  if exists(select 1 from private.initial_access_bootstrap) or exists(select 1 from public.admin_teams where organization_id=org)
    or exists(select 1 from private.account_work_access where organization_id=org) then
    raise exception 'Failed setup left partial authority';end if;

  -- The confirmed real shape is one identity holding both distinct grants.
  -- Force a late transaction failure after success to also prove full rollback.
  begin
    perform private.bootstrap_initial_team_access(action,org,admin_id,admin_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
    perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
    if not private.is_current_platform_owner('TEST') or not private.can_work_order(wo) then
      raise exception 'Owner/Admin same identity lost one grant';end if;
    raise exception 'Synthetic late transaction failure' using errcode='ZX001';
  exception when sqlstate 'ZX001' then null;
  end;
  if exists(select 1 from private.initial_access_bootstrap)
    or exists(select 1 from private.platform_owner_capabilities)
    or exists(select 1 from private.account_work_access where organization_id=org)
    or exists(select 1 from public.admin_teams where organization_id=org)
    or exists(select 1 from public.work_orders where organization_id=org and responsible_team_id is not null) then
    raise exception 'Late failure retained partial mapping';end if;

  execute 'set local role service_role';
  result:=private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  replay:=private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  if result is distinct from replay or result->>'work_order_count'<>'2' or result->>'contractor_count'<>'1'
    or result->>'supervisor_work_ready'<>'false' then raise exception 'Atomic mapping/replay result wrong';end if;
  denied:=false;
  begin delete from private.initial_access_bootstrap where action_id=action;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Operator ledger is mutable through service table grant';end if;
  execute 'reset role';
  select jsonb_agg(to_jsonb(w)-'responsible_team_id'-'updated_at' order by w.id)
    into after_rows from public.work_orders w where organization_id=org;
  if before_rows is distinct from after_rows then raise exception 'Setup changed legacy work facts';end if;
  if exists(select 1 from public.work_orders where organization_id=org and responsible_team_id is distinct from team)
    or (select responsible_team_id from public.work_orders where id=other_wo) is not null then
    raise exception 'Mapping missed reviewed row or crossed organization';end if;
  if exists(select 1 from private.org_office_allowances) or exists(select 1 from private.supervisor_grants)
    or (select supervisor_work_ready from private.org_work_settings where organization_id=org) then
    raise exception 'Bootstrap invented seats or activated Supervisors';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
  if not private.can_work_order(wo) or private.can_work_order(other_wo) then raise exception 'Initial Admin work scope wrong';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
  if not private.is_current_platform_owner('TEST') or private.is_current_platform_owner('PRODUCTION')
    or private.can_work_order(wo) then raise exception 'Owner capability granted business work';end if;

  -- Retries are historical outcomes, not restoration: do not overwrite newer facts.
  update private.platform_owner_capabilities set active=false where user_id=owner_id;
  update private.account_work_access set active=false,suspension_authority='OWNER',suspension_reason='TEST',disabled_at=now()
    where user_id=admin_id;
  replay:=private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  if result is distinct from replay or (select active from private.platform_owner_capabilities where user_id=owner_id)
    or (select active from private.account_work_access where user_id=admin_id) then raise exception 'Replay restored revoked authority';end if;
  denied:=false;
  begin perform private.bootstrap_initial_team_access(action,org,admin_id,owner_id,team,'Changed',array[contractor],snapshot,'TEST','Reviewed');
  exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Changed action payload accepted';end if;
  denied:=false;
  begin perform private.bootstrap_initial_team_access(gen_random_uuid(),org,admin_id,owner_id,team,'Initial',array[contractor],snapshot,'TEST','Reviewed');
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Second bootstrap action allowed';end if;
  select count(*) into n from private.initial_access_bootstrap;
  if n<>1 then raise exception 'Duplicate bootstrap audit';end if;
  raise notice 'Phase 5 initial setup: exact inventory, isolation, atomic mapping, replay and operator boundary PASS';
end;
$gate$;
rollback;
