-- Additive Phase 5/6 authority foundation. No legacy mapping or policy cutover.
-- Do not activate Supervisor work until all Phase 6 controls/gates are ready.
create table private.org_work_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  supervisor_work_ready boolean not null default false,
  revision uuid not null default gen_random_uuid()
);

create table public.admin_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  active boolean not null default true,
  revision uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table private.account_work_access (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  work_role text not null check (work_role in ('ADMIN','CONTRACTOR','SUPERVISOR')),
  active boolean not null default false,
  suspension_authority text check (suspension_authority in ('OWNER','MANAGER')),
  suspension_reason text,
  disabled_at timestamptz,
  revision uuid not null default gen_random_uuid(),
  primary key (organization_id, user_id),
  unique (user_id),
  check (not active or (suspension_authority is null and disabled_at is null)),
  check (suspension_authority is null or coalesce(char_length(btrim(suspension_reason)) between 1 and 1000,false))
);

create table private.admin_team_memberships (
  organization_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  active boolean not null default false,
  revision uuid not null default gen_random_uuid(),
  primary key (organization_id, team_id, user_id),
  foreign key (organization_id, team_id) references public.admin_teams(organization_id,id) on delete restrict,
  foreign key (organization_id, user_id) references private.account_work_access(organization_id,user_id) on delete restrict
);
create index admin_team_memberships_user_idx on private.admin_team_memberships(user_id,organization_id,team_id);

create table private.contractor_team_memberships (
  organization_id uuid not null,
  user_id uuid not null,
  team_id uuid not null,
  active boolean not null default false,
  revision uuid not null default gen_random_uuid(),
  primary key (organization_id,user_id),
  foreign key (organization_id,team_id) references public.admin_teams(organization_id,id) on delete restrict,
  foreign key (organization_id,user_id) references private.account_work_access(organization_id,user_id) on delete restrict
);
create index contractor_team_memberships_team_idx on private.contractor_team_memberships(organization_id,team_id,user_id);

create table private.supervisor_grants (
  organization_id uuid not null,
  user_id uuid not null,
  tier smallint not null check (tier between 1 and 3),
  active boolean not null default false,
  granted_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  revision uuid not null default gen_random_uuid(),
  primary key (organization_id,user_id),
  foreign key (organization_id,user_id) references private.account_work_access(organization_id,user_id) on delete restrict
);
create index supervisor_grants_grantor_idx on private.supervisor_grants(granted_by);
create table private.supervisor_team_scopes (
  organization_id uuid not null,
  user_id uuid not null,
  team_id uuid not null,
  primary key (organization_id,user_id,team_id),
  foreign key (organization_id,user_id) references private.supervisor_grants(organization_id,user_id) on delete restrict,
  foreign key (organization_id,team_id) references public.admin_teams(organization_id,id) on delete restrict
);
create index supervisor_team_scopes_team_idx on private.supervisor_team_scopes(organization_id,team_id,user_id);

-- Capacity is operator supplied: no unlimited or guessed default allocation.
create table private.org_office_allowances (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  admin_limit integer not null check (admin_limit >= 0),
  supervisor_limit integer not null check (supervisor_limit >= 0),
  revision uuid not null default gen_random_uuid()
);
create table private.platform_owner_capabilities (
  user_id uuid primary key references auth.users(id) on delete restrict,
  active boolean not null default false,
  environment text not null check (environment in ('TEST','PRODUCTION')),
  verified_at timestamptz not null,
  revision uuid not null default gen_random_uuid()
);

alter table public.work_orders add column responsible_team_id uuid;
alter table public.work_orders add constraint work_orders_responsible_team_fk
  foreign key (organization_id,responsible_team_id) references public.admin_teams(organization_id,id) on delete restrict;
create index work_orders_responsible_team_idx on public.work_orders(organization_id,responsible_team_id,id);

-- No implicit roster-based ownership. Initial reviewed mapping may fill NULL.
-- Explicit audited handoff will be implemented in its existing server owner.
create function private.protect_responsible_team_binding() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.responsible_team_id is not null and
     (new.responsible_team_id is distinct from old.responsible_team_id or
      new.organization_id is distinct from old.organization_id) then
    raise exception 'Responsible team requires an explicit audited handoff' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_responsible_team_binding() from public,anon,authenticated;
create trigger work_orders_protect_responsible_team
before update of organization_id,responsible_team_id on public.work_orders
for each row execute function private.protect_responsible_team_binding();

-- Signed claims identify a session; current Auth rows establish validity.
-- No stale JWT role, editable metadata, email match or missing-session fallback.
create function private.current_identity_valid() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare session_id uuid;
begin
  begin
    session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then return false;
  end;
  return exists (
    select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=auth.uid() and s.id=session_id
      and u.deleted_at is null and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
      and (s.not_after is null or s.not_after>now())
      and coalesce(auth.jwt()->>'is_anonymous','false')='false'
  );
