-- Phase 6F: a new team awaiting the exact Admin setup cannot accept jobs or
-- roster placement. Cancelling a pre-Auth reservation retires only that empty,
-- new team; no existing team/WO/photo identity is changed or deleted.
create function private.guard_unstaffed_created_team() returns trigger
language plpgsql security definer set search_path='' as $guard$
declare org_id uuid; requested_team uuid;
begin
  org_id:=new.organization_id;
  if TG_TABLE_NAME='work_orders' then
    requested_team:=new.responsible_team_id;
  else
    requested_team:=new.team_id;
  end if;
  if requested_team is not null and exists(
    select 1 from private.created_admin_team_invitation_actions a
    join private.scoped_admin_invitation_reservations i
      on i.action_id=a.action_id
    where a.organization_id=org_id and a.team_id=requested_team
      and i.state<>'CONSUMED'
  ) then
    raise exception 'New Admin team cannot accept work until verified activation'
      using errcode='42501';
  end if;
  return new;
end;
$guard$;
revoke all on function private.guard_unstaffed_created_team()
  from public,anon,authenticated;
create trigger work_orders_unstaffed_team_guard
  before insert or update of responsible_team_id on public.work_orders
  for each row execute function private.guard_unstaffed_created_team();
create trigger contractor_roster_unstaffed_team_guard
  before insert or update of team_id on private.contractor_team_memberships
  for each row execute function private.guard_unstaffed_created_team();

create function private.retire_cancelled_created_admin_team() returns trigger
language plpgsql security definer set search_path='' as $retire$
declare creation private.created_admin_team_invitation_actions%rowtype;
begin
  if old.state='RESERVED' and new.state='RELEASED' then
    select * into creation from private.created_admin_team_invitation_actions a
      where a.action_id=new.action_id;
    if found then
      -- Any unexpectedly attached work or manager makes the entire release
      -- fail closed, not silently orphan assignments or hide evidence.
      if exists(select 1 from public.work_orders w
          where w.organization_id=creation.organization_id
            and w.responsible_team_id=creation.team_id)
        or exists(select 1 from private.admin_team_memberships m
          where m.organization_id=creation.organization_id
            and m.team_id=creation.team_id)
        or exists(select 1 from private.contractor_team_memberships m
          where m.organization_id=creation.organization_id
            and m.team_id=creation.team_id) then
        raise exception 'Cannot retire a staffed or work-bound new team'
          using errcode='42501';
      end if;
      update public.admin_teams t set active=false,revision=gen_random_uuid()
        where t.organization_id=creation.organization_id and t.id=creation.team_id
          and t.active;
      -- The only delegated membership here is the creator's exact new team.
      -- Owner-granted existing scope remains untouched.
      delete from private.supervisor_team_scopes s
        where s.organization_id=creation.organization_id
          and s.user_id=creation.actor_id and s.team_id=creation.team_id;
    end if;
  end if;
  return new;
end;
$retire$;
revoke all on function private.retire_cancelled_created_admin_team()
  from public,anon,authenticated;
create trigger scoped_admin_new_team_cancel_retirement
  after update of state on private.scoped_admin_invitation_reservations
  for each row execute function private.retire_cancelled_created_admin_team();

-- A retired team's original creator may safely read its already-final
-- cancellation receipt under a verified session. No authorization to create,
-- re-enable or expose that inactive team's scope is implied by this replay.
create or replace function public.release_scoped_admin_invitation(
  p_action uuid,p_org uuid,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $release$
declare prior private.scoped_admin_invitation_reservations%rowtype;
begin
  if p_action is null or p_org is null
    or p_environment is null or p_environment not in ('TEST','PRODUCTION')
    or not private.current_identity_valid() then
    raise exception 'Verified invitation cancellation required' using errcode='42501';
  end if;
  perform private.lock_account_lifecycle();
  select * into prior from private.scoped_admin_invitation_reservations
    where action_id=p_action and organization_id=p_org for update;
  if not found or prior.environment is distinct from p_environment then
    raise exception 'Exact invitation cancellation unavailable' using errcode='42501';
  end if;
  if prior.state='RELEASED' then
    if prior.actor_id is distinct from auth.uid()
      and not private.is_current_platform_owner(p_environment) then
      raise exception 'Cancelled invitation receipt unavailable' using errcode='42501';
    end if;
    return jsonb_build_object('action_id',p_action,'status','RELEASED');
  end if;
  if not private.may_reserve_admin_for_team(
    p_org,prior.team_id,p_environment) then
    raise exception 'Current invitation cancellation authority denied'
      using errcode='42501';
  end if;
  if prior.state<>'RESERVED' then
    raise exception 'Started invitation requires exact Auth reconciliation'
      using errcode='42501';
  end if;
  update private.scoped_admin_invitation_reservations
    set state='RELEASED',released_at=clock_timestamp()
    where action_id=p_action and state='RESERVED';
  update private.office_seat_reservations
    set state='RELEASED'
    where action_id=p_action and organization_id=p_org
      and requested_role='ADMIN' and state='RESERVED';
  if not found then
    raise exception 'Linked office reservation changed' using errcode='40001';
  end if;
  return jsonb_build_object('action_id',p_action,'status','RELEASED');
end;
$release$;
