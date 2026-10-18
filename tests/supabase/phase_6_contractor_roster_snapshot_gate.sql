-- Disposable gate: roster reads never grant cross-team or cross-org visibility.
begin;
do $roster_gate$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
 team_a uuid:=gen_random_uuid(); team_b uuid:=gen_random_uuid();
 tier1 uuid:=gen_random_uuid(); tier2 uuid:=gen_random_uuid();
 tier3 uuid:=gen_random_uuid(); admin_user uuid:=gen_random_uuid();
 placed_a uuid:=gen_random_uuid(); placed_b uuid:=gen_random_uuid();
 unplaced uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid();
 actor uuid; worker uuid; role_name text;
 output jsonb; denied boolean; cursor_id uuid; busy_wo uuid;
begin
 insert into public.organizations(id,name) values(org,'ROSTER SNAPSHOT'),(other_org,'ROSTER FOREIGN');
 insert into public.admin_teams(id,organization_id,name)
 values(team_a,org,'Allowed'),(team_b,org,'Other');
 foreach actor in array array[tier1,tier2,tier3,admin_user,placed_a,placed_b,unplaced] loop
   role_name:=case when actor in (tier1,tier2,tier3) then 'SUPERVISOR'
     when actor=admin_user then 'ADMIN' else 'CONTRACTOR' end;
   insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
   values(actor,actor::text||'@example.invalid',now(),
     jsonb_build_object('role',role_name,'organization_id',org));
   insert into auth.sessions(id,user_id) values(actor,actor);
   insert into private.account_work_access(organization_id,user_id,work_role,active)
   values(org,actor,role_name,true);
 end loop;
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
 values(other_user,other_user::text||'@example.invalid',now(),
   jsonb_build_object('role','CONTRACTOR','organization_id',other_org));
 insert into auth.sessions(id,user_id) values(other_user,other_user);
 insert into private.account_work_access(organization_id,user_id,work_role,active)
 values(other_org,other_user,'CONTRACTOR',true);
 insert into private.admin_team_memberships(organization_id,team_id,user_id,active)
 values(org,team_a,admin_user,true);
 insert into private.contractor_team_memberships(organization_id,user_id,team_id,active)
 values(org,placed_a,team_a,true),(org,placed_b,team_b,true);
 insert into private.org_work_settings(organization_id,supervisor_work_ready)
 values(org,true);
 insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
 values(org,tier1,1,true,admin_user,'Fixture'),
       (org,tier2,2,true,admin_user,'Fixture'),
       (org,tier3,3,true,admin_user,'Fixture');
 insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
 values(org,tier1,team_a),(org,tier2,team_a);

 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',admin_user,'session_id',admin_user)::text,true);
 denied:=false;
 begin perform public.office_contractor_roster_snapshot(org,'TEST',null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Admin read Supervisor roster';end if;
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',tier1,'session_id',tier1)::text,true);
 denied:=false;
 begin perform public.office_contractor_roster_snapshot(org,'TEST',null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier1 read Tier2 roster';end if;

 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',tier2,'session_id',tier2)::text,true);
 output:=public.office_contractor_roster_snapshot(org,'TEST',null,25);
 if jsonb_array_length(output->'contractors')<>2
   or not exists(select 1 from jsonb_array_elements(output->'contractors') r
      where r->>'user_id'=placed_a::text and r->>'team_id'=team_a::text)
   or not exists(select 1 from jsonb_array_elements(output->'contractors') r
      where r->>'user_id'=unplaced::text and r->>'team_id' is null)
   or exists(select 1 from jsonb_array_elements(output->'contractors') r
      where r->>'user_id' in (placed_b::text,other_user::text)) then
   raise exception 'Tier2 leaked other team/tenant or lost unplaced worker: %',output;end if;
 denied:=false;
 begin perform public.office_contractor_roster_snapshot(other_org,'TEST',null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier2 crossed tenant';end if;
 denied:=false;
 begin perform public.office_contractor_roster_snapshot(org,null,null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'NULL environment authorized roster';end if;
 denied:=false;
 begin perform public.office_contractor_roster_snapshot(org,'TEST',null,51);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Oversized roster page accepted';end if;

 delete from private.supervisor_team_scopes where user_id=tier2;
 denied:=false;
 begin perform public.office_contractor_roster_snapshot(org,'TEST',null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Revoked Tier2 grant retained unplaced visibility';end if;

 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',tier3,'session_id',tier3)::text,true);
 output:=public.office_contractor_roster_snapshot(org,'TEST',null,1);
 if jsonb_array_length(output->'contractors')<>1 or output->>'next_after' is null
   then raise exception 'Tier3 roster paging failed';end if;
 cursor_id:=(output->>'next_after')::uuid;
 output:=public.office_contractor_roster_snapshot(org,'TEST',cursor_id,25);
 if jsonb_array_length(output->'contractors')<>2
   or exists(select 1 from jsonb_array_elements(output->'contractors') r
     where (r->>'user_id')::uuid<=cursor_id)
   then raise exception 'Tier3 cursor or remaining contractor scope failed';end if;

 insert into public.work_orders(organization_id,responsible_team_id,wo_number,
   property_address,work_type,due_date,assigned_user_id)
 values(org,team_b,'ROSTER-'||gen_random_uuid(),'TEST','TEST',current_date,placed_b)
 returning id into busy_wo;
 output:=public.office_contractor_roster_snapshot(org,'TEST',null,50);
 if not exists(select 1 from jsonb_array_elements(output->'contractors') r
   where r->>'user_id'=placed_b::text and r->>'idle'='false')
   then raise exception 'Busy Contractor was labeled idle';end if;
 update private.account_work_access set active=false,disabled_at=now(),
   suspension_authority='MANAGER',suspension_reason='Fixture' where user_id=placed_a;
 output:=public.office_contractor_roster_snapshot(org,'TEST',null,50);
 if exists(select 1 from jsonb_array_elements(output->'contractors') r
   where r->>'user_id'=placed_a::text) then raise exception 'Disabled Contractor leaked';end if;
 execute 'set local role authenticated';
 denied:=false;
 begin perform count(*) from private.contractor_team_memberships;
 exception when insufficient_privilege then denied:=true;end;
 execute 'reset role';
 if not denied then raise exception 'Direct private roster table readable';end if;
 raise notice 'Phase 6F tier-scoped roster visibility and idle fact PASS';
end;
$roster_gate$;
rollback;
