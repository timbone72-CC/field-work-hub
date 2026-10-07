-- Trusted, one-time initial mapping. Not a signup, restore or entitlement API.
-- Operator supplies reviewed immutable UUIDs and an exact current WO snapshot.
-- Keep real identities/snapshots out of source. This migration seeds nothing.
create table private.initial_access_bootstrap (
  action_id uuid primary key,
  organization_id uuid not null unique references public.organizations(id) on delete restrict,
  manifest jsonb not null,
  result jsonb not null,
  executed_at timestamptz not null default now(),
  executed_by name not null default session_user
);
alter table private.initial_access_bootstrap enable row level security;
revoke all on private.initial_access_bootstrap from public,anon,authenticated,service_role;
grant select on private.initial_access_bootstrap to service_role;

-- This is deliberately a bootstrap-only snapshot, not a dashboard projection.
create function private.initial_team_work_snapshot(p_org uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',w.id,'updated_at',w.updated_at,'current_run_id',w.current_run_id,
    'assigned_user_id',w.assigned_user_id,'pending_assignee_user_id',w.pending_assignee_user_id
  ) order by w.id),'[]'::jsonb) from public.work_orders w where w.organization_id=p_org
$$;
revoke all on function private.initial_team_work_snapshot(uuid) from public,anon,authenticated;
grant execute on function private.initial_team_work_snapshot(uuid) to service_role;

