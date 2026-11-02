-- Disposable reviewed access proof; no hosted accounts, photos or permissions.
begin;
create function pg_temp.claims(p_user uuid,p_role text,p_org uuid) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'session_id',p_user,
    'app_metadata',jsonb_build_object('role',p_role,'organization_id',p_org))::text,true);
$$;
create function pg_temp.expect(p_state text,p_sql text) returns void language plpgsql as $$
declare hit boolean:=false;
begin
  begin execute p_sql;exception when others then
    if sqlstate<>p_state then raise exception 'Expected %, got %: %',p_state,sqlstate,sqlerrm;end if;
    hit:=true;
  end;
  if not hit then raise exception 'Unexpected success: %',p_sql;end if;
end; $$;
do $gate$
declare
  org uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid();
  manager_id uuid:=gen_random_uuid(); other_admin uuid:=gen_random_uuid(); contractor uuid:=gen_random_uuid();
  team uuid:=gen_random_uuid(); foreign_team uuid:=gen_random_uuid(); extra uuid;
  wo uuid:=gen_random_uuid(); foreign_wo uuid:=gen_random_uuid(); action uuid:=gen_random_uuid();
  review jsonb; fresh jsonb; page jsonb; choices jsonb; result record;
  revision uuid; disabled_revision uuid; run_id uuid; i integer;
