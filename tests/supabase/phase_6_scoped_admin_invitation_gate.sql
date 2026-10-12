-- Phase 6F source-only Admin-seat reservation gate; all rows roll back.
-- A reservation is NOT an Auth user, issued setup link, or active work role.
begin;
do $admin_invite_gate$
declare
  org uuid:=gen_random_uuid();
  foreign_org uuid:=gen_random_uuid();
  team_a uuid:=gen_random_uuid();
  team_b uuid:=gen_random_uuid();
  foreign_team uuid:=gen_random_uuid();
  admin_user uuid:=gen_random_uuid();
  tier1 uuid:=gen_random_uuid();
  tier2 uuid:=gen_random_uuid();
  tier3 uuid:=gen_random_uuid();
  owner_user uuid:=gen_random_uuid();
  actor uuid;
  role_name text;
  action_a uuid:=gen_random_uuid();
  action_b uuid:=gen_random_uuid();
  action_c uuid:=gen_random_uuid();
  revision_id uuid;
  result jsonb;
  denied boolean;
  c integer;
begin
  insert into public.organizations(id,name)
    values(org,'ADMIN INVITE GATE'),(foreign_org,'FOREIGN INVITE GATE');
  insert into public.admin_teams(id,organization_id,name)
    values(team_a,org,'A'),(team_b,org,'B'),(foreign_team,foreign_org,'Foreign');
  foreach actor in array array[admin_user,tier1,tier2,tier3,owner_user] loop
    role_name:=case when actor in (tier1,tier2,tier3) then 'SUPERVISOR' else 'ADMIN' end;
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
    values(actor,actor::text||'@example.invalid',now(),
      jsonb_build_object('role',role_name,'organization_id',org));
    insert into auth.sessions(id,user_id) values(actor,actor);
    if actor<>owner_user then
      insert into private.account_work_access(organization_id,user_id,work_role,active)
        values(org,actor,role_name,true);
    end if;
  end loop;
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active)
    values(org,team_a,admin_user,true);
  insert into private.org_work_settings(organization_id,supervisor_work_ready)
    values(org,true);
  insert into private.supervisor_grants(
    organization_id,user_id,tier,active,granted_by,reason)
    values(org,tier1,1,true,owner_user,'Synthetic gate'),
      (org,tier2,2,true,owner_user,'Synthetic gate'),
      (org,tier3,3,true,owner_user,'Synthetic gate');
  insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
    values(org,tier1,team_a),(org,tier2,team_a);
  insert into private.platform_owner_capabilities(user_id,active,environment,verified_at)
    values(owner_user,true,'TEST',now());
  insert into private.org_office_allowances(
    organization_id,admin_limit,supervisor_limit)
    values(org,3,3);
  select revision into revision_id from private.org_office_allowances
    where organization_id=org;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',admin_user,'session_id',admin_user)::text,true);
  denied:=false;
  begin
    perform public.reserve_scoped_admin_invitation(action_a,org,team_a,
      'first@example.invalid','First Admin',revision_id,'Unauthorized Admin','TEST');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Ordinary Admin invited Admin';end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',tier1,'session_id',tier1)::text,true);
  denied:=false;
  begin
    perform public.reserve_scoped_admin_invitation(action_a,org,team_a,
      'first@example.invalid','First Admin',revision_id,'Tier 1 attempt','TEST');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Tier 1 reserved Admin seat';end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',tier2,'session_id',tier2)::text,true);
  denied:=false;
  begin
    perform public.reserve_scoped_admin_invitation(action_a,org,team_b,
      'first@example.invalid','First Admin',revision_id,'Out of scope','TEST');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Tier 2 crossed supervised team';end if;
  denied:=false;
  begin
    perform public.reserve_scoped_admin_invitation(action_a,org,team_a,
      'first@example.invalid','First Admin',revision_id,'Missing environment',null);
  exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'NULL environment invited Admin';end if;
  result:=public.reserve_scoped_admin_invitation(action_a,org,team_a,
    ' FIRST@EXAMPLE.INVALID ','First Admin',revision_id,'Scoped staffing','TEST');
  if result->>'status'<>'RESERVED'
    or (select invite_email from private.scoped_admin_invitation_reservations
      where action_id=action_a)<>'first@example.invalid' then
    raise exception 'Tier 2 normalized reservation failed';
  end if;
  if result is distinct from public.reserve_scoped_admin_invitation(action_a,org,team_a,
    'first@example.invalid','First Admin',revision_id,'Scoped staffing','TEST') then
    raise exception 'Same-action retry changed reservation';
  end if;
  denied:=false;
  begin
    perform public.reserve_scoped_admin_invitation(action_a,org,team_a,
      'second@example.invalid','First Admin',revision_id,'Scoped staffing','TEST');
  exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Changed UUID payload reused';end if;
  denied:=false;
  begin
    perform public.reserve_scoped_admin_invitation(gen_random_uuid(),org,team_a,
      'FIRST@example.invalid','Duplicate Admin',revision_id,'Duplicate email','TEST');
  exception when unique_violation then denied:=true; end;
  if not denied then raise exception 'Duplicate pending email reserved another seat';end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',tier3,'session_id',tier3)::text,true);
  denied:=false;
  begin
    perform public.reserve_scoped_admin_invitation(action_b,org,foreign_team,
      'second@example.invalid','Second Admin',revision_id,'Foreign team','TEST');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Tier 3 crossed organization';end if;
  perform public.reserve_scoped_admin_invitation(action_b,org,team_b,
    'second@example.invalid','Second Admin',revision_id,'Tier 3 staffing','TEST');
  denied:=false;
  begin
    perform public.reserve_scoped_admin_invitation(action_c,org,team_b,
      'third@example.invalid','Third Admin',revision_id,'Over capacity','TEST');
  exception when check_violation then denied:=true; end;
  if not denied then raise exception 'Admin capacity was exceeded';end if;
  select count(*) into c from private.office_seat_reservations
    where organization_id=org and requested_role='ADMIN' and state='RESERVED';
  if c<>2 then raise exception 'Rejected duplicate or full seat changed capacity';end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',tier2,'session_id',tier2)::text,true);
  denied:=false;
  begin
    perform public.release_scoped_admin_invitation(action_b,org,'TEST');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Tier 2 cancelled foreign team invite';end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',owner_user,'session_id',owner_user)::text,true);
  if private.has_team_capability(org,team_b,'WORK') then
    raise exception 'Product Owner entitlement leaked customer work';
  end if;
  result:=public.release_scoped_admin_invitation(action_b,org,'TEST');
  if result->>'status'<>'RELEASED' or result is distinct from
    public.release_scoped_admin_invitation(action_b,org,'TEST') then
    raise exception 'Owner release not idempotent';
  end if;
  denied:=false;
  begin
    perform public.reserve_scoped_admin_invitation(action_b,org,team_b,
      'second@example.invalid','Second Admin',revision_id,'Tier 3 staffing','TEST');
  exception when insufficient_privilege or invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Released action resurrected reservation';end if;
  perform public.reserve_scoped_admin_invitation(action_c,org,team_b,
    'third@example.invalid','Third Admin',revision_id,'Owner staffing','TEST');
  select count(*) into c from private.office_seat_reservations
    where organization_id=org and requested_role='ADMIN' and state='RESERVED';
  if c<>2 then raise exception 'Released seat not safely reused';end if;

  if exists(select 1 from auth.users
    where lower(email) in ('first@example.invalid','second@example.invalid','third@example.invalid'))
    or exists(select 1 from private.account_work_access
      where organization_id=org and user_id not in (admin_user,tier1,tier2,tier3)) then
    raise exception 'Preflight invented Auth identity or work entitlement';
  end if;
  if has_table_privilege('authenticated','private.scoped_admin_invitation_reservations','select')
    or has_table_privilege('authenticated','private.scoped_admin_invitation_reservations','insert')
    or has_table_privilege('anon','private.scoped_admin_invitation_reservations','select') then
    raise exception 'Private reservations exposed through direct tables';
  end if;
  raise notice 'Phase 6F scoped Admin invitation preflight PASS';
end;
$admin_invite_gate$;
rollback;
