-- Phase 6F: only the exact new team created by a currently authorized Tier 2
-- (or Tier 3) supervisor may enter that creator's explicit scope. No general
-- Supervisor scope/grant/tier or existing-team modification is delegated.
-- The team and the reserved Admin seat share one PostgreSQL transaction;
-- no Auth identity/link, WO, photo or contractor membership is created.
create table private.created_admin_team_invitation_actions (
  action_id uuid primary key
    references private.scoped_admin_invitation_reservations(action_id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  team_id uuid not null unique,
  actor_id uuid not null references auth.users(id) on delete restrict,
  team_name text not null check(char_length(btrim(team_name)) between 1 and 100),
  invited_email text not null,
  invited_name text not null,
  expected_allowance_revision uuid not null,
  reason text not null check(char_length(btrim(reason)) between 1 and 1000),
  environment text not null check(environment in ('TEST','PRODUCTION')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,team_id)
    references public.admin_teams(organization_id,id) on delete restrict
);
alter table private.created_admin_team_invitation_actions enable row level security;
revoke all on private.created_admin_team_invitation_actions
  from public,anon,authenticated,service_role;
grant select on private.created_admin_team_invitation_actions to service_role;

create function public.create_admin_team_and_reserve_invitation(
  p_action uuid,p_org uuid,p_team uuid,p_team_name text,
  p_email text,p_name text,p_expected_allowance_revision uuid,
  p_reason text,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $create$
declare
  prior private.created_admin_team_invitation_actions%rowtype;
  current_tier smallint;
  request_result jsonb;
  normalized_email text:=lower(btrim(p_email));
  normalized_name text:=btrim(p_name);
  normalized_team text:=btrim(p_team_name);
  normalized_reason text:=btrim(p_reason);
begin
  if p_action is null or p_org is null or p_team is null
    or p_action=p_team or p_expected_allowance_revision is null
    or p_email is null or p_name is null or p_team_name is null
    or p_reason is null or p_environment is null
    or p_environment not in ('TEST','PRODUCTION')
    or char_length(normalized_team) not between 1 and 100
    or char_length(normalized_name) not between 1 and 200
    or char_length(normalized_reason) not between 1 and 1000
    or char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or not private.current_identity_valid()
  then raise exception 'Complete verified new-team staffing inputs required'
    using errcode='22023';end if;

  -- Existing Phase 5 lifecycle is the single concurrent identity/seat owner.
  perform private.lock_account_lifecycle();
  if private.current_work_role(p_org) is distinct from 'SUPERVISOR'
    or not exists(select 1 from private.org_work_settings s
      where s.organization_id=p_org and s.supervisor_work_ready) then
    raise exception 'Current active Supervisor work required' using errcode='42501';end if;
  select g.tier into current_tier from private.supervisor_grants g
    where g.organization_id=p_org and g.user_id=auth.uid() and g.active;
  if current_tier is null or current_tier<2 then
    raise exception 'Tier 2/3 new-team staffing required' using errcode='42501';end if;
  if current_tier=2 and not exists(
    select 1 from private.supervisor_team_scopes scope
    join public.admin_teams t on t.organization_id=scope.organization_id
      and t.id=scope.team_id and t.active
    where scope.organization_id=p_org and scope.user_id=auth.uid()
      and private.has_team_capability(p_org,t.id,'MANAGE_ADMIN')
  ) then raise exception 'Tier 2 must have an existing explicitly supervised team'
    using errcode='42501';end if;

  select * into prior from private.created_admin_team_invitation_actions a
    where a.action_id=p_action for update;
  if found then
    if row(prior.organization_id,prior.team_id,prior.actor_id,prior.team_name,
       prior.invited_email,prior.invited_name,prior.expected_allowance_revision,
       prior.reason,prior.environment)
       is distinct from row(p_org,p_team,auth.uid(),normalized_team,
       normalized_email,normalized_name,p_expected_allowance_revision,
       normalized_reason,p_environment) then
      raise exception 'New-team action replay changed protected inputs'
        using errcode='22023';
    end if;
    if not exists(select 1 from public.admin_teams t
      where t.organization_id=p_org and t.id=p_team and t.active) then
      raise exception 'Original new team is no longer active' using errcode='42501';end if;
    -- Recheck the existing invitation owner: a released/consumed action is
    -- never silently reused, nor is a second team/seat created.
    request_result:=public.reserve_scoped_admin_invitation(
      p_action,p_org,p_team,normalized_email,normalized_name,
      p_expected_allowance_revision,normalized_reason,p_environment);
    return request_result || jsonb_build_object('team_name',normalized_team,
      'new_team',true);
  end if;

  -- A duplicate UUID/name must not attach an existing team as a "new" one.
  if exists(select 1 from public.admin_teams t
    where t.id=p_team or (t.organization_id=p_org
      and lower(btrim(t.name))=lower(normalized_team))) then
    raise exception 'New team identity or name already exists' using errcode='23505';
  end if;
  insert into public.admin_teams(id,organization_id,name,active)
    values(p_team,p_org,normalized_team,true);

  if current_tier=2 then
    -- Exactly one narrowly delegated scope addition, ONLY to the team
    -- just created by this actor, under this action's transactional audit.
    -- Existing-team grants and all owner-only Supervisor actions remain
    -- protected behind their own unchanged Owner RPCs.
    insert into private.supervisor_team_scopes(
      organization_id,user_id,team_id)
    values(p_org,auth.uid(),p_team);
  end if;
  -- Existing protected Admin seat owner checks quota revision, Auth email,
  -- immutable action/reason, pending seats and live delegated team capability.
  request_result:=public.reserve_scoped_admin_invitation(
    p_action,p_org,p_team,normalized_email,normalized_name,
    p_expected_allowance_revision,normalized_reason,p_environment);
  insert into private.created_admin_team_invitation_actions(
    action_id,organization_id,team_id,actor_id,team_name,invited_email,
    invited_name,expected_allowance_revision,reason,environment)
  values(p_action,p_org,p_team,auth.uid(),normalized_team,normalized_email,
    normalized_name,p_expected_allowance_revision,normalized_reason,p_environment);
  return request_result || jsonb_build_object('team_name',normalized_team,
    'new_team',true);
end;
$create$;
revoke all on function public.create_admin_team_and_reserve_invitation(
  uuid,uuid,uuid,text,text,text,uuid,text,text) from public,anon;
grant execute on function public.create_admin_team_and_reserve_invitation(
  uuid,uuid,uuid,text,text,text,uuid,text,text) to authenticated,service_role;

-- Prevent direct bypass of the exact, audited team creation function.
-- The existing role-level grants on public.admin_teams/private scopes remain
-- only for trusted migration/setup owners, not browser authenticated callers.
