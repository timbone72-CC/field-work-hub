-- Phase 6F-T01 disposable Supervisor invitation/activation gate.
-- The owner-selected scope is fixed before Auth; all fixture rows roll back.
begin;
do $supervisor_invite_gate$
declare
  org uuid:=gen_random_uuid(); team uuid:=gen_random_uuid(); owner uuid:=gen_random_uuid();
  invited uuid:=gen_random_uuid(); action uuid:=gen_random_uuid(); revision uuid;
  response jsonb; denied boolean;
begin
  insert into public.organizations(id,name) values(org,'SUPERVISOR INVITE GATE');
  insert into public.admin_teams(id,organization_id,name) values(team,org,'SUPERVISED TEAM');
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
    values(owner,owner::text||'@example.invalid',now(),jsonb_build_object('role','ADMIN','organization_id',org));
  insert into auth.sessions(id,user_id) values(owner,owner);
  insert into private.platform_owner_capabilities(user_id,active,environment,verified_at)
    values(owner,true,'TEST',now());
  insert into private.org_office_allowances(organization_id,admin_limit,supervisor_limit)
    values(org,1,1) returning private.org_office_allowances.revision into revision;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'session_id',owner)::text,true);

  response:=public.reserve_scoped_supervisor_invitation(action,org,2,array[team],
    'supervisor@example.invalid','Invited Supervisor',revision,'Owner approved','TEST');
  if response->>'status'<>'RESERVED' or response->>'tier'<>'2'
    or (select requested_role from private.office_seat_reservations where action_id=action)<>'SUPERVISOR'
    or (select supervisor_team_ids[1] from private.scoped_admin_invitation_reservations where action_id=action)<>team then
    raise exception 'Supervisor reservation did not retain exact owner scope'; end if;
  response:=public.begin_scoped_supervisor_invitation_issue(action,org,'TEST');
  if response->>'instruction'<>'CREATE_ONCE' then raise exception 'Supervisor Auth create was not fenced'; end if;
  response:=public.begin_scoped_supervisor_invitation_issue(action,org,'TEST');
  if response->>'instruction'<>'RECONCILE' then raise exception 'Supervisor retry could create another Auth identity'; end if;
  denied:=false;
  begin perform public.reserve_scoped_supervisor_invitation(gen_random_uuid(),org,2,array[team],
    'second@example.invalid','Second',revision,'Over capacity','TEST');
  exception when check_violation then denied:=true; end;
  if not denied then raise exception 'Supervisor pending seat allowance was bypassed'; end if;

  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values(invited,'supervisor@example.invalid',jsonb_build_object('role','SUPERVISOR','organization_id',org),
      jsonb_build_object('scoped_admin_invitation_id',action));
  response:=public.team_finalize_scoped_supervisor_issue(action,org,invited,'BOUND');
  if response->>'status'<>'BOUND' then raise exception 'Exact Supervisor Auth binding failed'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',invited,'session_id',invited)::text,true);
  denied:=false;
  begin perform public.complete_scoped_supervisor_invitation_activation();
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Unverified Supervisor activated'; end if;
  insert into auth.sessions(id,user_id) values(invited,invited);
  update auth.users set email_confirmed_at=now() where id=invited;
  response:=public.complete_scoped_supervisor_invitation_activation();
  if response->>'status'<>'ACCEPTED' or (select work_role from private.account_work_access where user_id=invited)<>'SUPERVISOR'
    or (select tier from private.supervisor_grants where user_id=invited)<>2
    or (select team_id from private.supervisor_team_scopes where user_id=invited)<>team
    or (select state from private.office_seat_reservations where action_id=action)<>'CONSUMED' then
    raise exception 'Supervisor activation did not atomically create exact grant/seat'; end if;
  update private.account_work_access set active=false,disabled_at=now(),suspension_authority='MANAGER',suspension_reason='Gate'
    where user_id=invited;
  response:=public.complete_scoped_supervisor_invitation_activation();
  if response->>'status'<>'WORK_DISABLED' then raise exception 'Replay restored disabled Supervisor work'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'session_id',owner)::text,true);
  if has_function_privilege('authenticated','public.team_finalize_scoped_supervisor_issue(uuid,uuid,uuid,text)','execute')
    or has_table_privilege('authenticated','private.scoped_admin_invitation_reservations','select') then
    raise exception 'Supervisor invitation internals exposed to client'; end if;
  raise notice 'Phase 6F Product Owner Supervisor invitation gate PASS';
end;
$supervisor_invite_gate$;
rollback;
