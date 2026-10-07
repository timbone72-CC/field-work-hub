-- Rollback-only scoped invitation continuation; never hosted Auth data.
begin;
create function pg_temp.expect(p_state text,p_sql text) returns void language plpgsql as $$
declare hit boolean:=false;
begin
 begin execute p_sql;exception when others then
  if sqlstate<>p_state then raise exception 'Expected %, got %: %',p_state,sqlstate,sqlerrm;end if;hit:=true;
 end;
 if not hit then raise exception 'Unexpected success: %',p_sql;end if;
end; $$;
create function pg_temp.claims(p_user uuid,p_role text,p_org uuid) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'session_id',p_user,
  'app_metadata',jsonb_build_object('role',p_role,'organization_id',p_org))::text,true)
$$;
do $gate$
declare org uuid:='00000000-0000-0000-0000-000000000001';
 team uuid:='00000000-0000-0000-0000-000000000020'; admin_id uuid:='00000000-0000-0000-0000-000000000010';
 a uuid:='00000000-0000-0000-0000-000000000011'; owner_id uuid:=gen_random_uuid();
 extra_team uuid:=gen_random_uuid(); foreign_team uuid:=gen_random_uuid(); other_admin uuid:=gen_random_uuid();
 invited uuid:=gen_random_uuid(); first_invite uuid; other_invite uuid; cancel_invite uuid; foreign_invite uuid;
 rev uuid; result record; n integer;
begin
 insert into public.admin_teams(id,organization_id,name) values(extra_team,org,'EXTRA'),(foreign_team,org,'FOREIGN');
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
  (owner_id,'owner-invitation@example.invalid',now(),'{}'),
  (other_admin,'other-invitation@example.invalid',now(),jsonb_build_object('role','ADMIN','organization_id',org));
 insert into auth.sessions(id,user_id) values(owner_id,owner_id),(other_admin,other_admin);
 insert into private.platform_owner_capabilities(user_id,active,environment,verified_at) values(owner_id,true,'TEST',now());
 insert into private.account_work_access(organization_id,user_id,work_role,active) values(org,other_admin,'ADMIN',true);
 insert into private.admin_team_memberships(organization_id,user_id,team_id,active) values(org,admin_id,extra_team,true),(org,other_admin,foreign_team,true);
 update public.organizations set contractor_seat_limit=10 where id=org;
 perform pg_temp.claims(other_admin,'ADMIN',org);execute 'set local role authenticated';
 select invitation_id into foreign_invite from public.admin_reserve_contractor_invitation('foreign-invitation@example.invalid','TEST');
 perform pg_temp.claims(admin_id,'ADMIN',org);
 perform pg_temp.expect('42501','select * from public.admin_reserve_contractor_invitation(''ambiguous-invitation@example.invalid'',''TEST'')');
 perform pg_temp.expect('42501',format('select * from public.admin_reserve_contractor_invitation_for_team(%L,%L,%L)',foreign_team,'denied-invitation@example.invalid','TEST'));
 select invitation_id into first_invite from public.admin_reserve_contractor_invitation_for_team(team,'first-invitation@example.invalid','TEST');
 select invitation_id into other_invite from public.admin_reserve_contractor_invitation_for_team(extra_team,'second-invitation@example.invalid','TEST');
 select invitation_id into cancel_invite from public.admin_reserve_contractor_invitation_for_team(extra_team,'cancel-invitation@example.invalid','TEST');
 if (select count(*) from public.admin_list_pending_contractor_invitations())<>3 then raise exception 'Scoped pending list lost multi-team rows or exposed foreign team';end if;
 perform pg_temp.expect('42501',format('select * from public.admin_begin_contractor_invitation_cancel(%L)',foreign_invite));
 perform public.admin_begin_contractor_invitation_cancel(cancel_invite);
 execute 'reset role';
 perform public.team_finalize_contractor_invitation_cancel(cancel_invite,'CANCELLED');
 if not exists(select 1 from public.contractor_invitations where id=cancel_invite and status='CANCELLED' and team_id=extra_team) then raise exception 'Existing cancellation owner lost fixed team/seat state';end if;
 perform pg_temp.expect('42501',format('update public.contractor_invitations set team_id=%L where id=%L',extra_team,first_invite));
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
  values(invited,'second-invitation@example.invalid',now(),jsonb_build_object('role','CONTRACTOR','organization_id',org),jsonb_build_object('team_invitation_id',other_invite));
 insert into auth.sessions(id,user_id) values(invited,invited);
 perform public.team_finalize_contractor_invitation(other_invite,'SENT',invited);
 select revision into rev from private.account_work_access where user_id=admin_id;
 perform pg_temp.claims(owner_id,'PLATFORM',org);execute 'set local role authenticated';
 perform public.set_account_work_access(gen_random_uuid(),admin_id,rev,false,'TEST RECRUITER PAUSE','TEST');
 perform pg_temp.claims(invited,'CONTRACTOR',org);
 perform pg_temp.expect('42501','select * from public.complete_contractor_invitation_activation()');
 execute 'reset role';
 if exists(select 1 from private.account_work_access where user_id=invited)
   or not exists(select 1 from public.contractor_invitations where id=other_invite and status='SENT') then raise exception 'Paused recruiter created work access or released pending seat';end if;
 insert into private.org_office_allowances(organization_id,admin_limit,supervisor_limit) values(org,2,0);
 select revision into rev from private.account_work_access where user_id=admin_id;
 perform pg_temp.claims(owner_id,'PLATFORM',org);execute 'set local role authenticated';
 perform public.set_account_work_access(gen_random_uuid(),admin_id,rev,true,'TEST RECRUITER RESTORE','TEST');
 perform pg_temp.claims(invited,'CONTRACTOR',org);
 perform public.complete_contractor_invitation_activation();
 execute 'reset role';
 if not exists(select 1 from private.contractor_team_memberships where user_id=invited and team_id=extra_team and active)
  or not exists(select 1 from private.account_work_access where user_id=invited and active) then raise exception 'First activation changed fixed team or omitted work entitlement';end if;
 select revision into rev from private.account_work_access where user_id=invited;
 perform pg_temp.claims(admin_id,'ADMIN',org);execute 'set local role authenticated';
 perform public.set_account_work_access(gen_random_uuid(),invited,rev,false,'TEST RECOVERY ONLY','TEST');
 perform pg_temp.claims(invited,'CONTRACTOR',org);
 perform pg_temp.expect('42501','select * from public.complete_contractor_invitation_activation()');
 execute 'reset role';
 select revision into rev from private.account_work_access where user_id=a;
 perform pg_temp.claims(admin_id,'ADMIN',org);execute 'set local role authenticated';
 perform pg_temp.expect('22023',format('select * from public.set_account_work_access(%L,%L,%L,false,%L,null)',gen_random_uuid(),a,rev,'NULL ENVIRONMENT'));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 perform pg_temp.expect('42501',format('select * from public.admin_reserve_contractor_invitation_for_team(%L,%L,%L)',team,'no-session@example.invalid','TEST'));
 execute 'reset role';
 if has_function_privilege('authenticated','private.lock_account_lifecycle()','execute')
  or has_function_privilege('anon','public.admin_reserve_contractor_invitation_for_team(uuid,text,text)','execute') then raise exception 'Internal lock or public recruitment exposed incorrectly';end if;
end; $gate$;
rollback;
