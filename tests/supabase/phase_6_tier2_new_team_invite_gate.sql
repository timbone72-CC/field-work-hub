-- Exact new-team + Admin reservation: real PostgreSQL transaction, synthetic
-- actors only. Rollback retains no Auth identities, scopes or teams.
begin;
do $new_team_gate$
declare
 org uuid:=gen_random_uuid();
 foreign_org uuid:=gen_random_uuid();
 existing_team uuid:=gen_random_uuid();
 foreign_team uuid:=gen_random_uuid();
 new_team uuid:=gen_random_uuid();
 tier3_team uuid:=gen_random_uuid();
 denied_team uuid:=gen_random_uuid();
 action_id uuid:=gen_random_uuid();
 second_action uuid:=gen_random_uuid();
 denied_action uuid:=gen_random_uuid();
 tier1 uuid:=gen_random_uuid();
 tier2 uuid:=gen_random_uuid();
 tier3 uuid:=gen_random_uuid();
 admin_user uuid:=gen_random_uuid();
 actor uuid;
 role_name text;
 quota_revision uuid;
 result jsonb;
 denied boolean;
 num integer;
begin
 insert into public.organizations(id,name)
 values(org,'TIER2 NEW TEAM GATE'),(foreign_org,'FOREIGN NEW TEAM GATE');
 insert into public.admin_teams(id,organization_id,name)
 values(existing_team,org,'Existing authorized team'),
   (foreign_team,foreign_org,'Unrelated team');
 foreach actor in array array[tier1,tier2,tier3,admin_user] loop
   role_name:=case when actor=admin_user then 'ADMIN' else 'SUPERVISOR' end;
   insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
   values(actor,actor::text||'@example.invalid',now(),
     jsonb_build_object('role',role_name,'organization_id',org));
   insert into auth.sessions(id,user_id) values(actor,actor);
   insert into private.account_work_access(organization_id,user_id,work_role,active)
     values(org,actor,role_name,true);
 end loop;
 insert into private.admin_team_memberships(organization_id,team_id,user_id,active)
 values(org,existing_team,admin_user,true);
 insert into private.org_work_settings(organization_id,supervisor_work_ready)
 values(org,true);
 insert into private.supervisor_grants(
   organization_id,user_id,tier,active,granted_by,reason)
 values(org,tier1,1,true,tier3,'fixture'),
   (org,tier2,2,true,tier3,'fixture'),
   (org,tier3,3,true,tier3,'fixture');
 insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
 values(org,tier1,existing_team),(org,tier2,existing_team);
 insert into private.org_office_allowances(organization_id,admin_limit,supervisor_limit)
 values(org,2,3);
 select revision into quota_revision from private.org_office_allowances
 where organization_id=org;

 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',admin_user,'session_id',admin_user)::text,true);
 denied:=false;
 begin
   perform public.create_admin_team_and_reserve_invitation(
     denied_action,org,denied_team,'Forbidden Admin team',
     'forbidden@example.invalid','Denied Staff',quota_revision,'Attempt','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Ordinary Admin created privileged team';end if;
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',tier1,'session_id',tier1)::text,true);
 denied:=false;
 begin
   perform public.create_admin_team_and_reserve_invitation(
     denied_action,org,denied_team,'Forbidden Tier1 team',
     'forbidden@example.invalid','Denied Staff',quota_revision,'Attempt','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier1 created privileged team';end if;
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',tier2,'session_id',tier2)::text,true);
 denied:=false;
 begin
   perform public.create_admin_team_and_reserve_invitation(
     denied_action,foreign_org,denied_team,'Foreign team',
     'forbidden@example.invalid','Denied Staff',quota_revision,'Foreign','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier2 crossed organization';end if;
 denied:=false;
 begin
   perform public.create_admin_team_and_reserve_invitation(
     denied_action,org,denied_team,'Null environment team',
     'forbidden@example.invalid','Denied Staff',quota_revision,'Missing',null);
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'NULL environment allowed team';end if;
 denied:=false;
 begin
   perform public.create_admin_team_and_reserve_invitation(
     denied_action,org,denied_team,'Old quota team',
     'forbidden@example.invalid','Denied Staff',gen_random_uuid(),'Stale','TEST');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale quota allowed team';end if;
 if exists(select 1 from public.admin_teams where id=denied_team) then
   raise exception 'Failed staff operation persisted ghost team';end if;

 result:=public.create_admin_team_and_reserve_invitation(
   action_id,org,new_team,'New managed team',
   'newstaff@example.invalid','New Staff',quota_revision,
   'Approved new staff and team','TEST');
 if result->>'status'<>'RESERVED' or result->>'new_team'<>'true'
   or result->>'team_id'<>new_team::text then
   raise exception 'Scoped new team reservation not returned: %',result;end if;
 if not private.has_team_capability(org,new_team,'MANAGE_ADMIN')
   or private.has_team_capability(org,foreign_team,'WORK')
   or exists(select 1 from private.supervisor_team_scopes s
     where s.organization_id=org and s.user_id=tier2
       and s.team_id<>all(array[existing_team,new_team])) then
   raise exception 'Tier2 newly created scope escaped exact team boundary';end if;
 if (select count(*) from private.supervisor_team_scopes
   where organization_id=org and user_id=tier2)<>2 then
   raise exception 'New team not explicitly linked exactly once';end if;
 if (select count(*) from private.office_seat_reservations
   where organization_id=org and state='RESERVED' and requested_role='ADMIN')<>1 then
   raise exception 'Atomic reservation omitted Admin seat';end if;
 if exists(select 1 from auth.users where email='newstaff@example.invalid')
   or exists(select 1 from private.account_work_access a
     where a.organization_id=org and a.work_role='ADMIN' and a.user_id<>admin_user) then
   raise exception 'Pre-Auth team created an Auth account or work authority';end if;

 if result is distinct from public.create_admin_team_and_reserve_invitation(
   action_id,org,new_team,'New managed team',
   'newstaff@example.invalid','New Staff',quota_revision,
   'Approved new staff and team','TEST') then
   raise exception 'Same-action retry changed new-team receipt';end if;
 denied:=false;
 begin
   perform public.create_admin_team_and_reserve_invitation(
     action_id,org,new_team,'Changed name',
     'newstaff@example.invalid','New Staff',quota_revision,
     'Approved new staff and team','TEST');
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Reused action mutated new-team name';end if;

 result:=public.begin_scoped_admin_invitation_issue(action_id,org,'TEST');
 if result->>'instruction'<>'CREATE_ONCE' then
   raise exception 'Original new-team Auth issuance not fenced';end if;
 result:=public.create_admin_team_and_reserve_invitation(
   action_id,org,new_team,'New managed team',
   'newstaff@example.invalid','New Staff',quota_revision,
   'Approved new staff and team','TEST');
 if result->>'status'<>'ISSUING' then
   raise exception 'In-flight new team retry triggered a second reservation';end if;
 denied:=false;
 begin
   perform public.create_admin_team_and_reserve_invitation(
     second_action,org,tier3_team,'Over capacity team',
     'another@example.invalid','Another Admin',quota_revision,'Over cap','TEST');
 exception when check_violation then denied:=true;end;
 if not denied or exists(select 1 from public.admin_teams where id=tier3_team) then
   raise exception 'Admin quota failure created an orphan team';end if;

 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',tier3,'session_id',tier3)::text,true);
 denied:=false;
 begin
   perform public.create_admin_team_and_reserve_invitation(
     action_id,org,new_team,'New managed team',
     'newstaff@example.invalid','New Staff',quota_revision,
     'Approved new staff and team','TEST');
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Different actor hijacked original action';end if;

 -- Grant revocation must prevent future new-team actions even with stale JWT.
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',tier2,'session_id',tier2)::text,true);
 update private.supervisor_grants set active=false where user_id=tier2;
 denied:=false;
 begin
   perform public.create_admin_team_and_reserve_invitation(
     second_action,org,tier3_team,'Revoked tier team',
     'another@example.invalid','Another Admin',quota_revision,'Revoked','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Revoked Tier2 created a team';end if;
 if has_table_privilege('authenticated','private.created_admin_team_invitation_actions','select')
   or has_table_privilege('authenticated','private.created_admin_team_invitation_actions','insert')
   or has_function_privilege('anon',
     'public.create_admin_team_and_reserve_invitation(uuid,uuid,uuid,text,text,text,uuid,text,text)','execute')
 then raise exception 'Private new-team ledger or entry exposed';end if;
 raise notice 'Tier2 atomic new-team + Admin seat gate PASS';
end;
$new_team_gate$;
rollback;
