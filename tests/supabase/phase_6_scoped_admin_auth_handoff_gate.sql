-- Phase 6F: disposable Auth handoff proof, not real Supabase email delivery.
begin;
do $handoff_gate$
declare
 org uuid:=gen_random_uuid();
 team uuid:=gen_random_uuid();
 foreign_team uuid:=gen_random_uuid();
 foreign_org uuid:=gen_random_uuid();
 creator uuid:=gen_random_uuid();
 owner uuid:=gen_random_uuid();
 fake_auth uuid:=gen_random_uuid();
 other_auth uuid:=gen_random_uuid();
 action uuid:=gen_random_uuid();
 second uuid:=gen_random_uuid();
 quota_rev uuid;
 response jsonb;
 denied boolean;
begin
 insert into public.organizations(id,name) values
   (org,'SCOPED ADMIN HANDOFF'),(foreign_org,'FOREIGN HANDOFF');
 insert into public.admin_teams(id,organization_id,name)
 values(team,org,'A'),(foreign_team,foreign_org,'OTHER');
 foreach owner in array array[owner,creator] loop
   insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
   values(owner,owner::text||'@example.invalid',now(),
     jsonb_build_object('role','SUPERVISOR','organization_id',org));
   insert into auth.sessions(id,user_id) values(owner,owner);
   insert into private.account_work_access(organization_id,user_id,work_role,active)
     values(org,owner,'SUPERVISOR',true);
 end loop;
 insert into private.org_work_settings(organization_id,supervisor_work_ready)
 values(org,true);
 insert into private.supervisor_grants(
   organization_id,user_id,tier,active,granted_by,reason)
 values(org,creator,2,true,creator,'Fixture');
 insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
 values(org,creator,team);
 insert into private.org_office_allowances(organization_id,admin_limit,supervisor_limit)
 values(org,1,2);
 select revision into quota_rev from private.org_office_allowances
 where organization_id=org;
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',creator,'session_id',creator)::text,true);
 response:=public.reserve_scoped_admin_invitation(
   action,org,team,'handoff@example.invalid','New Admin',
   quota_rev,'Reviewed scoped staff invitation','TEST');
 if response->>'status'<>'RESERVED' then raise exception 'No reservation';end if;
 response:=public.begin_scoped_admin_invitation_issue(action,org,'TEST');
 if response->>'instruction'<>'CREATE_ONCE' or response->>'status'<>'ISSUING' then
   raise exception 'First invocation did not fence Auth create';end if;
 response:=public.begin_scoped_admin_invitation_issue(action,org,'TEST');
 if response->>'instruction'<>'RECONCILE' or response->>'status'<>'ISSUING' then
   raise exception 'Second invocation could blindly re-create Auth identity';end if;
 response:=public.reserve_scoped_admin_invitation(
   action,org,team,'handoff@example.invalid','New Admin',
   quota_rev,'Reviewed scoped staff invitation','TEST');
 if response->>'status'<>'ISSUING' then
   raise exception 'Original in-flight reservation cannot be inspected safely';end if;
 denied:=false;
 begin
   perform public.release_scoped_admin_invitation(action,org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Cancelled uncertain Auth issuance without reconciliation';end if;
 denied:=false;
 begin
   perform public.begin_scoped_admin_invitation_issue(action,foreign_org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Cross-org Auth handoff allowed';end if;
 denied:=false;
 begin
   perform public.reserve_scoped_admin_invitation(
     second,org,team,'second@example.invalid','Other',
     quota_rev,'Must retain in-flight seat','TEST');
 exception when check_violation then denied:=true;end;
 if not denied then raise exception 'In-flight seat was not counted';end if;

 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 values(fake_auth,'handoff@example.invalid',
   jsonb_build_object('role','CONTRACTOR','organization_id',org),
   jsonb_build_object('scoped_admin_invitation_id',action));
 execute 'set local role authenticated';
 denied:=false;
 begin
   perform public.team_finalize_scoped_admin_issue(action,org,fake_auth,'BOUND');
 exception when insufficient_privilege then denied:=true;end;
 execute 'reset role';
 if not denied then raise exception 'Authenticated caller could bind Auth outcome';end if;
 denied:=false;
 begin
   perform public.team_finalize_scoped_admin_issue(action,org,fake_auth,'BOUND');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Wrong Auth role accepted by service';end if;
 update auth.users set raw_app_meta_data=jsonb_build_object(
   'role','ADMIN','organization_id',foreign_org) where id=fake_auth;
 denied:=false;
 begin
   perform public.team_finalize_scoped_admin_issue(action,org,fake_auth,'BOUND');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Wrong Auth tenant bound';end if;
 update auth.users set raw_app_meta_data=jsonb_build_object(
   'role','ADMIN','organization_id',org),
   raw_user_meta_data=jsonb_build_object('scoped_admin_invitation_id',gen_random_uuid())
 where id=fake_auth;
 denied:=false;
 begin
   perform public.team_finalize_scoped_admin_issue(action,org,fake_auth,'BOUND');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Wrong invitation marker bound';end if;
 update auth.users set raw_user_meta_data=jsonb_build_object(
   'scoped_admin_invitation_id',action) where id=fake_auth;
 response:=public.team_finalize_scoped_admin_issue(action,org,fake_auth,'BOUND');
 if response->>'status'<>'BOUND'
   or (select auth_user_id from private.scoped_admin_invitation_reservations
       where action_id=action)<>fake_auth then raise exception 'Exact binding missing';end if;
 if response is distinct from public.team_finalize_scoped_admin_issue(
   action,org,fake_auth,'BOUND') then raise exception 'Same-identity replay changed receipt';end if;
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 values(other_auth,'other@example.invalid',
   jsonb_build_object('role','ADMIN','organization_id',org),
   jsonb_build_object('scoped_admin_invitation_id',action));
 denied:=false;
 begin
   perform public.team_finalize_scoped_admin_issue(action,org,other_auth,'BOUND');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Bound identity could be replaced';end if;
 denied:=false;
 begin
   perform public.team_finalize_scoped_admin_issue(action,org,fake_auth,'PROBLEM');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'BOUND could be downgraded to PROBLEM';end if;
 if exists(select 1 from private.account_work_access where user_id=fake_auth)
   or (select state from private.office_seat_reservations
     where action_id=action)<>'RESERVED' then
   raise exception 'Auth handoff activated work or prematurely consumed seat';end if;
 denied:=false;
 begin
   perform public.release_scoped_admin_invitation(action,org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'BOUND invitation seat could be released';end if;
 -- The BOUND identity cannot be activated before verified email/session.
 denied:=false;
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',fake_auth,'session_id',fake_auth)::text,true);
 begin perform public.complete_scoped_admin_invitation_activation();
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unverified invited account activated';end if;
 insert into auth.sessions(id,user_id) values(fake_auth,fake_auth);
 update auth.users set email_confirmed_at=now() where id=fake_auth;
 response:=public.complete_scoped_admin_invitation_activation();
 if response->>'status'<>'ACCEPTED'
   or (select team_id from private.admin_team_memberships
        where user_id=fake_auth and active)<>team
   or (select work_role from private.account_work_access
        where user_id=fake_auth)<>'ADMIN'
   or (select state from private.office_seat_reservations
        where action_id=action)<>'CONSUMED'
   or (select state from private.scoped_admin_invitation_reservations
        where action_id=action)<>'CONSUMED' then
    raise exception 'Verified Admin activation failed atomic scope/seat commit';
 end if;
 response:=public.complete_scoped_admin_invitation_activation();
 if response->>'status'<>'ALREADY_ACTIVATED' or
    (select count(*) from private.admin_team_memberships
     where user_id=fake_auth)<>1 then
    raise exception 'Replayed activation duplicated team or account';
 end if;
 update private.account_work_access set active=false,disabled_at=now(),
   suspension_authority='MANAGER',suspension_reason='Synthetic disable'
 where user_id=fake_auth;
 response:=public.complete_scoped_admin_invitation_activation();
 if response->>'status'<>'WORK_DISABLED'
   or (select active from private.account_work_access
     where user_id=fake_auth) then
    raise exception 'Replayed activation restored revoked work access';
 end if;
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',creator,'session_id',creator)::text,true);
 denied:=false;
 begin perform public.release_scoped_admin_invitation(action,org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Consumed invitation could be cancelled';end if;
 if has_function_privilege('authenticated',
     'public.team_finalize_scoped_admin_issue(uuid,uuid,uuid,text)','execute')
   or has_table_privilege('service_role',
     'private.scoped_admin_invitation_reservations','update') then
   raise exception 'Direct binding bypass grants exposed';end if;
 raise notice 'Phase 6F scoped Admin Auth handoff PASS';
end;
$handoff_gate$;
rollback;
