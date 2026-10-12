-- Synthetic authority proof only. No real users, photos, grants or live rollout.
begin;
do $gate$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
 team_a uuid:=gen_random_uuid(); team_b uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid();
 admin_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); contractor uuid:=gen_random_uuid();
 supervisors uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 actors uuid[]; actor uuid; sid uuid; wo uuid; empty_wo uuid;
 action text; expected boolean; result boolean; denied boolean; tier integer; n integer; capacity jsonb;
 enroll_user uuid:=gen_random_uuid(); enroll_action uuid:=gen_random_uuid(); enroll_res uuid; enroll_revision uuid; enroll_access_rev uuid;
 enroll_user2 uuid:=gen_random_uuid(); combined_action uuid:=gen_random_uuid(); combined_rev uuid;
 roster_worker uuid:=gen_random_uuid(); roster_action uuid:=gen_random_uuid(); roster_rev uuid; roster_result jsonb; busy_wo uuid;
 unmanaged_team uuid:=gen_random_uuid();
 handoff_wo uuid; handoff_action uuid:=gen_random_uuid(); handoff_review jsonb;
 handoff_fp text; handoff_receipt jsonb;
 grant_state_action uuid:=gen_random_uuid(); grant_state_revision uuid;
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

 -- Phase 6F owner-only existing Supervisor tier update, with scoped denial.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin
   perform public.owner_change_supervisor_tier(org,supervisors[1],
     (select revision from private.supervisor_grants where organization_id=org and user_id=supervisors[1]),
     3::smallint,'Unauthorized admin promotion','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Admin could change Supervisor tier';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[3],'session_id',supervisors[3])::text,true);
 denied:=false;
 begin
   perform public.owner_change_supervisor_tier(org,supervisors[1],
     (select revision from private.supervisor_grants where organization_id=org and user_id=supervisors[1]),
     3::smallint,'Unauthorized supervisor promotion','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Supervisor could change peer tier';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 denied:=false;
 begin
   perform public.owner_change_supervisor_tier(other_org,supervisors[1],gen_random_uuid(),
     3::smallint,'Cross organization promotion','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Owner could create a grant in another organization';end if;
 -- Promote within the same organization; only this grant tier changes.
 select revision into sid from private.supervisor_grants where organization_id=org and user_id=supervisors[1];
 actor:=public.owner_change_supervisor_tier(org,supervisors[1],sid,2::smallint,'Reviewed owner tier change','TEST');
 if actor=sid or (select sg.tier from private.supervisor_grants sg
                   where sg.organization_id=org and sg.user_id=supervisors[1])<>2 then
   raise exception 'Owner tier change did not commit expected revision';
 end if;
 denied:=false;
 begin
   perform public.owner_change_supervisor_tier(org,supervisors[1],sid,
     3::smallint,'Stale update','TEST');
 exception when serialization_failure then denied:=true;
 end;
 if not denied then raise exception 'Stale tier revision accepted';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[1],'session_id',supervisors[1])::text,true);
 if private.has_team_capability(org,team_b,'WORK') or
    private.has_team_capability(other_org,other_team,'WORK') then
   raise exception 'Tier change silently widened team or tenant scope';
 end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);

 -- Phase 6F exact team scope: only owner may add, no implicit other-org access.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin
   perform public.owner_set_supervisor_team_scope(org,supervisors[1],team_b,true,
     (select sg.revision from private.supervisor_grants sg where sg.organization_id=org and sg.user_id=supervisors[1]),
     'Unauthorized scope change','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Admin added Supervisor team scope';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[2],'session_id',supervisors[2])::text,true);
 denied:=false;
 begin
   perform public.owner_set_supervisor_team_scope(org,supervisors[1],team_b,true,
     (select sg.revision from private.supervisor_grants sg where sg.organization_id=org and sg.user_id=supervisors[1]),
     'Supervisor attempted scope change','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Supervisor granted peer team scope';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 select sg.revision into sid from private.supervisor_grants sg
   where sg.organization_id=org and sg.user_id=supervisors[1];
 denied:=false;
 begin
   perform public.owner_set_supervisor_team_scope(org,supervisors[1],other_team,true,sid,'Foreign team','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Cross-organization scope created';end if;
 actor:=public.owner_set_supervisor_team_scope(org,supervisors[1],team_b,true,sid,'Reviewed same-org team scope','TEST');
 if actor=sid then raise exception 'Scope revision failed to advance';end if;
 denied:=false;
 begin
   perform public.owner_set_supervisor_team_scope(org,supervisors[1],team_b,false,sid,'Stale removal','TEST');
 exception when serialization_failure then denied:=true;
 end;
 if not denied then raise exception 'Stale scope removal accepted';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[1],'session_id',supervisors[1])::text,true);
 if not private.has_team_capability(org,team_b,'WORK') or private.has_team_capability(other_org,other_team,'WORK') then
   raise exception 'Scope expansion did not honor exact team boundary';
 end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 actor:=public.owner_set_supervisor_team_scope(org,supervisors[1],team_b,false,actor,'Reviewed team scope removal','TEST');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[1],'session_id',supervisors[1])::text,true);
 if private.has_team_capability(org,team_b,'WORK') then raise exception 'Removed team scope remained accessible';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);

 -- Scoped removal must produce a committed recovery header before losing visibility.
 if not exists(select 1 from private.photo_recovery_grants g where g.organization_id=org and g.user_id=supervisors[1] and g.state='READY' and g.removed_team_ids=array[team_b]) then raise exception 'Removed team lacked historical photo recovery cutoff';end if;

 -- A Tier 3 -> Tier 2 downgrade freezes teams outside the explicit team set.
 select revision into sid from private.supervisor_grants where organization_id=org and user_id=supervisors[3];
 actor:=public.owner_change_supervisor_tier(org,supervisors[3],sid,2::smallint,'Scoped tier downgrade','TEST');
 if private.team_capability_for_user(supervisors[3],org,team_b,'WORK')
    or not private.team_capability_for_user(supervisors[3],org,team_a,'WORK') then
   raise exception 'Tier downgrade retained ungranted office work scope';end if;
 if not exists(select 1 from private.photo_recovery_grants g where g.organization_id=org
    and g.user_id=supervisors[3] and g.state='READY'
    and g.removed_team_ids=array[team_b]) then
   raise exception 'Tier downgrade did not freeze removed team photo scope';end if;
 actor:=public.owner_change_supervisor_tier(org,supervisors[3],actor,3::smallint,'Restore test tier','TEST');

 -- Phase 6F existing-organization allowance guard. Never creates seats/accounts.
 insert into private.org_office_allowances(organization_id,admin_limit,supervisor_limit)
 values(org,2,3);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin
   perform public.owner_set_office_allowances(org,
     (select oa.revision from private.org_office_allowances oa where oa.organization_id=org),
     4,4,'Admin attempted limits','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Admin altered office allowances';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[3],'session_id',supervisors[3])::text,true);
 denied:=false;
 begin
   perform public.owner_set_office_allowances(org,
     (select oa.revision from private.org_office_allowances oa where oa.organization_id=org),
     4,4,'Supervisor attempted limits','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Supervisor altered office allowances';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 select oa.revision into sid from private.org_office_allowances oa where oa.organization_id=org;
 denied:=false;
 begin
   perform public.owner_set_office_allowances(other_org,sid,4,4,'Unconfigured org','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Owner silently created other-org allowance';end if;
 denied:=false;
 begin
   perform public.owner_set_office_allowances(org,sid,0,1,'Under active usage','TEST');
 exception when check_violation then denied:=true;
 end;
 if not denied then raise exception 'Allowances reduced below active usage';end if;
 actor:=public.owner_set_office_allowances(org,sid,4,5,'Reviewed owner allowance','TEST');
 if actor=sid then raise exception 'Allowance revision not advanced';end if;
 denied:=false;
 begin
   perform public.owner_set_office_allowances(org,sid,6,7,'Stale update','TEST');
 exception when serialization_failure then denied:=true;
 end;
 if not denied then raise exception 'Stale allowance update allowed';end if;
 if (select oa.admin_limit from private.org_office_allowances oa where oa.organization_id=org)<>4
    or (select oa.supervisor_limit from private.org_office_allowances oa where oa.organization_id=org)<>5 then
   raise exception 'Owner allowance values incorrect';
 end if;

 -- The owner-only capacity projection is metadata, not office or photo access.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin perform public.owner_office_capacity_status(org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Admin read Product Owner allowance metadata';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 denied:=false;
 begin perform public.owner_office_capacity_status(org,'PRODUCTION');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Owner bypassed verified environment';end if;
 capacity:=public.owner_office_capacity_status(org,'TEST');
 if capacity->>'organization_id'<>org::text
   or (capacity->>'admin_limit')::integer<>4
   or (capacity->>'admin_active')::integer<>2
   or (capacity->>'admin_available')::integer<>2
   or (capacity->>'supervisor_active')::integer<>3
   or (capacity->>'supervisor_available')::integer<>2
   or capacity ? 'photo_id' or capacity ? 'work_order_id' then
   raise exception 'Owner capacity status is inaccurate or leaks job context: %',capacity;end if;

 -- Product Owner may inspect only bounded Supervisor entitlement metadata.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin perform public.owner_supervisor_grant_list(org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Admin read Owner Supervisor grants';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 select count(*) into n from public.owner_supervisor_grant_list(org,'TEST');
 if n<>3 then raise exception 'Owner grant list leaked or missed metadata';end if;
 if (select account_email from public.owner_supervisor_grant_list(org,'TEST') limit 1)
    is distinct from 'fixture@example.invalid' then
   raise exception 'Owner grant list omitted verified identity label';end if;
 select count(*) into n from public.owner_supervisor_grant_list(org,'TEST',null,1);
 if n<>1 then raise exception 'Owner grant list exceeded page limit';end if;
 denied:=false;
 begin perform public.owner_supervisor_grant_list(other_org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Owner listed unconfigured organization';end if;

 -- Owner team chooser sees only this configured organization's team metadata.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin perform public.owner_office_team_list(org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Admin inspected owner team choices';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 select count(*) into n from public.owner_office_team_list(org,'TEST');
 if n<>2 then raise exception 'Owner team list included foreign teams';end if;
 select count(*) into n from public.owner_office_team_list(org,'TEST',null,1);
 if n<>1 then raise exception 'Owner team choice page exceeded limit';end if;

 -- Exact team grants are owner-only; a team count is not authorization.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin perform public.owner_supervisor_team_scope_list(org,supervisors[2],'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Admin read Supervisor scope metadata';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 select count(*) into n from public.owner_supervisor_team_scope_list(org,supervisors[2],'TEST');
 if n<>1 then raise exception 'Owner Supervisor team grant count wrong';end if;
 denied:=false;
 begin perform public.owner_supervisor_team_scope_list(other_org,supervisors[2],'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Owner enumerated unconfigured foreign scope';end if;

 -- Owner-only personnel labels for reviewed continuity, not client job access.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin perform public.owner_office_people_list(org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Admin enumerated owner personnel';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 select count(*) into n from public.owner_office_people_list(org,'TEST');
 if n<>6 then raise exception 'Owner personnel scope missed or leaked accounts';end if;
 select count(*) into n from public.owner_office_people_list(org,'TEST',null,1);
 if n<>1 then raise exception 'Owner personnel paging failed';end if;
 denied:=false;
 begin perform public.owner_office_people_list(other_org,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Owner enumerated unconfigured foreign personnel';end if;

 -- Phase 6F owner-only office seat reservation, immutable action and per-role cap.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin
   perform public.owner_reserve_office_seat(gen_random_uuid(),org,'ADMIN','Admin denial','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Admin reserved an office seat';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[3],'session_id',supervisors[3])::text,true);
 denied:=false;
 begin
   perform public.owner_reserve_office_seat(gen_random_uuid(),org,'SUPERVISOR','Supervisor denial','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Supervisor reserved an office seat';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 denied:=false;
 begin
   perform public.owner_reserve_office_seat(gen_random_uuid(),other_org,'ADMIN','Unconfigured organization','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Unconfigured organization obtained a seat';end if;
 sid:=gen_random_uuid();
 if public.owner_reserve_office_seat(sid,org,'ADMIN','Reserved owner seat','TEST')<>sid
    or public.owner_reserve_office_seat(sid,org,'ADMIN','Reserved owner seat','TEST')<>sid then
   raise exception 'Exact seat reservation replay failed';
 end if;
 denied:=false;
 begin
   perform public.owner_reserve_office_seat(sid,org,'SUPERVISOR','Changed reservation role','TEST');
 exception when invalid_parameter_value then denied:=true;
 end;
 if not denied then raise exception 'Reservation action changed role';end if;
 if (select count(*) from private.office_seat_reservations where organization_id=org and state='RESERVED')<>1 then
   raise exception 'Idempotent replay consumed extra office seat';
 end if;

 -- Two active ADMIN roles (including the synthetic Product Owner) and one
 -- reserved ADMIN consume all three allowed seats; the next reservation fails.
 select oa.revision into actor from private.org_office_allowances oa where oa.organization_id=org;
 actor:=public.owner_set_office_allowances(org,actor,3,5,
   'Capacity boundary with pending reservation','TEST');
 denied:=false;
 begin
   perform public.owner_reserve_office_seat(gen_random_uuid(),org,'ADMIN',
     'Rejected over-capacity reservation','TEST');
 exception when check_violation then denied:=true;
 end;
 if not denied then raise exception 'Office reservation exceeded active plus reserved capacity';end if;
 if (select count(*) from private.office_seat_reservations
      where organization_id=org and state='RESERVED' and requested_role='ADMIN')<>1 then
   raise exception 'Rejected reservation altered reserved seats';end if;
 actor:=public.owner_set_office_allowances(org,actor,4,5,
   'Restore configured allowance for release gate','TEST');

 -- Reservation changes must appear in the same owner capacity projection.
 capacity:=public.owner_office_capacity_status(org,'TEST');
 if (capacity->>'admin_reserved')::integer<>1
    or (capacity->>'admin_available')::integer<>1 then
   raise exception 'Owner capacity omitted pending office reservation';end if;

 -- Phase 6F explicit seat cancellation preserves reservation identity and limits.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin
   perform public.owner_release_office_seat(sid,org,'Unauthorized release','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Admin released owner reservation';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 denied:=false;
 begin
   perform public.owner_release_office_seat(sid,other_org,'Wrong organization','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Cross-organization seat release allowed';end if;
 if public.owner_release_office_seat(sid,org,'Explicit release','TEST')<>'RELEASED'
    or public.owner_release_office_seat(sid,org,'Repeat release','TEST')<>'RELEASED' then
   raise exception 'Release was not idempotent';end if;
 if (select state from private.office_seat_reservations where action_id=sid)<>'RELEASED' then
   raise exception 'Seat remains reserved';end if;
 capacity:=public.owner_office_capacity_status(org,'TEST');
 if (capacity->>'admin_reserved')::integer<>0
    or (capacity->>'admin_available')::integer<>2 then
   raise exception 'Released reservation was still counted in owner capacity';end if;
 denied:=false;
 begin
   perform public.owner_reserve_office_seat(sid,org,'ADMIN','Reserved owner seat','TEST');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Released reservation resurrected';end if;
 -- Phase 6F verified existing Supervisor enrollment uses a real reserved seat.
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
 values(enroll_user,'new-supervisor@example.invalid',now(),jsonb_build_object('organization_id',org,'role','SUPERVISOR'));
 insert into auth.sessions(id,user_id) values(enroll_user,enroll_user);
 insert into private.account_work_access(organization_id,user_id,work_role,active)
 values(org,enroll_user,'SUPERVISOR',false);
 select revision into enroll_access_rev from private.account_work_access where user_id=enroll_user;
 enroll_res:=public.owner_reserve_office_seat(gen_random_uuid(),org,'SUPERVISOR','Reviewed verified identity','TEST');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin
   perform public.owner_enroll_existing_supervisor(enroll_action,org,enroll_user,enroll_res,
     enroll_access_rev,1::smallint,array[team_a],'Unauthorized enrollment','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Ordinary Admin enrolled Supervisor';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 denied:=false;
 begin
   perform public.owner_enroll_existing_supervisor(enroll_action,org,enroll_user,enroll_res,
     enroll_access_rev,1::smallint,array[other_team],'Cross-org team','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Supervisor enrollment accepted foreign team';end if;
 denied:=false;
 begin
   perform public.owner_enroll_existing_supervisor(enroll_action,org,enroll_user,enroll_res,
     gen_random_uuid(),1::smallint,array[team_a],'Reviewed verified identity','TEST');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Supervisor enrollment ignored access revision';end if;
 update auth.users set email_confirmed_at=null where id=enroll_user;
 denied:=false;
 begin
   perform public.owner_enroll_existing_supervisor(enroll_action,org,enroll_user,enroll_res,
     enroll_access_rev,1::smallint,array[team_a],'Reviewed verified identity','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unverified Auth identity enrolled';end if;
 update auth.users set email_confirmed_at=now() where id=enroll_user;
 enroll_revision:=public.owner_enroll_existing_supervisor(enroll_action,org,enroll_user,enroll_res,
     enroll_access_rev,1::smallint,array[team_a],'Reviewed verified identity','TEST');
 if enroll_revision<>public.owner_enroll_existing_supervisor(enroll_action,org,enroll_user,enroll_res,
     enroll_access_rev,1::smallint,array[team_a],'Reviewed verified identity','TEST')
   or (select state from private.office_seat_reservations where action_id=enroll_res)<>'CONSUMED'
   or (select count(*) from private.supervisor_enrollment_actions where action_id=enroll_action)<>1
   or (select count(*) from private.supervisor_team_scopes where user_id=enroll_user and team_id=team_a)<>1
   or (select active from private.account_work_access where user_id=enroll_user) then
   raise exception 'Enrollment created duplicate, lost seat or enabled work';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',enroll_user,'session_id',enroll_user)::text,true);
 if private.has_team_capability(org,team_a,'WORK') then
   raise exception 'Inactive newly enrolled Supervisor gained work';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 denied:=false;
 begin
   perform public.owner_enroll_existing_supervisor(enroll_action,org,enroll_user,enroll_res,
     enroll_access_rev,2::smallint,array[team_a],'Changed replay payload','TEST');
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Enrollment replay changed tier';end if;
 denied:=false;
 begin
   perform public.owner_enroll_existing_supervisor(gen_random_uuid(),org,enroll_user,enroll_res,
     enroll_access_rev,1::smallint,array[team_a],'Second enrollment','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Consumed reservation used twice';end if;

 -- A grant cannot be removed behind active work; reviewed disable/cutoff must run first.
 denied:=false;
 begin
   perform public.owner_set_supervisor_grant_state(gen_random_uuid(),org,supervisors[1],
     (select g.revision from private.supervisor_grants g where g.user_id=supervisors[1]),
     (select a.revision from private.account_work_access a where a.user_id=supervisors[1]),
     false,'Unreviewed active work revoke','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Owner revoked active Supervisor without recovery review';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
 denied:=false;
 begin
   perform public.owner_set_supervisor_grant_state(grant_state_action,org,enroll_user,
     enroll_revision,enroll_access_rev,false,'Unauthorized Admin revoke','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Admin changed Supervisor grant active state';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_id)::text,true);
 grant_state_revision:=public.owner_set_supervisor_grant_state(grant_state_action,org,enroll_user,
   enroll_revision,enroll_access_rev,false,'Reviewed grant removal','TEST');
 if grant_state_revision<>public.owner_set_supervisor_grant_state(grant_state_action,org,enroll_user,
   enroll_revision,enroll_access_rev,false,'Reviewed grant removal','TEST')
   or (select g.active from private.supervisor_grants g where g.user_id=enroll_user)
   or (select a.active from private.account_work_access a where a.user_id=enroll_user)
   or (select count(*) from private.supervisor_team_scopes s where s.user_id=enroll_user)<>1 then
   raise exception 'Grant removal lost idempotency, historical scope or work gate';end if;
 denied:=false;
 begin
   perform public.owner_set_supervisor_grant_state(gen_random_uuid(),org,enroll_user,
     enroll_revision,enroll_access_rev,true,'Stale grant revision','TEST');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale grant state revision accepted';end if;
 grant_state_revision:=public.owner_set_supervisor_grant_state(gen_random_uuid(),org,enroll_user,
   grant_state_revision,enroll_access_rev,true,'Reviewed grant restoration','TEST');
 if not (select g.active from private.supervisor_grants g where g.user_id=enroll_user)
   or (select a.active from private.account_work_access a where a.user_id=enroll_user) then
   raise exception 'Grant restoration improperly activated or failed to activate grant';end if;
 denied:=false;
 begin
   perform public.owner_set_supervisor_grant_state(grant_state_action,org,enroll_user,
     enroll_revision,enroll_access_rev,true,'Changed revoke replay','TEST');
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Grant state action replay changed its payload';end if;

 -- UI composition never leaves a reserved seat after a failed enrollment.
 denied:=false;
 begin
   perform public.owner_enroll_supervisor_with_seat(gen_random_uuid(),org,gen_random_uuid(),
     gen_random_uuid(),1::smallint,array[team_a],'Reject nonexistent identity','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied or exists(select 1 from private.office_seat_reservations
     where reason='Reject nonexistent identity') then
   raise exception 'Atomic enrollment created an orphaned seat';end if;
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
 values(enroll_user2,'another-supervisor@example.invalid',now(),
   jsonb_build_object('organization_id',org,'role','SUPERVISOR'));
 insert into private.account_work_access(organization_id,user_id,work_role,active)
 values(org,enroll_user2,'SUPERVISOR',false);
 select revision into enroll_access_rev from private.account_work_access where user_id=enroll_user2;
 combined_rev:=public.owner_enroll_supervisor_with_seat(combined_action,org,enroll_user2,
   enroll_access_rev,3::smallint,'{}'::uuid[],'Atomic owner enrollment','TEST');
 if combined_rev<>public.owner_enroll_supervisor_with_seat(combined_action,org,enroll_user2,
   enroll_access_rev,3::smallint,'{}'::uuid[],'Atomic owner enrollment','TEST')
   or (select state from private.office_seat_reservations where action_id=combined_action)<>'CONSUMED'
   or (select sg.tier from private.supervisor_grants sg where sg.user_id=enroll_user2)<>3
   or (select active from private.account_work_access where user_id=enroll_user2)
   or (select count(*) from private.supervisor_enrollment_actions where action_id=combined_action)<>1 then
   raise exception 'Atomic enrollment failed replay, quota or work gate';end if;
 denied:=false;
 begin
   perform public.owner_enroll_supervisor_with_seat(combined_action,org,enroll_user2,
     enroll_access_rev,1::smallint,array[team_a],'Changed atomic replay','TEST');
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Atomic action replay accepted changed tier';end if;

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

 -- Phase 6F: staff placement and idle transfers are separate from job handoff.
 -- Earlier tier-change tests promoted this actor; restore Tier 1 for denial proof.
 update private.supervisor_grants set tier=1 where organization_id=org and user_id=supervisors[1];
 insert into public.admin_teams(id,organization_id,name) values(unmanaged_team,org,'UNMANAGED TEST TEAM');
 insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
 values(org,supervisors[2],unmanaged_team);
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
 values(roster_worker,'roster-test@example.invalid',now(),
   jsonb_build_object('organization_id',org,'role','CONTRACTOR'));
 insert into auth.sessions(id,user_id) values(roster_worker,roster_worker);
 insert into private.account_work_access(organization_id,user_id,work_role,active)
 values(org,roster_worker,'CONTRACTOR',true);
 update public.organizations set contractor_seat_limit=8 where id=org;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[2],
   'session_id',supervisors[2])::text,true);
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(gen_random_uuid(),org,roster_worker,team_a,
     null,'Reject absent environment',null);
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'NULL environment bypassed roster authorization';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[1],
   'session_id',supervisors[1])::text,true);
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(roster_action,org,roster_worker,team_a,
     null,'Tier 1 cannot recruit','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier 1 placed unassigned Contractor';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[2],
   'session_id',supervisors[2])::text,true);
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(roster_action,org,roster_worker,team_b,
     null,'Tier 2 foreign supervised team','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier 2 placed Contractor outside team scope';end if;
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(roster_action,org,roster_worker,unmanaged_team,
     null,'Tier 2 cannot place under absent Admin','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier 2 placed Contractor into unmanaged team';end if;
 roster_result:=public.manage_idle_contractor_roster(roster_action,org,roster_worker,team_a,
   null,'Tier 2 reviewed unassigned placement','TEST');
 roster_rev:=(roster_result->>'revision')::uuid;
 if roster_result->>'action_kind'<>'PLACE'
   or (select m.team_id from private.contractor_team_memberships m where m.user_id=roster_worker)<>team_a
   or (select a.active from private.account_work_access a where a.user_id=roster_worker) is not true
   or not private.is_assignable_contractor(roster_worker,org) then
   raise exception 'Tier 2 placement changed work entitlement or failed';end if;
 if roster_result is distinct from public.manage_idle_contractor_roster(roster_action,org,
     roster_worker,team_a,null,'Tier 2 reviewed unassigned placement','TEST') then
   raise exception 'Authorized same-action placement replay changed receipt';end if;
 -- A still-valid Auth session does not retain scoped staffing receipt access
 -- when the Product Owner revokes the originating Supervisor's work grant.
 update private.supervisor_grants set active=false
   where organization_id=org and user_id=supervisors[2];
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(roster_action,org,roster_worker,team_a,
     null,'Tier 2 reviewed unassigned placement','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Revoked Tier 2 replay exposed roster history';end if;
 update private.supervisor_grants set active=true
   where organization_id=org and user_id=supervisors[2];
 if roster_result is distinct from public.manage_idle_contractor_roster(roster_action,org,
     roster_worker,team_a,null,'Tier 2 reviewed unassigned placement','TEST') then
   raise exception 'Restored Tier 2 could not reconcile original placement';end if;
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(gen_random_uuid(),org,roster_worker,team_b,
     roster_rev,'Tier 2 forbidden transfer','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier 2 transferred an assigned Contractor';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[3],
   'session_id',supervisors[3])::text,true);
 roster_action:=gen_random_uuid();
 roster_result:=public.manage_idle_contractor_roster(roster_action,org,roster_worker,team_b,
   roster_rev,'Tier 3 explicit idle transfer','TEST');
 if roster_result->>'action_kind'<>'TRANSFER' or
   (roster_result->>'old_team_id')::uuid<>team_a or
   (select m.team_id from private.contractor_team_memberships m where m.user_id=roster_worker)<>team_b
 then raise exception 'Tier 3 idle Contractor transfer incorrect';end if;
 if roster_result is distinct from public.manage_idle_contractor_roster(roster_action,org,
    roster_worker,team_b,roster_rev,'Tier 3 explicit idle transfer','TEST') then
   raise exception 'Roster transfer replay produced different result';end if;
 update private.supervisor_grants set tier=2
   where organization_id=org and user_id=supervisors[3];
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(roster_action,org,roster_worker,team_b,
     roster_rev,'Tier 3 explicit idle transfer','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Downgraded Tier 3 replay exposed transfer history';end if;
 update private.supervisor_grants set tier=3
   where organization_id=org and user_id=supervisors[3];
 if roster_result is distinct from public.manage_idle_contractor_roster(roster_action,org,
    roster_worker,team_b,roster_rev,'Tier 3 explicit idle transfer','TEST') then
   raise exception 'Restored Tier 3 could not reconcile original transfer';end if;
 denied:=false;
 begin
   update private.contractor_roster_actions set reason='Tampered audit'
     where action_id=roster_action;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Committed roster history was mutable';end if;
 denied:=false;
 begin
   delete from private.contractor_roster_actions where action_id=roster_action;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Committed roster action could be deleted';end if;
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(gen_random_uuid(),org,roster_worker,team_a,
     roster_rev,'Stale transfer','TEST');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale roster revision accepted';end if;
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(gen_random_uuid(),org,roster_worker,other_team,
     (roster_result->>'revision')::uuid,'Foreign team transfer','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Cross-org roster transfer accepted';end if;
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(roster_action,org,roster_worker,team_a,
     roster_rev,'Changed replay payload','TEST');
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Roster action UUID replay accepted changed inputs';end if;
 insert into public.work_orders(organization_id,responsible_team_id,wo_number,
   property_address,work_type,due_date,assigned_user_id)
 values(org,team_b,'ROSTER-'||gen_random_uuid(),'TEST','TEST',current_date,roster_worker)
 returning id into busy_wo;
 denied:=false;
 begin
   perform public.manage_idle_contractor_roster(gen_random_uuid(),org,roster_worker,team_a,
     (roster_result->>'revision')::uuid,'Busy roster move forbidden','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Busy Contractor transferred without job handoff';end if;
 if (select w.responsible_team_id from public.work_orders w where w.id=busy_wo)<>team_b then
   raise exception 'Roster operation changed existing work-order ownership';end if;

 -- Phase 6F: only genuinely undispatched/empty WOs may change teams
 -- through the reviewed, audited transaction. Started and photo-bearing
 -- assignments require the separate consent + exact-recovery workflow.
 insert into public.work_orders(
   organization_id,responsible_team_id,wo_number,property_address,work_type,due_date)
 values(org,team_a,'HANDOFF-'||gen_random_uuid(),'TEST EMPTY','TEST',current_date)
 returning id into handoff_wo;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,
   'session_id',admin_id)::text,true);
 denied:=false;
 begin perform public.preview_work_order_team_handoff(handoff_wo,team_b,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Admin previewed a Tier 3 handoff';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[2],
   'session_id',supervisors[2])::text,true);
 denied:=false;
 begin perform public.preview_work_order_team_handoff(handoff_wo,team_b,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tier 2 previewed a Tier 3 handoff';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,
   'session_id',owner_id)::text,true);
 denied:=false;
 begin perform public.preview_work_order_team_handoff(handoff_wo,team_b,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Owner platform grant exposed work handoff';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[3],
   'session_id',supervisors[3])::text,true);
 denied:=false;
 begin perform public.preview_work_order_team_handoff(handoff_wo,other_team,'TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Cross-organization handoff preview succeeded';end if;
 handoff_review:=public.preview_work_order_team_handoff(handoff_wo,team_b,'TEST');
 handoff_fp:=handoff_review->>'review_fingerprint';
 if (handoff_review->>'eligible')::boolean is not true or length(handoff_fp)<>32
 then raise exception 'Empty WO handoff not eligible';end if;
 -- Even a valid Tier 3 cannot move an assigned/active work order.
 if (public.preview_work_order_team_handoff(busy_wo,team_a,'TEST')->>'eligible')::boolean is true
 then raise exception 'Busy Contractor WO became handoff-eligible';end if;
 denied:=false;
 begin perform public.handoff_work_order_team(gen_random_uuid(),busy_wo,team_a,
   '00000000000000000000000000000000','Do not take active work','TEST');
 exception when serialization_failure or insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Active WO handoff accepted';end if;
 -- The original team-binding guard rejects unaudited direct updates.
 denied:=false;
 begin update public.work_orders set responsible_team_id=team_b
   where id=handoff_wo;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unaudited work-order handoff accepted';end if;
 update public.work_orders set instructions='Edited after preview' where id=handoff_wo;
 denied:=false;
 begin perform public.handoff_work_order_team(handoff_action,handoff_wo,team_b,
    handoff_fp,'Reviewed idle job handoff','TEST');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale handoff preview accepted';end if;
 handoff_review:=public.preview_work_order_team_handoff(handoff_wo,team_b,'TEST');
 handoff_fp:=handoff_review->>'review_fingerprint';
 handoff_receipt:=public.handoff_work_order_team(handoff_action,handoff_wo,team_b,
    handoff_fp,'Reviewed idle job handoff','TEST');
 if handoff_receipt->>'status'<>'HANDED_OFF'
   or (select responsible_team_id from public.work_orders where id=handoff_wo)<>team_b
 then raise exception 'Reviewed work-order handoff did not commit exact new team';end if;
 if handoff_receipt is distinct from public.handoff_work_order_team(
      handoff_action,handoff_wo,team_b,handoff_fp,'Reviewed idle job handoff','TEST') then
   raise exception 'Reviewed handoff replay changed its immutable result';end if;
 denied:=false;
 begin perform public.handoff_work_order_team(
   handoff_action,handoff_wo,team_a,handoff_fp,'Changed target replay','TEST');
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Handoff UUID reused with changed inputs';end if;
 update private.supervisor_grants set active=false
   where organization_id=org and user_id=supervisors[3];
 denied:=false;
 begin perform public.handoff_work_order_team(
   handoff_action,handoff_wo,team_b,handoff_fp,'Reviewed idle job handoff','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Revoked manager read historical handoff';end if;
 update private.supervisor_grants set active=true
   where organization_id=org and user_id=supervisors[3];
 if handoff_receipt is distinct from public.handoff_work_order_team(
     handoff_action,handoff_wo,team_b,handoff_fp,'Reviewed idle job handoff','TEST')
 then raise exception 'Restored manager cannot reconcile handoff action';end if;
 if (select count(*) from private.work_order_team_handoff_actions
   where work_order_id=handoff_wo)<>1 then
   raise exception 'Duplicate audited WO handoff';end if;
 denied:=false;
 begin update private.work_order_team_handoff_actions
   set reason='Tamper' where action_id=handoff_action;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Handoff audit mutation accepted';end if;
 execute 'set local role authenticated';
 denied:=false;
 begin update public.work_orders set responsible_team_id=team_a
   where id=handoff_wo;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Direct authenticated WO rebind accepted';end if;
 if has_table_privilege('authenticated','private.work_order_team_handoff_actions','select')
   or has_table_privilege('authenticated','private.work_order_team_handoff_actions','insert') then
   raise exception 'Private handoff audit accessible to clients';end if;
 execute 'reset role';

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
