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
