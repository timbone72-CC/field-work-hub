-- Disposable Phase 6F-T01 Supervisor authority gate; no hosted data or photos.
begin;
do $gate$
declare
  org uuid:=gen_random_uuid(); team_a uuid:=gen_random_uuid(); team_b uuid:=gen_random_uuid();
  supervisor uuid:=gen_random_uuid(); contractor_a uuid:=gen_random_uuid(); contractor_b uuid:=gen_random_uuid();
  owner_id uuid:=gen_random_uuid(); actor uuid; company uuid:=gen_random_uuid(); draft jsonb; result jsonb;
  payload jsonb; revision uuid; denied boolean; assignable_count integer;
  wo uuid; before_edit timestamptz; after_edit timestamptz; action uuid;
  replay jsonb; current_revision uuid;
  cfg jsonb:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
    'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
begin
  insert into public.organizations(id,name) values(org,'6F-T01 shared office gate');
  insert into public.admin_teams(id,organization_id,name) values(team_a,org,'Scoped'),(team_b,org,'Outside scope');
  foreach actor in array array[owner_id,supervisor,contractor_a,contractor_b] loop
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
      values(actor,actor::text||'@example.invalid',now(),
        jsonb_build_object('role',case when actor=supervisor then 'SUPERVISOR' when actor=owner_id then 'ADMIN' else 'CONTRACTOR' end,
          'organization_id',org));
    insert into auth.sessions(id,user_id) values(actor,actor);
  end loop;
  insert into private.account_work_access(organization_id,user_id,work_role,active) values
    (org,owner_id,'ADMIN',true),(org,supervisor,'SUPERVISOR',true),
    (org,contractor_a,'CONTRACTOR',true),(org,contractor_b,'CONTRACTOR',true);
  insert into private.platform_owner_capabilities(user_id,active,environment,verified_at)
    values(owner_id,true,'TEST',now());
  insert into private.org_work_settings(organization_id,supervisor_work_ready) values(org,true);
  insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
    values(org,supervisor,1,true,owner_id,'TEST');
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id) values(org,supervisor,team_a);
  insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values
    (org,team_a,contractor_a,true),(org,team_b,contractor_b,true);
  insert into private.client_companies(id,organization_id,name,active) values(company,org,'T01 TEST CLIENT',true);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisor,'session_id',supervisor,
    'role','authenticated','app_metadata',jsonb_build_object('role','SUPERVISOR','organization_id',org))::text,true);
  execute 'set local role authenticated';
  select count(*) into assignable_count from public.office_supervisor_assignable_users();
  if assignable_count<>1 or not exists(select 1 from public.office_supervisor_assignable_users() where user_id=contractor_a)
  then raise exception 'Assignable users escaped the Supervisor team scope'; end if;
  if exists(select 1 from public.office_supervisor_assignable_users() where user_id=contractor_b)
  then raise exception 'Other-team Contractor was exposed to Supervisor'; end if;

  payload:=jsonb_build_object('woNumber','T01-'||gen_random_uuid(),'propertyAddress','Scoped test address',
    'workType','TEST','instructions','Supervisor draft','dueDate',current_date::text,
    'assignedUserId',contractor_a::text,'requirements',cfg,'requirementsLegacy',false,
    'expectedRevision',null,'numberMode','custom','rememberNumberMode',false,'sourceTemplateId',null,
    'clientCompanyId',company::text);
  draft:=public.admin_save_job_draft(null,payload,null,null,gen_random_uuid());
  revision:=(draft->'draft'->>'revision')::uuid;
  select j into result from public.admin_create_work_order_from_draft(revision) j;
  wo:=(result->>'work_order_id')::uuid;
  if wo is null or (select responsible_team_id from public.work_orders where id=wo)<>team_a
  then raise exception 'Scoped Supervisor creation did not use the existing owner'; end if;

  -- The shared CAS owner accepts a legacy run whose requirement revision is
  -- null, preserves exact replay identity, and rejects stale/changed actions.
  execute 'reset role';
  update public.work_order_runs set requirement_snapshot=
    jsonb_set(requirement_snapshot,'{revision}','null'::jsonb)
    where work_order_id=wo and id=(select current_run_id from public.work_orders where id=wo);
  execute 'set local role authenticated';
  select updated_at into before_edit from public.work_orders where id=wo;
  action:=gen_random_uuid();
  select j into result from public.office_supervisor_update_work_order_v4(
    action,wo,'T01-CAS','Legacy null revision address','TEST','Supervisor CAS edit',
    current_date,contractor_a,null,cfg,before_edit) j;
  select j into replay from public.office_supervisor_update_work_order_v4(
    action,wo,'T01-CAS','Legacy null revision address','TEST','Supervisor CAS edit',
    current_date,contractor_a,null,cfg,before_edit) j;
  if replay is distinct from result then raise exception 'Supervisor CAS replay changed result'; end if;
  denied:=false;
  begin
    perform public.office_supervisor_update_work_order_v4(
      action,wo,'T01-CAS','Changed replay','TEST','Supervisor CAS edit',
      current_date,contractor_a,null,cfg,before_edit);
  exception when serialization_failure then denied:=true; end;
  if not denied then raise exception 'Changed Supervisor CAS replay was accepted'; end if;
  select updated_at into after_edit from public.work_orders where id=wo;
  denied:=false;
  begin
    perform public.office_supervisor_update_work_order_v4(
      gen_random_uuid(),wo,'T01-CAS','Stale edit','TEST','Supervisor CAS edit',
      current_date,contractor_a,(select (requirement_snapshot->>'revision')::uuid
        from public.work_order_runs where id=(select current_run_id from public.work_orders where id=wo)),
      cfg,before_edit);
  exception when serialization_failure then denied:=true; end;
  if not denied then raise exception 'Stale Supervisor CAS edit was accepted'; end if;
  current_revision:=(select (requirement_snapshot->>'revision')::uuid
    from public.work_order_runs where id=(select current_run_id from public.work_orders where id=wo));

  -- Only an active Contractor in the responsible team is eligible for a new
  -- assignment; inactive or other-team identities fail closed.
  execute 'reset role';
  update private.account_work_access set active=false
    where organization_id=org and user_id=contractor_a;
  execute 'set local role authenticated';
  denied:=false;
  begin
    perform public.office_supervisor_update_work_order_v4(
      gen_random_uuid(),wo,'T01-CAS','Disabled contractor','TEST','Supervisor CAS edit',
      current_date,contractor_a,current_revision,null,after_edit);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Inactive Contractor remained eligible'; end if;
  denied:=false;
  begin
    perform public.office_supervisor_update_work_order_v4(
      gen_random_uuid(),wo,'T01-CAS','Other team contractor','TEST','Supervisor CAS edit',
      current_date,contractor_b,current_revision,null,after_edit);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Other-team Contractor remained eligible'; end if;

  -- A valid Admin identity may remain on a historical assignment, but Admin
  -- must not use the Supervisor CAS endpoint itself.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id,
    'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  denied:=false;
  begin
    perform public.office_supervisor_update_work_order_v4(
      gen_random_uuid(),wo,'T01-CAS','Admin endpoint attempt','TEST','Supervisor CAS edit',
      current_date,owner_id,current_revision,null,after_edit);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Admin reached Supervisor-only CAS endpoint'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisor,'session_id',supervisor,
    'role','authenticated','app_metadata',jsonb_build_object('role','SUPERVISOR','organization_id',org))::text,true);

  payload:=jsonb_set(payload,'{assignedUserId}',to_jsonb(contractor_b::text));
  draft:=public.admin_save_job_draft(null,payload,null,null,gen_random_uuid());
  revision:=(draft->'draft'->>'revision')::uuid; denied:=false;
  begin perform public.admin_create_work_order_from_draft(revision);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Supervisor created work for an out-of-scope team'; end if;
  execute 'reset role';
end;
$gate$;
rollback;
