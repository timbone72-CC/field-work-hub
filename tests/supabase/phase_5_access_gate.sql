-- Synthetic authority proof only. No real users, photos, grants or live rollout.
begin;
do $gate$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
 team_a uuid:=gen_random_uuid(); team_b uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid();
 admin_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); contractor uuid:=gen_random_uuid();
 supervisors uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 actors uuid[]; actor uuid; sid uuid; wo uuid; empty_wo uuid;
 action text; expected boolean; result boolean; denied boolean; tier integer; n integer;
 actions text[]:=array['WORK','INVITE_CONTRACTOR','MANAGE_CONTRACTOR','MANAGE_ADMIN',
   'PLACE_UNASSIGNED_CONTRACTOR','TRANSFER_CONTRACTOR','HANDOFF_TEAM','GRANT_SUPERVISOR','RAISE_ALLOWANCE','UNKNOWN'];
begin
 insert into public.organizations(id,name) values(org,'ACCESS TEST'),(other_org,'OTHER TEST');
 insert into public.admin_teams(id,organization_id,name) values
   (team_a,org,'A'),(team_b,org,'B'),(other_team,other_org,'OTHER');
 actors:=array[admin_id,owner_id,contractor]||supervisors;
 foreach actor in array actors loop
   insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
   values(actor,'fixture@example.invalid',now(),jsonb_build_object('organization_id',org,
     'role',case when actor=contractor then 'CONTRACTOR' when actor=any(supervisors) then 'SUPERVISOR' else 'ADMIN' end));
   insert into auth.sessions(id,user_id) values(actor,actor);
   insert into private.account_work_access(organization_id,user_id,work_role,active)
   select org,actor,raw_app_meta_data->>'role',true from auth.users where id=actor;
 end loop;
 insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(org,team_a,admin_id,true);
 insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values(org,team_a,contractor,true);
 insert into private.platform_owner_capabilities(user_id,active,environment,verified_at) values(owner_id,true,'TEST',now());
 for tier in 1..3 loop
   insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
   values(org,supervisors[tier],tier,true,owner_id,'Synthetic gate');
   insert into private.supervisor_team_scopes(organization_id,user_id,team_id) values(org,supervisors[tier],team_a);
 end loop;
 insert into public.work_orders(organization_id,responsible_team_id,wo_number,property_address,work_type,due_date)
 values(org,team_a,'TEST-'||gen_random_uuid(),'TEST','TEST',current_date) returning id into wo;
 insert into public.work_orders(organization_id,wo_number,property_address,work_type,due_date)
 values(org,'UNMAPPED-'||gen_random_uuid(),'TEST','TEST',current_date) returning id into empty_wo;

 -- A stale/forged JWT role never changes the current trusted account capability.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
   'app_metadata',jsonb_build_object('role','SUPERVISOR','organization_id',other_org))::text,true);
 foreach action in array actions loop
   expected:=action in ('WORK','INVITE_CONTRACTOR','MANAGE_CONTRACTOR');
   if private.has_team_capability(org,team_a,action) is distinct from expected then
     raise exception 'Admin action matrix mismatch: %',action;
   end if;
   if private.has_team_capability(org,team_b,action) or private.has_team_capability(other_org,other_team,action) then
     raise exception 'Admin crossed scope: %',action;
   end if;
 end loop;
 if not private.can_work_order(wo) or private.can_work_order(empty_wo) then raise exception 'Mapped vs unmapped WO boundary failed';end if;
 execute 'set local role authenticated';
 select count(*) into n from public.admin_teams;
 if n<>1 then raise exception 'Team RLS leaked labels: %',n;end if;
 denied:=false;
 begin insert into public.admin_teams(organization_id,name) values(org,'Bypass');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Direct team mutation allowed';end if;
 denied:=false;
 begin update private.account_work_access set active=false where user_id=admin_id;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Direct access mutation allowed';end if;
 execute 'reset role';

 -- Grants alone do not activate Supervisor features before the Phase 6 gate.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[3],'session_id',supervisors[3])::text,true);
 if private.has_team_capability(org,team_a,'WORK') then raise exception 'Supervisor activated without settings';end if;
 insert into private.org_work_settings(organization_id) values(org);
 if private.has_team_capability(org,team_a,'WORK') then raise exception 'Supervisor activated by default';end if;
 update private.org_work_settings set supervisor_work_ready=true where organization_id=org;
 for tier in 1..3 loop
   actor:=supervisors[tier];
   perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor)::text,true);
   foreach action in array actions loop
     expected:=case action when 'WORK' then true
       when 'MANAGE_ADMIN' then tier>=2 when 'MANAGE_CONTRACTOR' then tier>=2
       when 'PLACE_UNASSIGNED_CONTRACTOR' then tier>=2
       when 'INVITE_CONTRACTOR' then tier=3 when 'TRANSFER_CONTRACTOR' then tier=3
       when 'HANDOFF_TEAM' then tier=3 else false end;
     execute 'set local role authenticated';
     result:=private.has_team_capability(org,team_a,action);
     execute 'reset role';
     if result is distinct from expected then raise exception 'Tier % action % mismatch',tier,action;end if;
     if private.has_team_capability(org,team_b,action) is distinct from (expected and tier=3) then
       raise exception 'Tier % ungranted team action % mismatch',tier,action;end if;
     if private.has_team_capability(other_org,other_team,action) then raise exception 'Tier % crossed organization',tier;end if;
   end loop;
 end loop;

 -- Owner entitlement control alone cannot read/manage customer work.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 if not private.is_current_platform_owner('TEST') or private.is_current_platform_owner('PRODUCTION') then
   raise exception 'Owner environment boundary failed';end if;
 if private.can_work_order(wo) or private.has_team_capability(org,team_a,'WORK') then raise exception 'Owner bypassed work scope';end if;
 update auth.sessions set created_at=now()-interval '16 minutes' where id=owner_id;
 if private.is_current_platform_owner('TEST') then raise exception 'Owner recent-auth boundary failed';end if;

 -- Work disablement is independent of session validity and metadata/token refresh.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 update private.account_work_access set active=false,suspension_authority='OWNER',suspension_reason='TEST',disabled_at=now() where user_id=admin_id;
 if not private.current_identity_valid() or private.can_work_order(wo) then raise exception 'Disablement conflated identity/work';end if;
 execute 'set local role authenticated';
 select count(*) into n from public.admin_teams;
 execute 'reset role';
 if n<>0 then raise exception 'Disabled work account retained team labels';end if;
 -- No partial helper pretends to implement restore/recovery yet.
 update private.account_work_access set active=true,suspension_authority=null,suspension_reason=null,disabled_at=null where user_id=admin_id;
 update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','"CONTRACTOR"') where id=admin_id;
 if private.can_work_order(wo) then raise exception 'Stale JWT role survived role change';end if;
 update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','"ADMIN"') where id=admin_id;
 update auth.users set raw_user_meta_data='{"role":"SUPERVISOR","tier":3}' where id=admin_id;
 if private.has_team_capability(org,team_b,'WORK') then raise exception 'Editable metadata upgraded authority';end if;

 -- Exact current session, expiry, credential lock, verification and removal.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id)::text,true);
 if private.can_work_order(wo) then raise exception 'Missing session authorized';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id','invalid')::text,true);
 if private.can_work_order(wo) then raise exception 'Malformed session authorized';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',owner_id)::text,true);
 if private.can_work_order(wo) then raise exception 'Another user session authorized';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 update auth.sessions set not_after=now() where id=admin_id;
 if private.can_work_order(wo) then raise exception 'Expired session authorized';end if;
 update auth.sessions set not_after=null where id=admin_id;
 update auth.users set banned_until=now()+interval '1 day' where id=admin_id;
 if private.can_work_order(wo) then raise exception 'Security-locked identity authorized';end if;
 update auth.users set banned_until=null,email_confirmed_at=null where id=admin_id;
 if private.can_work_order(wo) then raise exception 'Unverified identity authorized';end if;
 update auth.users set email_confirmed_at=now() where id=admin_id;
 delete from auth.sessions where id=admin_id;
 if private.can_work_order(wo) then raise exception 'Revoked session authorized';end if;

 -- Roster movement cannot move existing WO/photo/run authority.
 update private.contractor_team_memberships set team_id=team_b where user_id=contractor;
 if (select responsible_team_id from public.work_orders where id=wo)<>team_a then raise exception 'Roster move rebound WO';end if;
 denied:=false;
 begin update public.work_orders set responsible_team_id=team_b where id=wo;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unaudited team rebind allowed';end if;
 denied:=false;
 begin insert into private.admin_team_memberships(organization_id,team_id,user_id) values(org,other_team,admin_id);exception when foreign_key_violation then denied:=true;end;
 if not denied then raise exception 'Cross-org membership accepted';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor)::text,true);
 if private.has_team_capability(org,team_a,'WORK') then raise exception 'Contractor gained office access';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[3],'session_id',supervisors[3])::text,true);
 update private.supervisor_grants set active=false where user_id=supervisors[3];
 if private.has_team_capability(org,team_b,'WORK') then raise exception 'Revoked Supervisor scope survived';end if;

 -- Private exposure stays denied; only the self capability predicate is callable.
 if has_function_privilege('anon','private.has_team_capability(uuid,uuid,text)','execute')
   or has_function_privilege('authenticated','private.is_current_platform_owner(text)','execute')
   or has_table_privilege('authenticated','private.supervisor_grants','select')
   or has_table_privilege('authenticated','private.platform_owner_capabilities','insert') then
   raise exception 'Foundation broad grants';end if;
 raise notice 'Phase 5 access foundation: all capability/session/isolation gates PASS';
end;
$gate$;
rollback;
