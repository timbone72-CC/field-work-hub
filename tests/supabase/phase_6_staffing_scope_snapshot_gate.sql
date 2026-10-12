-- Phase 6F scoped staffing metadata: disposable PostgreSQL fixture only.
begin;
do $staff_test$
declare
 org uuid:=gen_random_uuid();
 other_org uuid:=gen_random_uuid();
 team_a uuid:=gen_random_uuid();
 team_b uuid:=gen_random_uuid();
 team_c uuid:=gen_random_uuid();
 foreign_team uuid:=gen_random_uuid();
 actor_admin uuid:=gen_random_uuid();
 actor_owner uuid:=gen_random_uuid();
 actor_tier1 uuid:=gen_random_uuid();
 actor_tier2 uuid:=gen_random_uuid();
 actor_tier3 uuid:=gen_random_uuid();
 actor uuid;
 work_role text;
 tier smallint;
 quota_revision uuid;
 summary jsonb;
 cursor_id uuid;
 denied boolean;
begin
 insert into public.organizations(id,name)
 values(org,'STAFFING SCOPE TEST'),(other_org,'FOREIGN STAFFING TEST');
 insert into public.admin_teams(id,organization_id,name)
 values(team_a,org,'A'),(team_b,org,'B'),(team_c,org,'C'),
       (foreign_team,other_org,'F');
 foreach actor in array array[actor_admin,actor_owner,actor_tier1,actor_tier2,actor_tier3] loop
   work_role:=case when actor in (actor_tier1,actor_tier2,actor_tier3)
     then 'SUPERVISOR' else 'ADMIN' end;
   insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
   values(actor,actor::text||'@example.invalid',now(),
     jsonb_build_object('role',work_role,'organization_id',org));
   insert into auth.sessions(id,user_id) values(actor,actor);
   if actor<>actor_owner then
     insert into private.account_work_access(organization_id,user_id,work_role,active)
     values(org,actor,work_role,true);
   end if;
 end loop;
 insert into private.admin_team_memberships(organization_id,team_id,user_id,active)
 values(org,team_a,actor_admin,true);
 insert into private.org_work_settings(organization_id,supervisor_work_ready)
 values(org,true);
 for tier in 1..3 loop
   actor:=case tier when 1 then actor_tier1 when 2 then actor_tier2 else actor_tier3 end;
   insert into private.supervisor_grants(
     organization_id,user_id,tier,active,granted_by,reason)
   values(org,actor,tier,true,actor_owner,'Synthetic staffing');
 end loop;
 insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
 values(org,actor_tier1,team_a),(org,actor_tier2,team_a);
 insert into private.platform_owner_capabilities(user_id,active,environment,verified_at)
 values(actor_owner,true,'TEST',now());
 insert into private.org_office_allowances(organization_id,admin_limit,supervisor_limit)
 values(org,3,4);
 select revision into quota_revision from private.org_office_allowances
 where organization_id=org;
 insert into private.office_seat_reservations(
   action_id,organization_id,requested_role,actor_id,reason)
 values(gen_random_uuid(),org,'ADMIN',actor_owner,'Synthetic reserved seat');

 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',actor_admin,'session_id',actor_admin)::text,true);
 denied:=false;
 begin
   perform public.office_staffing_scope_snapshot(org,'TEST',null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Ordinary Admin saw staffing quota';end if;
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',actor_tier1,'session_id',actor_tier1)::text,true);
 denied:=false;
 begin
   perform public.office_staffing_scope_snapshot(org,'TEST',null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier 1 saw staffing quota';end if;
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',actor_tier2,'session_id',actor_tier2)::text,true);
 summary:=public.office_staffing_scope_snapshot(org,'TEST',null,25);
 if summary->>'allowance_revision'<>quota_revision::text
   or (summary->>'admin_active')::integer<>1
   or (summary->>'admin_reserved')::integer<>1
   or (summary->>'admin_available')::integer<>1
   or jsonb_array_length(summary->'teams')<>1
   or summary->'teams'->0->>'team_id'<>team_a::text
   or summary->>'next_after' is not null then
   raise exception 'Tier 2 quota or explicit team isolation failed: %',summary;end if;
 denied:=false;
 begin
   perform public.office_staffing_scope_snapshot(other_org,'TEST',null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier 2 read foreign organization quota';end if;
 denied:=false;
 begin perform public.office_staffing_scope_snapshot(org,null,null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'NULL environment bypassed staffing scope';end if;
 denied:=false;
 begin perform public.office_staffing_scope_snapshot(org,'TEST',null,51);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unbounded staffing page accepted';end if;
 -- Tier 2 losing a team grant must immediately lose the corresponding row.
 delete from private.supervisor_team_scopes
 where organization_id=org and user_id=actor_tier2 and team_id=team_a;
 summary:=public.office_staffing_scope_snapshot(org,'TEST',null,25);
 if jsonb_array_length(summary->'teams')<>0 then
   raise exception 'Revoked team remained visible in staffing scope';end if;

 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',actor_tier3,'session_id',actor_tier3)::text,true);
 summary:=public.office_staffing_scope_snapshot(org,'TEST',null,1);
 if jsonb_array_length(summary->'teams')<>1 or summary->>'next_after' is null then
   raise exception 'Tier 3 paginated organization scope failed';end if;
 cursor_id:=(summary->>'next_after')::uuid;
 summary:=public.office_staffing_scope_snapshot(org,'TEST',cursor_id,1);
 if jsonb_array_length(summary->'teams')<>1 or
   (summary->'teams'->0->>'team_id')::uuid<=cursor_id then
   raise exception 'Tier 3 cursor did not advance';end if;
 perform set_config('request.jwt.claims',
   jsonb_build_object('sub',actor_owner,'session_id',actor_owner)::text,true);
 summary:=public.office_staffing_scope_snapshot(org,'TEST',null,25);
 if jsonb_array_length(summary->'teams')<>3
   or (summary->>'admin_available')::integer<>1 then
   raise exception 'Owner metadata scope or cap mismatch';end if;
 if private.has_team_capability(org,team_b,'WORK') then
   raise exception 'Owner metadata endpoint granted customer work';end if;
 denied:=false;
 begin perform public.office_staffing_scope_snapshot(org,'PRODUCTION',null,25);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'TEST owner crossed environment';end if;
 execute 'set local role authenticated';
 denied:=false;
 begin select count(*)>0 into denied from private.org_office_allowances;
 exception when insufficient_privilege then denied:=true;end;
 execute 'reset role';
 if not denied then raise exception 'Unexpected private table permission test';end if;
 raise notice 'Phase 6F staffing scope and quota projection PASS';
end;
$staff_test$;
rollback;
