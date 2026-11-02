-- Phase 6F: Product Owner controls exact existing Supervisor team scope.
-- Adds/removes one team, never provisions grants or turns on supervisor_work_ready.
create function public.owner_set_supervisor_team_scope(
  p_org uuid,p_user uuid,p_team uuid,p_allowed boolean,
  p_expected_revision uuid,p_reason text,p_environment text
) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  g private.supervisor_grants%rowtype;
  next_revision uuid;
  scoped boolean;
  access_revision uuid;
  cutoff_action uuid;
begin
  if p_org is null or p_user is null or p_team is null or p_allowed is null
     or p_expected_revision is null or p_reason is null
     or char_length(btrim(p_reason)) not between 1 and 1000
     or p_environment is null or p_environment not in ('TEST','PRODUCTION') then
    raise exception 'Invalid scope request' using errcode='22023';
  end if;
  if not private.is_current_platform_owner(p_environment) then
    raise exception 'Verified Product Owner required' using errcode='42501';
  end if;
  perform private.lock_account_lifecycle();
  if not private.is_current_platform_owner(p_environment) then
    raise exception 'Product Owner authorization changed' using errcode='42501';
  end if;
  select * into g from private.supervisor_grants
   where organization_id=p_org and user_id=p_user for update;
  if not found or g.tier=3 or not g.active
     or not exists(select 1 from private.account_work_access a
       where a.organization_id=p_org and a.user_id=p_user and a.work_role='SUPERVISOR')
     or not exists(select 1 from public.admin_teams t
       where t.organization_id=p_org and t.id=p_team and t.active) then
    raise exception 'Existing active scoped Supervisor and team required' using errcode='42501';
  end if;
  if g.revision is distinct from p_expected_revision then
    raise exception 'Stale Supervisor scope revision' using errcode='40001';
  end if;
  select exists(select 1 from private.supervisor_team_scopes s
    where s.organization_id=p_org and s.user_id=p_user and s.team_id=p_team) into scoped;
  if scoped=p_allowed then return g.revision; end if;
  -- Removing an existing team scope is a real evidence-access cutoff.
  -- Materialize the exact old photo set BEFORE the team ceases to be visible.
  -- A previously disabled account already has its separate work-disable cutoff.
  if scoped and not p_allowed
    and private.team_capability_for_user(p_user,p_org,p_team,'WORK') then
    select a.revision into access_revision from private.account_work_access a
      where a.organization_id=p_org and a.user_id=p_user and a.active
        and a.disabled_at is null and a.suspension_authority is null;
    if access_revision is null then
      raise exception 'Active Supervisor access revision required for cutoff' using errcode='42501';
    end if;
    cutoff_action:=gen_random_uuid();
    perform private.freeze_photo_recovery_scope(
      cutoff_action,p_org,p_user,access_revision,array[p_team],btrim(p_reason));
    perform private.complete_photo_recovery_grant(cutoff_action);
  end if;
  if p_allowed then
    insert into private.supervisor_team_scopes(organization_id,user_id,team_id)
    values(p_org,p_user,p_team);
  else
    delete from private.supervisor_team_scopes
    where organization_id=p_org and user_id=p_user and team_id=p_team;
  end if;
  next_revision:=gen_random_uuid();
  update private.supervisor_grants
    set revision=next_revision,granted_by=auth.uid(),reason=btrim(p_reason)
    where organization_id=p_org and user_id=p_user;
  return next_revision;
end;
$$;
revoke all on function public.owner_set_supervisor_team_scope(uuid,uuid,uuid,boolean,uuid,text,text) from public,anon;
grant execute on function public.owner_set_supervisor_team_scope(uuid,uuid,uuid,boolean,uuid,text,text)
  to authenticated,service_role;
