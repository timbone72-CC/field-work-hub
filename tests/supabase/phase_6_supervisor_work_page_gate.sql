-- Disposable Phase 6F work projection gate. Never touches hosted Team data.
begin;
do $gate$
declare
  org uuid:=gen_random_uuid(); foreign_org uuid:=gen_random_uuid();
  team_a uuid:=gen_random_uuid(); team_b uuid:=gen_random_uuid(); team_foreign uuid:=gen_random_uuid();
  admin_user uuid:=gen_random_uuid(); owner_user uuid:=gen_random_uuid();
  t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid(); t3 uuid:=gen_random_uuid();
  wo_a uuid; wo_a2 uuid; wo_b uuid; wo_foreign uuid;
  actor uuid; role_name text; result jsonb; cursor_text text; denied boolean;
  count_rows integer; tier integer; original_scope text;
begin
  insert into public.organizations(id,name) values
    (org,'Supervisor work gate'),(foreign_org,'Other organization');
  insert into public.admin_teams(id,organization_id,name) values
    (team_a,org,'A'),(team_b,org,'B'),(team_foreign,foreign_org,'Foreign');
  foreach actor in array array[admin_user,owner_user,t1,t2,t3] loop
    role_name:=case when actor in (t1,t2,t3) then 'SUPERVISOR' else 'ADMIN' end;
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
    values(actor,actor::text||'@example.invalid',now(),
      jsonb_build_object('role',role_name,'organization_id',org));
    insert into auth.sessions(id,user_id) values(actor,actor);
    insert into private.account_work_access(organization_id,user_id,work_role,active)
    values(org,actor,role_name,true);
  end loop;
  insert into private.platform_owner_capabilities(user_id,active,environment,verified_at)
    values(owner_user,true,'TEST',now());
  insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
  values(org,t1,1,true,owner_user,'TEST tier'),(org,t2,2,true,owner_user,'TEST tier'),
    (org,t3,3,true,owner_user,'TEST tier');
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
  values(org,t1,team_a),(org,t2,team_a),(org,t3,team_a);
  insert into public.work_orders(organization_id,responsible_team_id,wo_number,
    property_address,work_type,due_date)
  values(org,team_a,'WO-A','A address','TEST',current_date) returning id into wo_a;
  insert into public.work_orders(organization_id,responsible_team_id,wo_number,
    property_address,work_type,due_date)
  values(org,team_a,'WO-A2','A2 address','TEST',current_date) returning id into wo_a2;
  insert into public.work_orders(organization_id,responsible_team_id,wo_number,
    property_address,work_type,due_date)
  values(org,team_b,'WO-B','B address','TEST',current_date) returning id into wo_b;
  insert into public.work_orders(organization_id,responsible_team_id,wo_number,
    property_address,work_type,due_date)
  values(foreign_org,team_foreign,'WO-FOREIGN','Secret address','TEST',current_date)
  returning id into wo_foreign;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',t1,'session_id',t1)::text,true);
  denied:=false;
  begin perform public.office_supervisor_work_page(org,null,25);
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Supervisor projection activated without settings';end if;
  insert into private.org_work_settings(organization_id,supervisor_work_ready)
    values(org,true);
  for tier in 1..3 loop
    actor:=case tier when 1 then t1 when 2 then t2 else t3 end;
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub',actor,'session_id',actor)::text,true);
    execute 'set local role authenticated';
    result:=public.office_supervisor_work_page(org,null,25);
    execute 'reset role';
    count_rows:=jsonb_array_length(result->'work_orders');
    if (result->>'organization_id')<>org::text
      or (result->>'caller_tier')::integer<>tier
      or (result->>'scope_fingerprint') is null
      or (result->>'scope_fingerprint') !~ '^[0-9a-f]{32}$'
      or count_rows<>(case when tier=3 then 3 else 2 end)
      or result::text like '%WO-FOREIGN%'
      or (tier<3 and result::text like '%WO-B%') then
      raise exception 'Tier % returned wrong work scope: %',tier,result;
    end if;
  end loop;
  -- Paginate by exact immutable WO IDs; no new team appears across pages.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',t1,'session_id',t1)::text,true);
  result:=public.office_supervisor_work_page(org,null,1);
  cursor_text:=result->>'next_after';
  original_scope:=result->>'scope_fingerprint';
  if cursor_text is null or jsonb_array_length(result->'work_orders')<>1 then
    raise exception 'Bounded work cursor missing';
  end if;
  result:=public.office_supervisor_work_page(org,cursor_text::uuid,1);
  if jsonb_array_length(result->'work_orders')<>1
    or (result->>'next_after') is not null
    or result->>'scope_fingerprint' is distinct from original_scope then
    raise exception 'Stable work cursor or unchanged scope did not terminate correctly';
  end if;
  -- A team-scope edit between pages changes the opaque browser binding.
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
    values(org,t1,team_b);
  result:=public.office_supervisor_work_page(org,null,25);
  if result->>'scope_fingerprint' is not distinct from original_scope
    or jsonb_array_length(result->'work_orders')<>3 then
    raise exception 'Expanded Supervisor team scope kept stale paging identity';
  end if;
  delete from private.supervisor_team_scopes where user_id=t1 and team_id=team_b;
  result:=public.office_supervisor_work_page(org,null,25);
  if result->>'scope_fingerprint' is distinct from original_scope
    or jsonb_array_length(result->'work_orders')<>2 then
    raise exception 'Exact team scope did not recover after rollback';
  end if;
  foreach actor in array array[admin_user,owner_user] loop
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub',actor,'session_id',actor)::text,true);
    denied:=false;
    begin perform public.office_supervisor_work_page(org,null,25);
      exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Admin/Owner read Supervisor work projection';end if;
  end loop;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',t2,'session_id',t2)::text,true);
  denied:=false;
  begin perform public.office_supervisor_work_page(foreign_org,null,25);
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Cross-organization work projection succeeded';end if;
  denied:=false;
  begin perform public.office_supervisor_work_page(org,null,51);
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Unbounded work projection succeeded';end if;
  delete from private.supervisor_team_scopes where user_id=t2 and team_id=team_a;
  result:=public.office_supervisor_work_page(org,null,25);
  if jsonb_array_length(result->'work_orders')<>0 then
    raise exception 'Removed team scope still exposed work';end if;
  update private.account_work_access set active=false where user_id=t2;
  denied:=false;
  begin perform public.office_supervisor_work_page(org,null,25);
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Disabled Supervisor still read work';end if;
  -- Auth session validity, not a retained role claim, controls access.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',t1,'session_id',gen_random_uuid())::text,true);
  denied:=false;
  begin perform public.office_supervisor_work_page(org,null,25);
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Stale session still read work';end if;
end;
$gate$;
rollback;
