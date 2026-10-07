-- Synthetic Phase 5 lifecycle/invitation proof only. No hosted Auth or live account changes.
begin;

create function pg_temp.phase5_claims(p_user uuid,p_role text,p_org uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user,
    'session_id',p_user,
    'app_metadata',jsonb_build_object('role',p_role,'organization_id',p_org)
  )::text,true);
$$;

do $gate$
declare
  org uuid:=gen_random_uuid();
  team_a uuid:=gen_random_uuid();
  team_b uuid:=gen_random_uuid();
  owner_id uuid:=gen_random_uuid();
  admin_a uuid:=gen_random_uuid();
  admin_b uuid:=gen_random_uuid();
  contractor_a uuid:=gen_random_uuid();
  contractor_b uuid:=gen_random_uuid();
  supervisor uuid:=gen_random_uuid();
  invited uuid:=gen_random_uuid();
  action_disable_contractor uuid:=gen_random_uuid();
  action_restore_contractor uuid:=gen_random_uuid();
  action_disable_admin uuid:=gen_random_uuid();
  action_restore_admin uuid:=gen_random_uuid();
  invite_id uuid;
  revision uuid;
  disabled_revision uuid;
  admin_disabled_revision uuid;
  recovery uuid;
  denied boolean;
  n integer;
  result record;
