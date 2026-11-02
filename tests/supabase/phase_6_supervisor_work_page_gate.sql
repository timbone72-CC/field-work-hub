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
  correction_action uuid:=gen_random_uuid(); prior_revision timestamptz;
  assigned_contractor uuid:=gen_random_uuid();
  correction_result jsonb; prior_digest text;
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
  -- Tier 1 may correct a current job's deadline and append instructions;
  -- same action UUID must be replay-safe and no assignment/photo authority follows.
  select updated_at,md5(to_jsonb(w)::text) into prior_revision,prior_digest
    from public.work_orders w where id=wo_a;
  correction_result:=public.office_supervisor_correct_work_schedule(
    correction_action,org,wo_a,original_scope,prior_revision,prior_digest,
    current_date+1,'Added safe visit note','Scheduling correction');
  if correction_result->>'status'<>'SAVED'
     or correction_result->>'work_order_id'<>wo_a::text
     or (select due_date from public.work_orders where id=wo_a)<>current_date+1
     or (select instructions from public.work_orders where id=wo_a)<>'Added safe visit note'
     or (select md5(to_jsonb(w)::text) from public.work_orders w where id=wo_a)=prior_digest
  then raise exception 'Tier 1 job correction failed';end if;
  if public.office_supervisor_correct_work_schedule(
     correction_action,org,wo_a,original_scope,prior_revision,prior_digest,
     current_date+1,'Added safe visit note','Scheduling correction')
     is distinct from correction_result
  then raise exception 'Identical action retry was not idempotent';end if;
  denied:=false;
  begin perform public.office_supervisor_correct_work_schedule(
     correction_action,org,wo_a,original_scope,prior_revision,prior_digest,
     current_date+2,'Changed payload','Scheduling correction');
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Correction action UUID accepted changed input';end if;
  denied:=false;
  begin perform public.office_supervisor_correct_work_schedule(
     gen_random_uuid(),org,wo_a,original_scope,prior_revision,prior_digest,
     current_date+2,'Stale write','Scheduling correction');
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Stale revision overwrote job correction';end if;
  denied:=false;
  begin perform public.office_supervisor_correct_work_schedule(
     gen_random_uuid(),org,wo_b,original_scope,
     (select updated_at from public.work_orders where id=wo_b),
     (select md5(to_jsonb(w)::text) from public.work_orders w where id=wo_b),
     current_date+1,'Wrong team','Scheduling correction');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Wrong-team Supervisor edit succeeded';end if;
  if (select assigned_user_id from public.work_orders where id=wo_a) is not null
  then raise exception 'Schedule correction changed assignment';end if;
    result:=public.office_supervisor_work_detail(org,wo_a,original_scope);
  if result->>'organization_id'<>org::text
    or result->>'caller_tier'<>'1'
    or result->>'scope_fingerprint'<>original_scope
    or result->'work_order'->>'work_order_id'<>wo_a::text
    or result->'work_order'->>'team_id'<>team_a::text
    or result->'work_order'->>'wo_number'<>'WO-A'
    or result->'work_order' ? 'assigned_user_id'
    or result->'work_order' ? 'photos' then
    raise exception 'Selected detail crossed exact read-only scope: %',result;
  end if;
  -- A server-confirmed phone receipt is not the human's separate Accept.
  -- A Supervisor sees only an assignee on an already authorized exact WO.
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
    values(assigned_contractor,'assignment-demo@example.invalid',now(),
      jsonb_build_object('role','CONTRACTOR','organization_id',org));
  insert into private.account_work_access(organization_id,user_id,work_role,active)
    values(org,assigned_contractor,'CONTRACTOR',true);
  insert into private.contractor_team_memberships(organization_id,user_id,team_id,active)
    values(org,assigned_contractor,team_a,true);
  update public.work_orders
    set assigned_user_id=assigned_contractor,assignment_received_at=clock_timestamp()
    where id=wo_a2;
  result:=public.office_supervisor_work_detail(org,wo_a2,original_scope);
  if result->'work_order'->'assignment'->>'assignee_id'<>assigned_contractor::text
    or result->'work_order'->'assignment'->>'assignee_label'<>'assignment-demo@example.invalid'
    or result->'work_order'->'assignment'->>'download_received_at' is null
    or result->'work_order'->'assignment'->>'human_accepted_at' is not null
  then raise exception 'Supervisor assignment conflated receipt with human Accept: %',result;end if;
  -- Exact selected-WO eligible assignees are the only Tier 1 candidate list.
  -- No broad organizational roster, suspended person or stale-scope leak.
  result:=public.office_supervisor_assignment_candidates(org,wo_a2,original_scope,25,null);
  if result->>'work_order_id'<>wo_a2::text or result->>'team_id'<>team_a::text
    or result->>'field_status'<>'ASSIGNED'
    or result->>'requires_current_contractor_consent'<>'false'
    or jsonb_array_length(result->'candidate_contractors')<>1
    or result->'candidate_contractors'->0->>'user_id'<>assigned_contractor::text
    or result->'candidate_contractors'->0->>'label'<>'assignment-demo@example.invalid'
    or result->>'next_after' is not null
  then raise exception 'Scope-filtered eligible assignee candidate list incorrect: %',result;end if;
  denied:=false;
  begin perform public.office_supervisor_assignment_candidates(org,wo_b,original_scope,25,null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Wrong-team assignee candidates exposed';end if;
  denied:=false;
  begin perform public.office_supervisor_assignment_candidates(foreign_org,wo_foreign,original_scope,25,null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Cross-organization assignee candidates exposed';end if;
  denied:=false;
  begin perform public.office_supervisor_assignment_candidates(org,wo_a2,original_scope,500,null);
  exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Unbounded contractor candidate request succeeded';end if;
  update private.account_work_access set active=false where user_id=assigned_contractor;
  result:=public.office_supervisor_assignment_candidates(org,wo_a2,original_scope,25,null);
  if jsonb_array_length(result->'candidate_contractors')<>0
  then raise exception 'Disabled contractor remains assignable';end if;
  update private.account_work_access set active=true where user_id=assigned_contractor;
  -- Current field state changes whether the human's consent is mandatory.
  update public.work_orders set field_status='IN_PROGRESS' where id=wo_a2;
  result:=public.office_supervisor_assignment_candidates(org,wo_a2,original_scope,25,null);
  if result->>'requires_current_contractor_consent'<>'true'
  then raise exception 'In-progress assignment omitted Contractor consent';end if;
  update public.work_orders set field_status='ASSIGNED' where id=wo_a2;
  denied:=false;
  begin perform public.office_supervisor_work_detail(org,wo_b,original_scope);
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Unscoped team B detail leaked'; end if;
  denied:=false;
  begin perform public.office_supervisor_work_detail(org,wo_foreign,original_scope);
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Foreign WO detail leaked'; end if;
  denied:=false;
  begin perform public.office_supervisor_work_detail(org,wo_a,'bad fingerprint');
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Invalid detail fingerprint accepted'; end if;
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
  denied:=false;
  begin perform public.office_supervisor_work_detail(org,wo_a,original_scope);
    exception when serialization_failure then denied:=true; end;
  if not denied then raise exception 'Changed scope accepted old detail fingerprint'; end if;
  if (public.office_supervisor_work_detail(org,wo_b,result->>'scope_fingerprint')
      ->'work_order'->>'team_id')<>team_b::text then
    raise exception 'Newly authorized team detail remained unavailable';
  end if;
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
    denied:=false;
    begin perform public.office_supervisor_work_detail(org,wo_a,original_scope);
      exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Admin/Owner opened Supervisor detail';end if;
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
  denied:=false;
  begin perform public.office_supervisor_work_detail(org,wo_a,original_scope);
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Disabled Supervisor still opened detail';end if;
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