create function private.bootstrap_initial_team_access(
  p_action_id uuid,p_org uuid,p_admin uuid,p_owner uuid,p_team uuid,p_team_name text,
  p_contractors uuid[],p_work_orders jsonb,p_environment text,p_reason text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  contractors uuid[]; actual_contractors uuid[]; actual_admins uuid[];
  manifest jsonb; prior private.initial_access_bootstrap%rowtype; result jsonb;
  snapshot jsonb;
begin
  if p_action_id is null or p_org is null or p_admin is null or p_owner is null or p_team is null
    or coalesce(char_length(btrim(p_team_name)) between 1 and 100,false)=false
    or coalesce(char_length(btrim(p_reason)) between 1 and 1000,false)=false
    or coalesce(p_environment in ('TEST','PRODUCTION'),false)=false
    or p_contractors is null or array_ndims(p_contractors)>1
    or array_position(p_contractors,null) is not null
    or jsonb_typeof(p_work_orders) is distinct from 'array' then
    raise exception 'Explicit reviewed setup inputs are required' using errcode='22023';
  end if;
  select coalesce(array_agg(c order by c),'{}'::uuid[]) into contractors from unnest(p_contractors) c;
  if cardinality(contractors)<>(select count(distinct c) from unnest(contractors) c)
    or p_admin=any(contractors) or p_owner=any(contractors) then
    raise exception 'Duplicate or overlapping account mapping' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(v order by v->>'id'),'[]'::jsonb) into snapshot
    from jsonb_array_elements(p_work_orders) v;
  manifest:=jsonb_build_object('organization_id',p_org,'admin_id',p_admin,'owner_id',p_owner,
    'team_id',p_team,'team_name',btrim(p_team_name),'contractor_ids',contractors,
    'work_orders',snapshot,'environment',p_environment,'reason',btrim(p_reason));

  -- Fixed order; serialize competing bootstraps and freeze legacy inventory.
  -- Short operator maintenance transaction only; contention fails, never guesses.
  lock table private.initial_access_bootstrap in share row exclusive mode;
  select * into prior from private.initial_access_bootstrap where action_id=p_action_id;
  if found then
    if prior.manifest is distinct from manifest then
      raise exception 'Setup action UUID reused with changed inputs' using errcode='22023';
    end if;
    -- Return historical result only: never reenable access or repeat mapping.
    return prior.result;
  end if;
  if exists(select 1 from private.initial_access_bootstrap) then
    raise exception 'Initial setup is already recorded; use governed lifecycle operations' using errcode='40001';
  end if;
  lock table auth.users in share row exclusive mode;
  lock table public.organizations,public.contractor_invitations,public.work_orders in share row exclusive mode;
  lock table private.platform_owner_capabilities,public.admin_teams,private.account_work_access,
    private.admin_team_memberships,private.contractor_team_memberships,
    private.org_work_settings,private.supervisor_grants,private.supervisor_team_scopes,
    private.org_office_allowances in share row exclusive mode;

  if not exists(select 1 from public.organizations where id=p_org) then
    raise exception 'Reviewed organization unavailable' using errcode='22023';
  end if;
  if not exists(select 1 from auth.users u where u.id=p_owner and u.deleted_at is null
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Verified Product Owner identity unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users u where u.id=p_admin and u.deleted_at is null
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
    and u.raw_app_meta_data->>'organization_id'=p_org::text and u.raw_app_meta_data->>'role'='ADMIN') then
    raise exception 'Verified initial Admin identity unavailable' using errcode='42501';
  end if;
  select coalesce(array_agg(u.id order by u.id),'{}'::uuid[]) into actual_admins
    from auth.users u where u.raw_app_meta_data->>'organization_id'=p_org::text
    and u.raw_app_meta_data->>'role'='ADMIN';
  select coalesce(array_agg(u.id order by u.id),'{}'::uuid[]) into actual_contractors
    from auth.users u where u.raw_app_meta_data->>'organization_id'=p_org::text
    and u.raw_app_meta_data->>'role'='CONTRACTOR';
  if actual_admins is distinct from array[p_admin] or actual_contractors is distinct from contractors
    or exists(select 1 from auth.users u where u.raw_app_meta_data->>'organization_id'=p_org::text
      and coalesce(u.raw_app_meta_data->>'role','') not in ('ADMIN','CONTRACTOR')) then
    raise exception 'Account inventory changed or requires explicit multi-team review' using errcode='40001';
  end if;
  if exists(select 1 from unnest(contractors) c where not private.is_assignable_contractor(c,p_org)) then
    raise exception 'Contractor is not currently accepted and active' using errcode='42501';
  end if;
  if snapshot is distinct from private.initial_team_work_snapshot(p_org) then
    raise exception 'WO inventory changed; review exact current records' using errcode='40001';
  end if;
  if exists(select 1 from private.platform_owner_capabilities)
    or exists(select 1 from public.admin_teams where organization_id=p_org or id=p_team)
    or exists(select 1 from private.account_work_access where organization_id=p_org
      or user_id=p_admin or user_id=any(contractors))
    or exists(select 1 from private.org_work_settings where organization_id=p_org)
    or exists(select 1 from private.org_office_allowances where organization_id=p_org)
    or exists(select 1 from public.work_orders where organization_id=p_org and responsible_team_id is not null) then
    raise exception 'Existing authority cannot be replaced by initial setup' using errcode='40001';
  end if;

  insert into private.platform_owner_capabilities(user_id,active,environment,verified_at)
    values(p_owner,true,p_environment,now());
  insert into public.admin_teams(id,organization_id,name) values(p_team,p_org,btrim(p_team_name));
  insert into private.account_work_access(organization_id,user_id,work_role,active) values(p_org,p_admin,'ADMIN',true);
  insert into private.account_work_access(organization_id,user_id,work_role,active)
    select p_org,c,'CONTRACTOR',true from unnest(contractors) c;
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(p_org,p_team,p_admin,true);
  insert into private.contractor_team_memberships(organization_id,user_id,team_id,active)
    select p_org,c,p_team,true from unnest(contractors) c;
  insert into private.org_work_settings(organization_id) values(p_org); -- Supervisor work stays OFF.
  update public.work_orders set responsible_team_id=p_team where organization_id=p_org;
  -- No Auth role mutation, seat allocation, reassignment, Finish/photo/provider changes.
  result:=jsonb_build_object('team_id',p_team,'work_order_count',jsonb_array_length(snapshot),
    'contractor_count',cardinality(contractors),'environment',p_environment,'supervisor_work_ready',false);
  insert into private.initial_access_bootstrap(action_id,organization_id,manifest,result)
    values(p_action_id,p_org,manifest,result);
  return result;
end;
$$;
revoke all on function private.bootstrap_initial_team_access(uuid,uuid,uuid,uuid,uuid,text,uuid[],jsonb,text,text)
  from public,anon,authenticated;
grant execute on function private.bootstrap_initial_team_access(uuid,uuid,uuid,uuid,uuid,text,uuid[],jsonb,text,text)
  to service_role;
