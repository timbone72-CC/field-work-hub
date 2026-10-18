-- Disposable Phase 6F Supervisor assignment mutation gate. Never touches hosted Team data.
begin;
do $gate$
declare
  org uuid:=gen_random_uuid(); team uuid:=gen_random_uuid(); owner uuid:=gen_random_uuid();
  sup uuid:=gen_random_uuid(); oldc uuid:=gen_random_uuid(); newc uuid:=gen_random_uuid();
  wo uuid; scope text; rev text; action uuid:=gen_random_uuid(); r jsonb; denied boolean;
begin
  insert into public.organizations(id,name) values(org,'Supervisor assignment gate');
  insert into public.admin_teams(id,organization_id,name) values(team,org,'A');
  foreach owner in array array[owner,sup,oldc,newc] loop
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(
      owner,owner::text||'@example.invalid',now(),jsonb_build_object(
        'role',case when owner=sup then 'SUPERVISOR' when owner in(oldc,newc) then 'CONTRACTOR' else 'ADMIN' end,
        'organization_id',org));
    insert into auth.sessions(id,user_id) values(owner,owner);
  end loop;
  insert into private.account_work_access(organization_id,user_id,work_role,active) values
    (org,sup,'SUPERVISOR',true),(org,oldc,'CONTRACTOR',true),(org,newc,'CONTRACTOR',true);
  insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
    values(org,sup,1,true,owner,'test');
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id) values(org,sup,team);
  insert into private.contractor_team_memberships(organization_id,user_id,team_id,active) values
    (org,oldc,team,true),(org,newc,team,true);
  insert into private.org_work_settings(organization_id,supervisor_work_ready) values(org,true);
  insert into public.work_orders(organization_id,responsible_team_id,assigned_user_id,wo_number,property_address,work_type,due_date)
    values(org,team,oldc,'WO-A','A','TEST',current_date) returning id into wo;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',sup,'session_id',sup)::text,true);
  r:=public.office_supervisor_work_page(org,null,25); scope:=r->>'scope_fingerprint';
  rev:=(public.office_supervisor_work_detail(org,wo,scope)->'work_order'->>'work_revision');
  r:=public.office_supervisor_assign_work(action,org,wo,newc,scope,rev,'route change');
  if r->>'status'<>'ASSIGNED' or (select assigned_user_id from public.work_orders where id=wo)<>newc
    or (select assignment_received_at from public.work_orders where id=wo) is not null
  then raise exception 'Assigned-state Supervisor assignment failed: %',r; end if;
  if public.office_supervisor_assign_work(action,org,wo,newc,scope,rev,'route change') is distinct from r
  then raise exception 'Exact assignment retry was not idempotent'; end if;
  denied:=false; begin perform public.office_supervisor_assign_work(action,org,wo,newc,scope,rev,'changed');
    exception when serialization_failure then denied:=true; end;
  if not denied then raise exception 'Assignment action UUID accepted changed inputs'; end if;

  -- In progress: request only. Current Contractor must consent.
  update public.work_orders set assigned_user_id=oldc,field_status='IN_PROGRESS',started_at=now(),
    pending_assignee_user_id=null,reassignment_requested_at=null where id=wo;
  rev:=md5(to_jsonb(w)::text) from public.work_orders w where id=wo;
  r:=public.office_supervisor_assign_work(gen_random_uuid(),org,wo,newc,scope,rev,'coverage');
  if r->>'status'<>'CONSENT_REQUIRED' or (select assigned_user_id from public.work_orders where id=wo)<>oldc
    or (select pending_assignee_user_id from public.work_orders where id=wo)<>newc
  then raise exception 'In-progress assignment bypassed consent: %',r; end if;

  -- Candidate losing current team eligibility before consent must block commit.
  update private.contractor_team_memberships set active=false where user_id=newc and team_id=team;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',oldc,'session_id',oldc,'app_metadata',
    jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  denied:=false; begin perform public.respond_reassignment(wo,true);
    exception when insufficient_privilege then denied:=true; end;
  if not denied or (select assigned_user_id from public.work_orders where id=wo)<>oldc
  then raise exception 'Consent committed an ineligible pending Contractor'; end if;
  update private.contractor_team_memberships set active=true where user_id=newc and team_id=team;
  perform public.respond_reassignment(wo,true);
  if (select assigned_user_id from public.work_orders where id=wo)<>newc
    or (select pending_assignee_user_id from public.work_orders where id=wo) is not null
    or (select assignment_received_at from public.work_orders where id=wo) is not null
  then raise exception 'Eligible consent did not commit reassignment safely'; end if;
  -- A Contractor's formerly valid JWT must not authorize consent once work
  -- access is disabled, even with a real matching pending assignment.
  update public.work_orders set field_status='IN_PROGRESS',assigned_user_id=newc,
    pending_assignee_user_id=oldc,reassignment_requested_at=now() where id=wo;
  update private.account_work_access set active=false where organization_id=org and user_id=newc;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',newc,'session_id',newc,'app_metadata',
    jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  denied:=false; begin perform public.respond_reassignment(wo,true);
    exception when insufficient_privilege then denied:=true; end;
  if not denied or (select assigned_user_id from public.work_orders where id=wo)<>newc
  then raise exception 'Disabled Contractor consent bypassed current work authority'; end if;
end;
$gate$;
rollback;
