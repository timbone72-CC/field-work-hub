-- Phase 6F first bounded authority checkpoint. Source-only; no Supervisor rollout.
-- Change an EXISTING Supervisor tier only, never bootstrap a grant or broaden a team scope.
create function public.owner_change_supervisor_tier(
  p_org uuid, p_user uuid, p_expected_revision uuid, p_tier smallint,
  p_reason text, p_environment text
) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  existing private.supervisor_grants%rowtype;
  access_role text;
  next_revision uuid;
  access_revision uuid;
  removed_teams uuid[];
  cutoff_action uuid;
begin
  if p_org is null or p_user is null or p_expected_revision is null
     or p_tier is null or p_tier not between 1 and 3
     or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000
     or p_environment is null or p_environment not in ('TEST','PRODUCTION') then
    raise exception 'Invalid tier change request' using errcode='22023';
  end if;
  if not private.is_current_platform_owner(p_environment) then
    raise exception 'Current verified Product Owner authorization required' using errcode='42501';
  end if;
  -- The existing lifecycle lock serializes authority actions with disable/revocation.
  perform private.lock_account_lifecycle();
  if not private.is_current_platform_owner(p_environment) then
    raise exception 'Product Owner authorization changed' using errcode='42501';
  end if;
  select * into existing from private.supervisor_grants
    where organization_id=p_org and user_id=p_user for update;
  if not found then
    raise exception 'Existing Supervisor grant required' using errcode='42501';
  end if;
  select a.work_role into access_role from private.account_work_access a
    where a.organization_id=p_org and a.user_id=p_user;
  if access_role is distinct from 'SUPERVISOR' then
    raise exception 'Supervisor role mismatch' using errcode='42501';
  end if;
  if existing.revision is distinct from p_expected_revision then
    raise exception 'Stale Supervisor grant revision' using errcode='40001';
  end if;
  if existing.tier=p_tier then return existing.revision; end if;
  -- Tier 3 sees the whole organization. Before a 3 -> 1/2 downgrade,
  -- freeze exactly the active teams no longer granted in the target tier.
  -- No team/photo recovery is invented for a disabled or not-yet-enabled account.
  if existing.tier=3 and p_tier<3 and existing.active then
    select a.revision into access_revision from private.account_work_access a
      where a.organization_id=p_org and a.user_id=p_user and a.active
        and a.disabled_at is null and a.suspension_authority is null;
    if access_revision is not null and exists(
      select 1 from private.org_work_settings w
      where w.organization_id=p_org and w.supervisor_work_ready
    ) then
      select coalesce(array_agg(t.id order by t.id),'{}'::uuid[]) into removed_teams
        from public.admin_teams t
        where t.organization_id=p_org and t.active
          and not exists(
            select 1 from private.supervisor_team_scopes sc
            where sc.organization_id=p_org and sc.user_id=p_user and sc.team_id=t.id
          );
      if cardinality(removed_teams)>0 then
        cutoff_action:=gen_random_uuid();
        perform private.freeze_photo_recovery_scope(
          cutoff_action,p_org,p_user,access_revision,removed_teams,btrim(p_reason));
        perform private.complete_photo_recovery_grant(cutoff_action);
      end if;
    end if;
  end if;
  next_revision:=gen_random_uuid();
  update private.supervisor_grants
    set tier=p_tier,revision=next_revision,granted_by=auth.uid(),reason=btrim(p_reason)
    where organization_id=p_org and user_id=p_user;
  return next_revision;
end;
$$;
revoke all on function public.owner_change_supervisor_tier(uuid,uuid,uuid,smallint,text,text)
  from public,anon;
grant execute on function public.owner_change_supervisor_tier(uuid,uuid,uuid,smallint,text,text)
  to authenticated,service_role;