begin
  insert into public.organizations(id,name,contractor_seat_limit)
    values(org,'PHASE 5 LIFECYCLE TEST',2);
  insert into public.admin_teams(id,organization_id,name)
    values(team_a,org,'TEAM A'),(team_b,org,'TEAM B');
  insert into private.org_work_settings(organization_id,supervisor_work_ready)
    values(org,true);

  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    (owner_id,'owner-lifecycle@example.invalid',now(),jsonb_build_object('role','ADMIN','organization_id',org)),
    (admin_a,'admin-a-lifecycle@example.invalid',now(),jsonb_build_object('role','ADMIN','organization_id',org)),
    (admin_b,'admin-b-lifecycle@example.invalid',now(),jsonb_build_object('role','ADMIN','organization_id',org)),
    (contractor_a,'contractor-a-lifecycle@example.invalid',now(),jsonb_build_object('role','CONTRACTOR','organization_id',org)),
    (contractor_b,'contractor-b-lifecycle@example.invalid',now(),jsonb_build_object('role','CONTRACTOR','organization_id',org)),
    (supervisor,'supervisor-lifecycle@example.invalid',now(),jsonb_build_object('role','SUPERVISOR','organization_id',org));

  insert into auth.sessions(id,user_id) values
    (owner_id,owner_id),(admin_a,admin_a),(admin_b,admin_b),
    (contractor_a,contractor_a),(contractor_b,contractor_b),(supervisor,supervisor);

  insert into private.platform_owner_capabilities(user_id,active,environment,verified_at)
    values(owner_id,true,'TEST',now());

  insert into private.account_work_access(organization_id,user_id,work_role,active) values
    (org,admin_a,'ADMIN',true),
    (org,admin_b,'ADMIN',true),
    (org,contractor_a,'CONTRACTOR',true),
    (org,contractor_b,'CONTRACTOR',true),
    (org,supervisor,'SUPERVISOR',true);
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values
    (org,team_a,admin_a,true),
    (org,team_b,admin_b,true);
  insert into private.contractor_team_memberships(organization_id,user_id,team_id,active) values
    (org,contractor_a,team_a,true),
    (org,contractor_b,team_b,true);
  insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
    values(org,supervisor,2,true,owner_id,'Synthetic lifecycle gate');
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
    values(org,supervisor,team_a);

  -- Own-team Admin disablement creates one READY fixed recovery grant and immutable audit result.
  perform pg_temp.phase5_claims(admin_a,'ADMIN',org);
  select a.revision into revision
  from private.account_work_access a where a.user_id=contractor_a;
  execute 'set local role authenticated';
  select * into result from public.set_account_work_access(
    action_disable_contractor,contractor_a,revision,false,'Synthetic own-team pause','TEST'
  );
  execute 'reset role';
  disabled_revision:=result.revision;
  recovery:=result.recovery_grant_id;
  if result.active or recovery is distinct from action_disable_contractor then
    raise exception 'Contractor disable result mismatch';
  end if;
  if (select state from private.photo_recovery_grants where action_id=recovery)<>'READY'
     or (select source_role from private.photo_recovery_grants where action_id=recovery)<>'CONTRACTOR'
     or cardinality((select removed_team_ids from private.photo_recovery_grants where action_id=recovery))<>0 then
    raise exception 'Contractor recovery cutoff mismatch';
  end if;
  if (select active from private.account_work_access where user_id=contractor_a)
     or (select suspension_authority from private.account_work_access where user_id=contractor_a)<>'MANAGER' then
    raise exception 'Contractor work access was not paused by manager';
  end if;
  if private.is_assignable_contractor(contractor_a,org) then
    raise exception 'Paused Contractor remained assignable';
  end if;
  if (select count(*) from private.account_work_access_actions where action_id=action_disable_contractor)<>1 then
    raise exception 'Contractor disable audit missing';
  end if;

  -- Same action is an exact idempotent retry; changed payload under the same action is denied.
  execute 'set local role authenticated';
  select * into result from public.set_account_work_access(
    action_disable_contractor,contractor_a,revision,false,'Synthetic own-team pause','TEST'
  );
  execute 'reset role';
  if result.revision is distinct from disabled_revision
     or (select count(*) from private.account_work_access_actions where action_id=action_disable_contractor)<>1 then
    raise exception 'Disable retry changed the historical result';
  end if;
  denied:=false;
  begin
    execute 'set local role authenticated';
    perform * from public.set_account_work_access(
      action_disable_contractor,contractor_a,revision,false,'Changed reason','TEST'
    );
    execute 'reset role';
  exception when others then
    execute 'reset role';
    denied:=true;
  end;
  if not denied then raise exception 'Changed disable retry was accepted';end if;

  -- Contractor capacity is still the original organization seat owner.
  update public.organizations set contractor_seat_limit=1 where id=org;
  denied:=false;
  begin
    execute 'set local role authenticated';
    perform * from public.set_account_work_access(
      action_restore_contractor,contractor_a,disabled_revision,true,'Synthetic restore','TEST'
    );
    execute 'reset role';
  exception when others then
    execute 'reset role';
    denied:=true;
  end;
  if not denied then raise exception 'Contractor reactivation bypassed seat cap';end if;
  update public.organizations set contractor_seat_limit=2 where id=org;
  execute 'set local role authenticated';
  select * into result from public.set_account_work_access(
    action_restore_contractor,contractor_a,disabled_revision,true,'Synthetic restore','TEST'
  );
  execute 'reset role';
  if not result.active or not private.is_assignable_contractor(contractor_a,org) then
    raise exception 'Contractor reactivation failed after seat became available';
  end if;

  -- Another team Admin cannot pause the Contractor.
  perform pg_temp.phase5_claims(admin_b,'ADMIN',org);
  select a.revision into revision
  from private.account_work_access a where a.user_id=contractor_a;
  denied:=false;
  begin
    execute 'set local role authenticated';
    perform * from public.set_account_work_access(
      gen_random_uuid(),contractor_a,revision,false,'Wrong team attempt','TEST'
    );
    execute 'reset role';
  exception when others then
    execute 'reset role';
    denied:=true;
  end;
  if not denied then raise exception 'Foreign-team Admin changed Contractor access';end if;

  -- Product Owner pause of an Admin cannot be released by a lower manager.
  perform pg_temp.phase5_claims(owner_id,'ADMIN',org);
  select a.revision into revision from private.account_work_access a where a.user_id=admin_a;
  execute 'set local role authenticated';
  select * into result from public.set_account_work_access(
    action_disable_admin,admin_a,revision,false,'Owner pause for gate','TEST'
  );
  execute 'reset role';
  admin_disabled_revision:=result.revision;
  if (select suspension_authority from private.account_work_access where user_id=admin_a)<>'OWNER'
     or (select removed_team_ids from private.account_work_access_actions
         where action_id=action_disable_admin)<>array[team_a]::uuid[] then
    raise exception 'Owner Admin cutoff/audit mismatch';
  end if;

  perform pg_temp.phase5_claims(supervisor,'SUPERVISOR',org);
  denied:=false;
  begin
    execute 'set local role authenticated';
    perform * from public.set_account_work_access(
      gen_random_uuid(),admin_a,admin_disabled_revision,true,'Manager restore attempt','TEST'
    );
    execute 'reset role';
  exception when others then
    execute 'reset role';
    denied:=true;
  end;
  if not denied then raise exception 'Manager released Product Owner suspension';end if;

  -- Owner reactivation fails closed until an explicit office allowance exists,
  -- then enforces the configured capacity.
  perform pg_temp.phase5_claims(owner_id,'ADMIN',org);
  denied:=false;
  begin
    execute 'set local role authenticated';
    perform * from public.set_account_work_access(
      action_restore_admin,admin_a,admin_disabled_revision,true,'Owner restore','TEST'
    );
    execute 'reset role';
  exception when others then
    execute 'reset role';
    denied:=true;
  end;
  if not denied then raise exception 'Admin restore guessed an absent office allowance';end if;

  insert into private.org_office_allowances(organization_id,admin_limit,supervisor_limit)
    values(org,1,1);
  denied:=false;
  begin
    execute 'set local role authenticated';
    perform * from public.set_account_work_access(
      action_restore_admin,admin_a,admin_disabled_revision,true,'Owner restore','TEST'
    );
    execute 'reset role';
  exception when others then
    execute 'reset role';
    denied:=true;
  end;
  if not denied then raise exception 'Admin restore bypassed configured office capacity';end if;
  update private.org_office_allowances set admin_limit=2 where organization_id=org;
  execute 'set local role authenticated';
  select * into result from public.set_account_work_access(
    action_restore_admin,admin_a,admin_disabled_revision,true,'Owner restore','TEST'
  );
  execute 'reset role';
  if not result.active then raise exception 'Owner restore failed within office allowance';end if;

  -- The existing invitation owner now binds new reservations to the Admin's explicit team.
  update public.organizations set contractor_seat_limit=3 where id=org;
  perform pg_temp.phase5_claims(admin_a,'ADMIN',org);
  execute 'set local role authenticated';
  select invitation_id into invite_id
  from public.admin_reserve_contractor_invitation('invite-lifecycle@example.invalid','Lifecycle Invite');
  execute 'reset role';
  if (select team_id from public.contractor_invitations where id=invite_id) is distinct from team_a then
    raise exception 'Legacy Contractor invite was not bound to its Admin team';
  end if;

  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
    values(invited,'invite-lifecycle@example.invalid',now(),
      jsonb_build_object('role','CONTRACTOR','organization_id',org),
      jsonb_build_object('team_invitation_id',invite_id));
  insert into auth.sessions(id,user_id) values(invited,invited);
  perform * from public.team_finalize_contractor_invitation(invite_id,'SENT',invited);

  -- A signed but stale Contractor claim cannot override a changed current Auth row.
  perform pg_temp.phase5_claims(invited,'CONTRACTOR',org);
  update auth.users
     set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','"ADMIN"')
   where id=invited;
  denied:=false;
  begin
    execute 'set local role authenticated';
    perform * from public.complete_contractor_invitation_activation();
    execute 'reset role';
  exception when others then
    execute 'reset role';
    denied:=true;
  end;
  if not denied
     or exists(select 1 from private.account_work_access a where a.user_id=invited)
     or (select status from public.contractor_invitations where id=invite_id)<>'SENT' then
    raise exception 'Stale Contractor activation claim created authority';
  end if;
  update auth.users
     set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','"CONTRACTOR"')
   where id=invited;

  perform pg_temp.phase5_claims(invited,'CONTRACTOR',org);
  execute 'set local role authenticated';
  perform * from public.complete_contractor_invitation_activation();
  execute 'reset role';
  if not exists(select 1 from private.account_work_access a
      where a.user_id=invited and a.organization_id=org and a.work_role='CONTRACTOR' and a.active)
     or (select team_id from private.contractor_team_memberships where user_id=invited) is distinct from team_a
     or not private.is_assignable_contractor(invited,org) then
    raise exception 'Contractor activation did not create exact work/team authority';
  end if;

  -- Old no-team UI cannot guess when an Admin has multiple invite-capable teams.
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active)
    values(org,team_b,admin_a,true);
  perform pg_temp.phase5_claims(admin_a,'ADMIN',org);
  denied:=false;
  begin
    execute 'set local role authenticated';
    perform * from public.admin_reserve_contractor_invitation(
      'ambiguous-lifecycle@example.invalid','Ambiguous Invite'
    );
    execute 'reset role';
  exception when others then
    execute 'reset role';
    denied:=true;
  end;
  if not denied then raise exception 'Legacy invite guessed among multiple Admin teams';end if;

  -- Direct table/engine bypass remains unavailable to an authenticated client.
  execute 'set local role authenticated';
  denied:=false;
  begin
    perform * from private.admin_reserve_contractor_invitation_legacy_engine(
      'bypass-lifecycle@example.invalid','Bypass'
    );
  exception when insufficient_privilege then
    denied:=true;
  end;
  execute 'reset role';
  if not denied then raise exception 'Legacy invitation engine remained client-callable';end if;
  if has_table_privilege('authenticated','private.account_work_access_actions','select')
     or has_table_privilege('authenticated','private.account_work_access_actions','update') then
    raise exception 'Lifecycle audit table exposed directly';
  end if;

  select count(*) into n
  from private.account_work_access_actions
  where organization_id=org;
  if n<>4 then
    raise exception 'Unexpected successful lifecycle action count: %',n;
  end if;

  raise notice 'Phase 5 lifecycle/invitation gate: authority, capacity, recovery and compatibility PASS';
end;
$gate$;

rollback;
