-- Exact removed-scope evidence foundation. No live cutover or recovery UI yet.
-- Lifecycle operations must freeze before removing scope in the SAME transaction.
-- Storage access additionally needs immutable prepared content and verified bytes.

-- One common permission owner, reused for self authorization and trusted cutoffs.
create function private.work_role_for_user(p_user uuid,p_org uuid) returns text
language sql stable security definer set search_path='' as $$
  select a.work_role from private.account_work_access a join auth.users u on u.id=a.user_id
  where a.user_id=p_user and a.organization_id=p_org and a.active
    and a.suspension_authority is null and a.disabled_at is null
    and u.deleted_at is null and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until<=now())
    and u.raw_app_meta_data->>'organization_id'=a.organization_id::text
    and u.raw_app_meta_data->>'role'=a.work_role
    and (a.work_role<>'CONTRACTOR' or private.is_assignable_contractor(a.user_id,p_org))
$$;
create or replace function private.current_work_role(p_org uuid) returns text
language sql stable security definer set search_path='' as $$
  select private.work_role_for_user(auth.uid(),p_org) where private.current_identity_valid()
$$;
create function private.team_capability_for_user(p_user uuid,p_org uuid,p_team uuid,p_capability text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare work_role text; supervisor_tier smallint;
begin
  if not exists(select 1 from public.admin_teams t where t.organization_id=p_org and t.id=p_team and t.active) then
    return false;
  end if;
  work_role:=private.work_role_for_user(p_user,p_org);
  if work_role='ADMIN' then
    return p_capability in ('WORK','INVITE_CONTRACTOR','MANAGE_CONTRACTOR') and exists(
      select 1 from private.admin_team_memberships m
      where m.organization_id=p_org and m.team_id=p_team and m.user_id=p_user and m.active);
  end if;
  if work_role is distinct from 'SUPERVISOR' or not exists(
    select 1 from private.org_work_settings s where s.organization_id=p_org and s.supervisor_work_ready) then return false;end if;
  select g.tier into supervisor_tier from private.supervisor_grants g
    where g.organization_id=p_org and g.user_id=p_user and g.active;
  if supervisor_tier is null then return false;end if;
  if supervisor_tier<3 and not exists(select 1 from private.supervisor_team_scopes s
    where s.organization_id=p_org and s.user_id=p_user and s.team_id=p_team) then return false;end if;
  return case p_capability
    when 'WORK' then true
    when 'MANAGE_ADMIN' then supervisor_tier>=2
    when 'MANAGE_CONTRACTOR' then supervisor_tier>=2
    when 'PLACE_UNASSIGNED_CONTRACTOR' then supervisor_tier>=2
    when 'INVITE_CONTRACTOR' then supervisor_tier=3
    when 'TRANSFER_CONTRACTOR' then supervisor_tier=3
    when 'HANDOFF_TEAM' then supervisor_tier=3
    else false end;
end;
$$;
create or replace function private.has_team_capability(p_org uuid,p_team uuid,p_capability text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_identity_valid() and private.team_capability_for_user(auth.uid(),p_org,p_team,p_capability)
$$;
revoke all on function private.work_role_for_user(uuid,uuid),private.team_capability_for_user(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function private.work_role_for_user(uuid,uuid),private.team_capability_for_user(uuid,uuid,uuid,text) to service_role;

-- Metadata identity cannot be rewritten to make an old grant point at new work.
create function private.protect_photo_evidence_binding() returns trigger
language plpgsql set search_path='' as $$
begin
  if row(new.id,new.work_order_id,new.run_id,new.captured_by,new.captured_at,
    new.finish_set_id,new.assignment_instance_id,new.requirement_revision,new.requirement_item_id)
    is distinct from row(old.id,old.work_order_id,old.run_id,old.captured_by,old.captured_at,
    old.finish_set_id,old.assignment_instance_id,old.requirement_revision,old.requirement_item_id) then
    raise exception 'Photo evidence identity is immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_photo_evidence_binding() from public,anon,authenticated;
create trigger photos_protect_evidence_binding before update on public.photos
  for each row execute function private.protect_photo_evidence_binding();

create table private.photo_recovery_grants (
  action_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  access_revision uuid not null,
  source_role text not null check(source_role in ('ADMIN','CONTRACTOR','SUPERVISOR')),
  removed_team_ids uuid[] not null,
  reason text not null check(char_length(btrim(reason)) between 1 and 1000),
  cutoff_at timestamptz not null default clock_timestamp(),
  state text not null default 'PENDING' check(state in ('PENDING','READY')),
  member_count bigint not null default 0 check(member_count>=0),
  ready_at timestamptz,
  actor_user_id uuid references auth.users(id) on delete restrict,
  operator_role name not null default session_user,
  check((state='PENDING' and ready_at is null) or (state='READY' and ready_at is not null)),
  unique(action_id,organization_id,user_id)
);
create index photo_recovery_grants_user_idx on private.photo_recovery_grants(user_id,organization_id,state,action_id);
create table private.photo_recovery_members (
  grant_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null,
  photo_id uuid not null references public.photos(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  run_id uuid not null,
  captured_by uuid not null references auth.users(id) on delete restrict,
  captured_at timestamptz not null,
  finish_set_id uuid references public.photo_finish_sets(id) on delete restrict,
  assignment_instance_id uuid,
  requirement_revision uuid,
  finish_digest text check(finish_digest is null or finish_digest ~ '^[a-f0-9]{64}$'),
  accepted_finish_at_cutoff boolean not null,
  primary key(grant_id,photo_id),
  foreign key(grant_id,organization_id,user_id) references private.photo_recovery_grants(action_id,organization_id,user_id) on delete restrict,
  foreign key(run_id,work_order_id) references public.work_order_runs(id,work_order_id) on delete restrict,
  foreign key(assignment_instance_id,run_id) references public.work_order_assignments(id,run_id) on delete restrict,
  check(not accepted_finish_at_cutoff or (finish_set_id is not null and assignment_instance_id is not null and finish_digest is not null))
);
create index photo_recovery_members_user_photo_idx on private.photo_recovery_members(user_id,photo_id,grant_id);
create index photo_recovery_members_wo_idx on private.photo_recovery_members(work_order_id);
create index photo_recovery_members_run_wo_idx on private.photo_recovery_members(run_id,work_order_id);
create index photo_recovery_members_capturer_idx on private.photo_recovery_members(captured_by);
create index photo_recovery_members_finish_idx on private.photo_recovery_members(finish_set_id);
create index photo_recovery_members_assignment_run_idx on private.photo_recovery_members(assignment_instance_id,run_id);

-- Only fixed identity/Finish membership. This alone is NOT byte/upload authority.
create function private.photo_has_accepted_finish(p_photo uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.photos p join public.work_orders w on w.id=p.work_order_id
    join public.photo_finish_sets f on f.id=p.finish_set_id
    join public.field_actions a on a.finish_set_id=f.id
    where p.id=p_photo and f.organization_id=w.organization_id and f.work_order_id=p.work_order_id
    and f.run_id=p.run_id and f.actor_user_id=p.captured_by
    and f.assignment_instance_id=p.assignment_instance_id and f.requirement_revision is not distinct from p.requirement_revision
    and exists(select 1 from jsonb_array_elements(f.photos) j where j->>'id'=p.id::text
      and nullif(j->>'item_id','')::uuid is not distinct from p.requirement_item_id
      and (j->>'captured_at')::timestamptz=p.captured_at)
    and a.action_kind='COMPLETE' and a.actor_user_id=f.actor_user_id and a.organization_id=f.organization_id
    and a.work_order_id=f.work_order_id and a.run_id=f.run_id and a.assignment_instance_id=f.assignment_instance_id
    and a.requirement_revision is not distinct from f.requirement_revision and a.finish_digest=f.digest
    and a.result->>'outcome' in ('APPLIED','ALREADY_APPLIED'))
$$;
revoke all on function private.photo_has_accepted_finish(uuid) from public,anon,authenticated;
grant execute on function private.photo_has_accepted_finish(uuid) to service_role;

create function private.freeze_photo_recovery_scope(
  p_action uuid,p_org uuid,p_user uuid,p_expected_access uuid,p_removed_teams uuid[],p_reason text
) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare teams uuid[]; work_role text; prior private.photo_recovery_grants%rowtype; n bigint;
begin
  if p_action is null or p_org is null or p_user is null or p_expected_access is null
    or p_removed_teams is null or array_ndims(p_removed_teams)>1 or array_position(p_removed_teams,null) is not null
    or coalesce(char_length(btrim(p_reason)) between 1 and 1000,false)=false then
    raise exception 'Explicit recovery cutoff inputs required' using errcode='22023';end if;
  select coalesce(array_agg(t order by t),'{}'::uuid[]) into teams from unnest(p_removed_teams) t;
  if cardinality(teams)<>(select count(distinct t) from unnest(teams) t) then
    raise exception 'Duplicate removed team' using errcode='22023';end if;
  -- Same fixed order for all cutoff calls. Row/Finish/metadata changes cannot race the snapshot.
  lock table private.photo_recovery_grants in share row exclusive mode;
  select * into prior from private.photo_recovery_grants where action_id=p_action;
  if found then
    if row(prior.organization_id,prior.user_id,prior.access_revision,prior.removed_team_ids,prior.reason)
      is distinct from row(p_org,p_user,p_expected_access,teams,btrim(p_reason)) then
      raise exception 'Recovery action UUID reused with changed inputs' using errcode='22023';end if;
    return prior.action_id; -- Never rebuild from current WO membership on retry.
  end if;
  lock table auth.users,private.account_work_access,private.admin_team_memberships,
    private.supervisor_grants,private.supervisor_team_scopes,private.org_work_settings,
    public.admin_teams in share mode;
  lock table public.work_orders,public.photos,public.photo_finish_sets,public.field_actions in share mode;
  select private.work_role_for_user(p_user,p_org) into work_role;
  if work_role is null then raise exception 'Active reviewed work identity required before cutoff' using errcode='42501';end if;
  if not exists(select 1 from private.account_work_access where user_id=p_user and organization_id=p_org and revision=p_expected_access) then
    raise exception 'Work access changed; reload before cutoff' using errcode='40001';end if;
  if work_role='CONTRACTOR' then
    if cardinality(teams)<>0 then raise exception 'Contractor recovery uses own evidence, not office scope' using errcode='22023';end if;
  elsif cardinality(teams)=0 or exists(select 1 from unnest(teams) t
    where not private.team_capability_for_user(p_user,p_org,t,'WORK')) then
    raise exception 'Removed team is not currently authorized' using errcode='42501';
  end if;
  insert into private.photo_recovery_grants(action_id,organization_id,user_id,access_revision,source_role,removed_team_ids,reason,actor_user_id)
    values(p_action,p_org,p_user,p_expected_access,work_role,teams,btrim(p_reason),auth.uid());
  insert into private.photo_recovery_members(grant_id,organization_id,user_id,photo_id,work_order_id,run_id,
    captured_by,captured_at,finish_set_id,assignment_instance_id,requirement_revision,finish_digest,accepted_finish_at_cutoff)
    select p_action,p_org,p_user,p.id,p.work_order_id,p.run_id,p.captured_by,p.captured_at,
      p.finish_set_id,p.assignment_instance_id,p.requirement_revision,f.digest,private.photo_has_accepted_finish(p.id)
    from public.photos p join public.work_orders w on w.id=p.work_order_id
    left join public.photo_finish_sets f on f.id=p.finish_set_id
    where w.organization_id=p_org and
      ((work_role='CONTRACTOR' and p.captured_by=p_user) or
       (work_role in ('ADMIN','SUPERVISOR') and w.responsible_team_id=any(teams)));
  get diagnostics n=row_count;
  update private.photo_recovery_grants set member_count=n where action_id=p_action;
  return p_action;
end;
$$;

-- Finishing PENDING reads the already materialized set, never today's photos.
create function private.complete_photo_recovery_grant(p_action uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare g private.photo_recovery_grants%rowtype; n bigint;
begin
  select * into g from private.photo_recovery_grants where action_id=p_action for update;
  if not found then raise exception 'Recovery snapshot unavailable' using errcode='22023';end if;
  select count(*) into n from private.photo_recovery_members where grant_id=p_action;
  if n<>g.member_count then raise exception 'Incomplete fixed recovery snapshot' using errcode='40001';end if;
  if g.state='PENDING' then
    update private.photo_recovery_grants set state='READY',ready_at=clock_timestamp() where action_id=p_action;
  end if;
  return n;
end;
$$;

create function private.protect_photo_recovery_member() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Recovery snapshot members are immutable' using errcode='42501';
end;
$$;
create trigger photo_recovery_members_immutable before update or delete on private.photo_recovery_members
  for each row execute function private.protect_photo_recovery_member();

create function private.protect_photo_recovery_header() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Recovery snapshot cannot be deleted' using errcode='42501';end if;
  if row(new.action_id,new.organization_id,new.user_id,new.access_revision,new.source_role,
    new.removed_team_ids,new.reason,new.cutoff_at,new.actor_user_id,new.operator_role)
    is distinct from row(old.action_id,old.organization_id,old.user_id,old.access_revision,old.source_role,
    old.removed_team_ids,old.reason,old.cutoff_at,old.actor_user_id,old.operator_role)
    or (old.state='READY' and new is distinct from old)
    or (new.member_count<>old.member_count and (old.state<>'PENDING' or old.member_count<>0
      or new.member_count<>(select count(*) from private.photo_recovery_members where grant_id=old.action_id))) then
    raise exception 'Recovery cutoff header is immutable' using errcode='42501';end if;
  return new;
end;
$$;
revoke all on function private.protect_photo_recovery_header() from public,anon,authenticated;
create trigger photo_recovery_grants_protect_header before update or delete on private.photo_recovery_grants
  for each row execute function private.protect_photo_recovery_header();

create function private.recovery_member_binding_valid(p_grant uuid,p_photo uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.photo_recovery_members m join public.photos p on p.id=m.photo_id
    join public.work_orders w on w.id=p.work_order_id left join public.photo_finish_sets f on f.id=p.finish_set_id
    where m.grant_id=p_grant and m.photo_id=p_photo and w.organization_id=m.organization_id
    and row(p.work_order_id,p.run_id,p.captured_by,p.captured_at,p.finish_set_id,p.assignment_instance_id,p.requirement_revision,f.digest)
      is not distinct from row(m.work_order_id,m.run_id,m.captured_by,m.captured_at,m.finish_set_id,m.assignment_instance_id,m.requirement_revision,m.finish_digest))
$$;
revoke all on function private.recovery_member_binding_valid(uuid,uuid) from public,anon,authenticated;
grant execute on function private.recovery_member_binding_valid(uuid,uuid) to service_role;

-- Fresh recovery authentication bounds gallery access to 30 minutes.
-- Access metadata/Finish tuples are fixed; storage bytes need separate receipt checks.
create function private.can_recover_photo(p_photo uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_identity_valid() and exists(select 1 from auth.sessions s
    where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and s.created_at>now()-interval '30 minutes')
    and exists(select 1 from private.photo_recovery_grants g join private.photo_recovery_members m on m.grant_id=g.action_id
      where m.user_id=auth.uid() and m.photo_id=p_photo and g.state='READY'
        and private.recovery_member_binding_valid(m.grant_id,m.photo_id))
$$;
-- Background protection can continue with the exact still-valid Auth session.
-- This Finish predicate must be combined with fixed prepared hash/size/path later.
create function private.has_pre_cutoff_finish(p_photo uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_identity_valid() and exists(select 1 from private.photo_recovery_members m
    join private.photo_recovery_grants g on g.action_id=m.grant_id
    where m.user_id=auth.uid() and m.captured_by=auth.uid() and m.photo_id=p_photo
      and m.accepted_finish_at_cutoff and g.state='READY'
      and private.recovery_member_binding_valid(m.grant_id,m.photo_id) and private.photo_has_accepted_finish(p_photo))
$$;

alter table private.photo_recovery_grants enable row level security;
alter table private.photo_recovery_members enable row level security;
revoke all on private.photo_recovery_grants,private.photo_recovery_members from public,anon,authenticated,service_role;
grant select on private.photo_recovery_grants,private.photo_recovery_members to service_role;
revoke all on function private.freeze_photo_recovery_scope(uuid,uuid,uuid,uuid,uuid[],text),
  private.complete_photo_recovery_grant(uuid),private.protect_photo_recovery_member(),
  private.can_recover_photo(uuid),private.has_pre_cutoff_finish(uuid) from public,anon,authenticated;
grant execute on function private.freeze_photo_recovery_scope(uuid,uuid,uuid,uuid,uuid[],text),
  private.complete_photo_recovery_grant(uuid),private.can_recover_photo(uuid),private.has_pre_cutoff_finish(uuid) to service_role;
-- Self-only booleans expose no other user's grant lists or operational records.
grant execute on function private.can_recover_photo(uuid),private.has_pre_cutoff_finish(uuid) to authenticated;