end;
$$;

create function private.current_work_role(p_org uuid) returns text
language sql stable security definer set search_path='' as $$
  select a.work_role from private.account_work_access a join auth.users u on u.id=a.user_id
  where a.user_id=auth.uid() and a.organization_id=p_org and a.active
    and a.suspension_authority is null and a.disabled_at is null
    and u.raw_app_meta_data->>'organization_id'=a.organization_id::text
    and u.raw_app_meta_data->>'role'=a.work_role
    and private.current_identity_valid()
    and (a.work_role<>'CONTRACTOR' or private.is_assignable_contractor(a.user_id,p_org))
$$;

-- Single capability owner for all new office work/read paths. Unknown actions deny.
create function private.has_team_capability(p_org uuid,p_team uuid,p_capability text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare work_role text; supervisor_tier smallint;
begin
  if not exists(select 1 from public.admin_teams t where t.organization_id=p_org and t.id=p_team and t.active) then
    return false;
  end if;
  work_role:=private.current_work_role(p_org);
  if work_role='ADMIN' then
    return p_capability in ('WORK','INVITE_CONTRACTOR','MANAGE_CONTRACTOR') and exists(
      select 1 from private.admin_team_memberships m
      where m.organization_id=p_org and m.team_id=p_team and m.user_id=auth.uid() and m.active);
  end if;
  if work_role is distinct from 'SUPERVISOR' or not exists(
    select 1 from private.org_work_settings s where s.organization_id=p_org and s.supervisor_work_ready) then
    return false;
  end if;
  select g.tier into supervisor_tier from private.supervisor_grants g
    where g.organization_id=p_org and g.user_id=auth.uid() and g.active;
  if supervisor_tier is null then return false; end if;
  if supervisor_tier<3 and not exists(select 1 from private.supervisor_team_scopes s
    where s.organization_id=p_org and s.user_id=auth.uid() and s.team_id=p_team) then return false; end if;
  return case p_capability
    when 'WORK' then true
    when 'MANAGE_ADMIN' then supervisor_tier>=2
    when 'MANAGE_CONTRACTOR' then supervisor_tier>=2
    when 'PLACE_UNASSIGNED_CONTRACTOR' then supervisor_tier>=2
    when 'INVITE_CONTRACTOR' then supervisor_tier=3
    when 'TRANSFER_CONTRACTOR' then supervisor_tier=3
    when 'HANDOFF_TEAM' then supervisor_tier=3
    else false
  end;
end;
$$;

create function private.can_work_order(p_work_order uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.work_orders w where w.id=p_work_order
    and private.has_team_capability(w.organization_id,w.responsible_team_id,'WORK'))
$$;

-- Platform entitlement authority is deliberately separate from customer work.
-- Bootstrap is a governed verified-UUID operator procedure, never public signup.
create function private.is_current_platform_owner(p_environment text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_identity_valid() and exists(
    select 1 from private.platform_owner_capabilities c join auth.sessions s on s.user_id=c.user_id
    where c.user_id=auth.uid() and c.active and c.environment=p_environment
      and s.id::text=auth.jwt()->>'session_id' and s.created_at>now()-interval '15 minutes')
$$;

-- Private records are inaccessible through direct client SQL/API, even with
-- platform default grants. Public team labels are visible only in WORK scope.
alter table public.admin_teams enable row level security;
revoke all on public.admin_teams from public,anon,authenticated;
grant select on public.admin_teams to authenticated;
grant select,insert,update on public.admin_teams to service_role;
create policy admin_teams_scoped_read on public.admin_teams for select to authenticated
  using (private.has_team_capability(organization_id,id,'WORK'));

do $permissions$
declare table_name text;
begin
  foreach table_name in array array['org_work_settings','account_work_access','admin_team_memberships',
    'contractor_team_memberships','supervisor_grants','supervisor_team_scopes','org_office_allowances',
    'platform_owner_capabilities'] loop
    execute format('alter table private.%I enable row level security',table_name);
    execute format('revoke all on private.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update on private.%I to service_role',table_name);
  end loop;
end;
$permissions$;

revoke all on function private.current_identity_valid(),private.current_work_role(uuid),
  private.has_team_capability(uuid,uuid,text),private.can_work_order(uuid),
  private.is_current_platform_owner(text) from public,anon,authenticated;
-- Self-only boolean predicates reveal no other user's scopes/entitlements.
grant execute on function private.has_team_capability(uuid,uuid,text) to authenticated;
grant execute on function private.current_identity_valid(),private.current_work_role(uuid),
  private.has_team_capability(uuid,uuid,text),private.can_work_order(uuid),
  private.is_current_platform_owner(text) to service_role;