begin
  insert into public.organizations(id,name,contractor_seat_limit) values(org,'REVIEWED ACCESS TEST',2);
  insert into public.admin_teams(id,organization_id,name) values(team,org,'REVIEW TEAM'),(foreign_team,org,'FOREIGN');
  insert into private.org_work_settings(organization_id,supervisor_work_ready) values(org,true);
  insert into private.org_office_allowances(organization_id,admin_limit,supervisor_limit) values(org,2,1);
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    (owner_id,'review-owner@example.invalid',now(),'{}'),
    (admin_id,'review-admin@example.invalid',now(),jsonb_build_object('role','ADMIN','organization_id',org)),
    (other_admin,'review-other@example.invalid',now(),jsonb_build_object('role','ADMIN','organization_id',org)),
    (manager_id,'review-manager@example.invalid',now(),jsonb_build_object('role','SUPERVISOR','organization_id',org)),
    (contractor,'review-contractor@example.invalid',now(),jsonb_build_object('role','CONTRACTOR','organization_id',org));
  insert into auth.sessions(id,user_id) values(owner_id,owner_id),(admin_id,admin_id),(other_admin,other_admin),(manager_id,manager_id),(contractor,contractor);
  insert into private.platform_owner_capabilities(user_id,active,environment,verified_at) values(owner_id,true,'TEST',now());
  insert into private.account_work_access(organization_id,user_id,work_role,active) values
    (org,admin_id,'ADMIN',true),(org,other_admin,'ADMIN',true),(org,manager_id,'SUPERVISOR',true),(org,contractor,'CONTRACTOR',true);
  insert into private.admin_team_memberships(organization_id,user_id,team_id,active) values(org,admin_id,team,true),(org,other_admin,foreign_team,true);
  insert into private.contractor_team_memberships(organization_id,user_id,team_id,active) values(org,contractor,team,true);
  insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason) values(org,manager_id,2,true,owner_id,'TEST');
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id) values(org,manager_id,team);
  insert into public.work_orders(id,organization_id,responsible_team_id,assigned_user_id,wo_number,property_address,work_type,instructions,due_date) values
    (wo,org,team,contractor,'PRIVATE CLIENT WO','PRIVATE CUSTOMER ADDRESS','TEST','PRIVATE CUSTOMER NOTES',current_date),
    (foreign_wo,org,foreign_team,null,'FOREIGN CLIENT WO','FOREIGN CUSTOMER ADDRESS','TEST','FOREIGN NOTES',current_date);
  select current_run_id into run_id from public.work_orders where id=wo;
  select a.revision into revision from private.account_work_access a where a.user_id=admin_id;
  perform pg_temp.claims(owner_id,'PLATFORM',org);execute 'set local role authenticated';
  review:=public.review_account_work_access(admin_id,false,'TEST');
  if (review->>'affected_jobs')::integer<>1 or (review->>'assigned_jobs')::integer<>1
    or jsonb_array_length(review->'teams')<>1 or (review->'teams'->0->>'manager_count')::integer<>1
    or review->>'review_fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'Review scope/count/continuity mismatch';end if;
  if review::text like '%PRIVATE CUSTOMER%' or review::text like '%PRIVATE CLIENT%' or review ? 'jobs'
    or (select count(*) from public.work_orders)<>0 then raise exception 'Owner entitlement exposed customer work';end if;
  perform pg_temp.expect('42501',format('select * from public.set_account_work_access(%L,%L,%L,false,%L,%L)',action,admin_id,revision,'TEST','TEST'));
  perform pg_temp.expect('42501',format('select * from private.set_account_work_access(%L,%L,%L,false,%L,%L)',action,admin_id,revision,'TEST','TEST'));
  perform pg_temp.expect('42501',format('select * from private.set_account_work_access_engine(%L,%L,%L,false,%L,%L)',action,admin_id,revision,'TEST','TEST'));
  perform pg_temp.expect('22023',format('select public.review_account_work_access(%L,false,%L,1)',admin_id,'TEST'));
  perform pg_temp.expect('22023',format('select public.review_account_work_access(%L,false,%L,25,%L)',admin_id,'TEST',team));
  perform pg_temp.expect('42501',format('select public.review_account_work_access(%L,false,%L)',admin_id,'PRODUCTION'));
  perform pg_temp.expect('22023',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',action,admin_id,revision,'TEST','TEST',review->>'review_fingerprint','[]'));
  choices:=jsonb_build_array(jsonb_build_object('team_id',team,'decision','KEEP_MANAGER','manager_user_id',other_admin));
  perform pg_temp.expect('42501',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',action,admin_id,revision,'TEST','TEST',review->>'review_fingerprint',choices));
  choices:=jsonb_build_array(jsonb_build_object('team_id',team,'decision','NEEDS_MANAGER'));
  perform pg_temp.expect('22023',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',action,admin_id,revision,'TEST','TEST',review->>'review_fingerprint',choices));
  choices:=jsonb_build_array(jsonb_build_object('team_id',team,'decision','KEEP_MANAGER','manager_user_id',manager_id));
  execute 'reset role';

  -- Adding/removing scope without changing the access row still invalidates review.
  insert into private.admin_team_memberships(organization_id,user_id,team_id,active) values(org,admin_id,foreign_team,true);
  execute 'set local role authenticated';
  perform pg_temp.expect('40001',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',action,admin_id,revision,'TEST','TEST',review->>'review_fingerprint',choices));
  execute 'reset role';
  update private.admin_team_memberships set active=false where user_id=admin_id and team_id=foreign_team;
  execute 'set local role authenticated';review:=public.review_account_work_access(admin_id,false,'TEST');execute 'reset role';
  update public.work_orders set instructions='UPDATED PRIVATE NOTES' where id=wo;
  execute 'set local role authenticated';
  perform pg_temp.expect('40001',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',action,admin_id,revision,'TEST','TEST',review->>'review_fingerprint',choices));
  review:=public.review_account_work_access(admin_id,false,'TEST');execute 'reset role';
  update auth.users set banned_until=now()+interval '1 day' where id=manager_id;
  execute 'set local role authenticated';
  perform pg_temp.expect('40001',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',action,admin_id,revision,'TEST','TEST',review->>'review_fingerprint',choices));
  review:=public.review_account_work_access(admin_id,false,'TEST');
  perform pg_temp.expect('42501',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',action,admin_id,revision,'TEST','TEST',review->>'review_fingerprint',choices));
  execute 'reset role';update auth.users set banned_until=null where id=manager_id;

  -- Exact target-team capability: Tier 1 cannot manage accounts; Tier 2 cannot
  -- review a target with another team's membership. Current claims cannot expand it.
  perform pg_temp.claims(manager_id,'SUPERVISOR',org);execute 'set local role authenticated';
  fresh:=public.review_account_work_access(admin_id,false,'TEST');execute 'reset role';
  update private.supervisor_grants set tier=1 where user_id=manager_id;
  execute 'set local role authenticated';
  perform pg_temp.expect('42501',format('select public.review_account_work_access(%L,false,%L)',admin_id,'TEST'));
  execute 'reset role';update private.supervisor_grants set tier=2 where user_id=manager_id;
  insert into private.admin_team_memberships(organization_id,user_id,team_id,active) values(org,admin_id,foreign_team,true)
    on conflict(organization_id,team_id,user_id) do update set active=true;
  execute 'set local role authenticated';
  perform pg_temp.expect('42501',format('select public.review_account_work_access(%L,false,%L)',admin_id,'TEST'));
  execute 'reset role';update private.admin_team_memberships set active=false where user_id=admin_id and team_id=foreign_team;

  perform pg_temp.claims(owner_id,'PLATFORM',org);execute 'set local role authenticated';
  review:=public.review_account_work_access(admin_id,false,'TEST');
  select * into result from public.set_reviewed_account_work_access(action,admin_id,revision,false,'TEST','TEST',review->>'review_fingerprint',choices);
  disabled_revision:=result.revision;
  select * into result from public.set_reviewed_account_work_access(action,admin_id,revision,false,'TEST','TEST',review->>'review_fingerprint',choices);
  if result.revision is distinct from disabled_revision then raise exception 'Reviewed replay changed result';end if;
  perform pg_temp.expect('22023',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',action,admin_id,revision,'CHANGED','TEST',review->>'review_fingerprint',choices));
  perform pg_temp.expect('22023',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',action,admin_id,revision,'TEST','TEST',repeat('0',64),choices));
  execute 'reset role';
  if (select count(*) from private.account_work_access_reviews where action_id=action)<>1
    or (select affected_jobs from private.account_work_access_reviews where action_id=action)<>1
    or (select state from private.photo_recovery_grants where action_id=action)<>'READY'
    or (select active from private.account_work_access where user_id=admin_id)
    or not exists(select 1 from public.work_orders where id=wo and current_run_id=run_id and assigned_user_id=contractor and field_status='ASSIGNED') then
    raise exception 'Reviewed pause changed jobs, lost recovery or duplicated audit';end if;
  perform pg_temp.expect('42501',format('update private.account_work_access_reviews set continuity=%L where action_id=%L','[]',action));
  perform pg_temp.claims(manager_id,'SUPERVISOR',org);execute 'set local role authenticated';
  fresh:=public.review_account_work_access(admin_id,true,'TEST');
  perform pg_temp.expect('42501',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,true,%L,%L,%L,%L)',gen_random_uuid(),admin_id,disabled_revision,'RESTORE','TEST',fresh->>'review_fingerprint','[]'));
  execute 'reset role';perform pg_temp.claims(owner_id,'PLATFORM',org);execute 'set local role authenticated';
  fresh:=public.review_account_work_access(admin_id,true,'TEST');
  select * into result from public.set_reviewed_account_work_access(gen_random_uuid(),admin_id,disabled_revision,true,'RESTORE','TEST',fresh->>'review_fingerprint','[]');
  execute 'reset role';

  -- Real page bounds and whole-scope confirmation; a changed later page is stale.
  for i in 1..26 loop
    extra:=gen_random_uuid();insert into public.admin_teams(id,organization_id,name) values(extra,org,'PAGE TEAM');
    insert into private.admin_team_memberships(organization_id,user_id,team_id,active) values(org,admin_id,extra,true);
  end loop;
  execute 'set local role authenticated';review:=public.review_account_work_access(admin_id,false,'TEST');
  page:=public.review_account_work_access(admin_id,false,'TEST',25,(review->>'next_team')::uuid,review->>'review_fingerprint');
  if jsonb_array_length(review->'teams')<>25 or (review->>'total_teams')::integer<>27
    or jsonb_array_length(page->'teams')<>2 or page->>'next_team' is not null
    or page->>'review_fingerprint' is distinct from review->>'review_fingerprint' then raise exception 'Review page bounds/snapshot mismatch';end if;
  execute 'reset role';update public.admin_teams set name='CHANGED PAGE TEAM' where id=extra;
  execute 'set local role authenticated';
  perform pg_temp.expect('40001',format('select public.review_account_work_access(%L,false,%L,25,%L,%L)',admin_id,'TEST',review->>'next_team',review->>'review_fingerprint'));
  execute 'reset role';
  select a.revision into revision from private.account_work_access a where a.user_id=admin_id;
  execute 'set local role authenticated';
  fresh:=public.review_account_work_access(admin_id,false,'TEST');
  perform pg_temp.expect('22023',format('select * from public.set_reviewed_account_work_access(%L,%L,%L,false,%L,%L,%L,%L)',gen_random_uuid(),admin_id,revision,'TEST','TEST',fresh->>'review_fingerprint',choices));
  execute 'reset role';
  -- The reviewed path also retains original-owner Contractor recovery semantics.
  select a.revision into revision from private.account_work_access a where a.user_id=contractor;
  perform pg_temp.claims(admin_id,'ADMIN',org);execute 'set local role authenticated';
  fresh:=public.review_account_work_access(contractor,false,'TEST');
  if (fresh->>'affected_jobs')::integer<>1 or (fresh->>'continuity_required')::boolean then raise exception 'Contractor review broadened scope';end if;
  select * into result from public.set_reviewed_account_work_access(gen_random_uuid(),contractor,revision,false,'CONTRACTOR TEST','TEST',fresh->>'review_fingerprint','[]');
  execute 'reset role';
  if (select source_role from private.photo_recovery_grants where action_id=result.recovery_grant_id)<>'CONTRACTOR'
    or cardinality((select removed_team_ids from private.photo_recovery_grants where action_id=result.recovery_grant_id))<>0 then raise exception 'Reviewed Contractor grant changed owner scope';end if;
  perform pg_temp.claims(owner_id,'PLATFORM',org);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id)::text,true);
  execute 'set local role authenticated';
  perform pg_temp.expect('42501',format('select public.review_account_work_access(%L,false,%L)',admin_id,'TEST'));
  execute 'reset role';
  if has_table_privilege('authenticated','private.account_work_access_reviews','select')
    or has_function_privilege('authenticated','private.account_access_review_snapshot(uuid,boolean,text)','execute')
    or has_function_privilege('anon','public.review_account_work_access(uuid,boolean,text,integer,uuid,text)','execute')
    or has_function_privilege('authenticated','private.set_account_work_access_engine(uuid,uuid,uuid,boolean,text,text)','execute') then raise exception 'Reviewed access bypass exposed';end if;
  raise notice 'Reviewed access gate: scope/job/manager revisions, continuity, privacy, paging and immutable recovery/audit PASS';
end; $gate$;
rollback;
