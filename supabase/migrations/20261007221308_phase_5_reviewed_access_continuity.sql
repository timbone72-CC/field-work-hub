-- Reviewed account lifecycle within the retained access/recovery/capacity owner.
-- Source-only. No Supervisor activation, office provisioning or job handoff.
create table private.account_work_access_reviews (
  action_id uuid primary key references private.account_work_access_actions(action_id) on delete restrict,
  review_fingerprint text not null check(review_fingerprint ~ '^[a-f0-9]{64}$'),
  continuity jsonb not null check(jsonb_typeof(continuity)='array'),
  affected_jobs bigint not null check(affected_jobs>=0),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.account_work_access_reviews enable row level security;
revoke all on private.account_work_access_reviews from public,anon,authenticated,service_role;
grant select on private.account_work_access_reviews to service_role;
create trigger account_work_access_reviews_immutable before update or delete
  on private.account_work_access_reviews for each row
  execute function private.reject_account_work_access_action_mutation();

-- Internal snapshot only: no customer fields or Auth account contents are returned.
-- This optimistic checksum is NOT a capability. Every call rechecks current authority.
create function private.account_access_review_snapshot(p_target uuid,p_active boolean,p_environment text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  a private.account_work_access%rowtype;
  teams uuid[];
  authority text;
  facts jsonb;
  fingerprint text;
  n bigint;
  assigned bigint;
  started bigint;
  finished bigint;
begin
  if p_target is null or p_active is null
    or not coalesce(p_environment in ('TEST','PRODUCTION'),false) then
    raise exception 'Explicit review inputs required' using errcode='22023';
  end if;
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() then
    raise exception 'Current verified session required' using errcode='42501';
  end if;
  select * into a from private.account_work_access where user_id=p_target;
  if not found then raise exception 'Account review unavailable' using errcode='42501';end if;
  authority:=private.account_access_authority(a.organization_id,p_target,a.work_role,p_environment);
  if authority is null then raise exception 'Account review unavailable' using errcode='42501';end if;
  if a.active=p_active then raise exception 'Requested work access is already current' using errcode='22023';end if;
  if a.work_role='CONTRACTOR' then
    teams:=array_remove(array[private.recorded_contractor_team(p_target,a.organization_id)],null);
  else
    teams:=private.account_removed_teams(p_target,a.organization_id,a.work_role);
  end if;
  if cardinality(teams)=0 then raise exception 'Account scope must be mapped before review' using errcode='42501';end if;
  -- The recovery lock is always first. SHARE prevents job phantoms/edits while
  -- hashing and confirming; no network request is made while these locks exist.
  lock table public.organizations,public.work_orders in share mode;
  select count(*),count(*) filter(where w.field_status='ASSIGNED'),
    count(*) filter(where w.field_status='IN_PROGRESS'),
    count(*) filter(where w.field_status='FIELD_COMPLETE')
    into n,assigned,started,finished
  from public.work_orders w where w.organization_id=a.organization_id
    and w.responsible_team_id=any(teams) and w.field_status<>'CANCELLED'
    and (a.work_role<>'CONTRACTOR' or w.assigned_user_id=p_target);

  -- Conservative organization authority checksum; an unrelated staffing change
  -- may require another review, but can never widen a previously reviewed scope.
  select jsonb_build_object(
    'actor',auth.uid(),'session',auth.jwt()->>'session_id','target',to_jsonb(a),
    'requested_active',p_active,'environment',p_environment,'authority',authority,'teams',teams,
    'team_rows',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.admin_teams t where t.organization_id=a.organization_id),
    'access',(select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id),'[]') from private.account_work_access x where x.organization_id=a.organization_id),
    'admins',(select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.team_id),'[]') from private.admin_team_memberships x where x.organization_id=a.organization_id),
    'contractors',(select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id),'[]') from private.contractor_team_memberships x where x.organization_id=a.organization_id),
    'supervisors',(select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id),'[]') from private.supervisor_grants x where x.organization_id=a.organization_id),
    'scopes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.team_id),'[]') from private.supervisor_team_scopes x where x.organization_id=a.organization_id),
    'readiness',(select to_jsonb(x) from private.org_work_settings x where x.organization_id=a.organization_id),
    'allowance',(select to_jsonb(x) from private.org_office_allowances x where x.organization_id=a.organization_id),
    'owner',(select to_jsonb(x) from private.platform_owner_capabilities x where x.user_id=auth.uid()),
    'seat_limit',(select contractor_seat_limit from public.organizations where id=a.organization_id),
    'pending_seats',(select coalesce(jsonb_agg(jsonb_build_array(i.id,i.status,i.team_id) order by i.id),'[]') from public.contractor_invitations i where i.organization_id=a.organization_id and i.status in ('RESERVED','SENT','PROBLEM','CANCELLING')),
    'identities',(select coalesce(jsonb_agg(jsonb_build_array(x.user_id,private.account_identity_ready(x.organization_id,x.user_id,x.work_role)) order by x.user_id),'[]') from private.account_work_access x where x.organization_id=a.organization_id),
    'jobs',(select md5(coalesce(string_agg(md5(to_jsonb(w)::text),'' order by w.id),'')) from public.work_orders w where w.organization_id=a.organization_id and w.responsible_team_id=any(teams) and (a.work_role<>'CONTRACTOR' or w.assigned_user_id=p_target))
  ) into facts;
  fingerprint:=encode(sha256(convert_to(facts::text,'UTF8')),'hex');
  return jsonb_build_object('organization_id',a.organization_id,'target_user_id',p_target,
    'target_role',a.work_role,'active',a.active,'requested_active',p_active,
    'access_revision',a.revision,'review_fingerprint',fingerprint,'team_ids',teams,
    'affected_jobs',n,'assigned_jobs',assigned,'in_progress_jobs',started,'field_complete_jobs',finished);
end; $$;
revoke all on function private.account_access_review_snapshot(uuid,boolean,text) from public,anon,authenticated;
grant execute on function private.account_access_review_snapshot(uuid,boolean,text) to service_role;

create function private.review_account_work_access(
  p_target uuid,p_active boolean,p_environment text,p_limit integer default 25,
  p_after_team uuid default null,p_expected_fingerprint text default null
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare s jsonb; teams uuid[]; org uuid; page jsonb; last_id uuid;
begin
  if p_limit is null or p_limit not in (25,50) then
    raise exception 'Review page size must be 25 or 50' using errcode='22023';end if;
  s:=private.account_access_review_snapshot(p_target,p_active,p_environment);
  if p_expected_fingerprint is not null and p_expected_fingerprint is distinct from s->>'review_fingerprint' then
    raise exception 'Review changed; reload before continuing' using errcode='40001';end if;
  if p_after_team is not null and p_expected_fingerprint is null then
    raise exception 'Review fingerprint required for another page' using errcode='22023';end if;
  select array_agg(x::uuid order by x::uuid) into teams from jsonb_array_elements_text(s->'team_ids') x;
  org:=(s->>'organization_id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('team_id',t.id,'name',t.name,'revision',t.revision,
    'affected_jobs',(select count(*) from public.work_orders w where w.organization_id=org
      and w.responsible_team_id=t.id and w.field_status<>'CANCELLED'
      and (s->>'target_role'<>'CONTRACTOR' or w.assigned_user_id=p_target)),
    'manager_count',(select count(*) from private.account_work_access a where a.organization_id=org
      and a.user_id<>p_target and private.team_capability_for_user(a.user_id,org,t.id,'WORK')),
    'manager_user_ids',(select coalesce(jsonb_agg(m.user_id order by m.user_id),'[]') from (
      select a.user_id from private.account_work_access a where a.organization_id=org and a.user_id<>p_target
        and private.team_capability_for_user(a.user_id,org,t.id,'WORK') order by a.user_id limit 50) m)
  ) order by t.id),'[]') into page from (
    select * from public.admin_teams t where t.organization_id=org and t.id=any(teams)
      and (p_after_team is null or t.id>p_after_team) order by t.id limit p_limit
  ) t;
  if jsonb_array_length(page)>0 then last_id:=(page->-1->>'team_id')::uuid;end if;
  return (s-'team_ids') || jsonb_build_object('teams',page,'total_teams',cardinality(teams),
    'next_team',case when exists(select 1 from unnest(teams) t where t>last_id) then last_id else null end,
    'continuity_required',not p_active and s->>'target_role' in ('ADMIN','SUPERVISOR'));
end; $$;

-- Retain the single tested mutation engine and remove every direct client grant.
alter function private.set_account_work_access(uuid,uuid,uuid,boolean,text,text)
  rename to set_account_work_access_engine;
revoke all on function private.set_account_work_access_engine(uuid,uuid,uuid,boolean,text,text)
  from public,anon,authenticated;
grant execute on function private.set_account_work_access_engine(uuid,uuid,uuid,boolean,text,text) to service_role;

create function private.set_account_work_access(
  p_action uuid,p_target uuid,p_expected_revision uuid,p_active boolean,p_reason text,p_environment text
) returns table(action_id uuid,target_user_id uuid,active boolean,revision uuid,recovery_grant_id uuid)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() or exists(
    select 1 from private.account_work_access a where a.user_id=p_target and a.work_role<>'CONTRACTOR'
  ) then raise exception 'Reviewed account access operation required' using errcode='42501';end if;
  return query select * from private.set_account_work_access_engine(
    p_action,p_target,p_expected_revision,p_active,p_reason,p_environment);
end; $$;
revoke all on function private.set_account_work_access(uuid,uuid,uuid,boolean,text,text) from public,anon;
grant execute on function private.set_account_work_access(uuid,uuid,uuid,boolean,text,text) to authenticated,service_role;
-- Replace the wrapper body as well: SQL dependencies must resolve to the guarded
-- compatibility function rather than retaining the renamed engine's OID.
create or replace function public.set_account_work_access(
  p_action uuid,p_target uuid,p_expected_revision uuid,p_active boolean,p_reason text,p_environment text
) returns table(action_id uuid,target_user_id uuid,active boolean,revision uuid,recovery_grant_id uuid)
language sql security invoker set search_path='' as $$
  select * from private.set_account_work_access(p_action,p_target,p_expected_revision,p_active,p_reason,p_environment);
$$;

create function private.set_reviewed_account_work_access(
  p_action uuid,p_target uuid,p_expected_revision uuid,p_active boolean,p_reason text,p_environment text,
  p_review_fingerprint text,p_continuity jsonb
) returns table(action_id uuid,target_user_id uuid,active boolean,revision uuid,recovery_grant_id uuid)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  prior private.account_work_access_reviews%rowtype;
  s jsonb;
  teams uuid[];
  supplied uuid[];
  entry jsonb;
  team uuid;
  manager uuid;
  org uuid;
  result record;
begin
  if p_action is null or p_target is null or p_expected_revision is null or p_active is null
    or not coalesce(p_environment in ('TEST','PRODUCTION'),false)
    or coalesce(char_length(btrim(p_reason)) between 1 and 1000,false)=false
    or not coalesce(p_review_fingerprint ~ '^[a-f0-9]{64}$',false)
    or coalesce(jsonb_typeof(p_continuity),'')<>'array' then
    raise exception 'Explicit reviewed access inputs required' using errcode='22023';end if;
  if jsonb_array_length(p_continuity)>1000 then
    raise exception 'Continuity action exceeds bounded request limit' using errcode='22023';end if;
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() then raise exception 'Current verified session required' using errcode='42501';end if;
  select * into prior from private.account_work_access_reviews r where r.action_id=p_action;
  if found then
    if row(prior.review_fingerprint,prior.continuity) is distinct from row(p_review_fingerprint,p_continuity) then
      raise exception 'Reviewed action UUID reused with changed inputs' using errcode='22023';end if;
    -- The retained engine validates exact historical actor/base inputs on replay.
    return query select * from private.set_account_work_access_engine(
      p_action,p_target,p_expected_revision,p_active,p_reason,p_environment);
    return;
  end if;
  if exists(select 1 from private.account_work_access_actions a where a.action_id=p_action) then
    raise exception 'Action UUID already belongs to another access request' using errcode='22023';end if;
  s:=private.account_access_review_snapshot(p_target,p_active,p_environment);
  if (s->>'access_revision')::uuid is distinct from p_expected_revision
    or s->>'review_fingerprint' is distinct from p_review_fingerprint then
    raise exception 'Reviewed account, scope or jobs changed; reload before continuing' using errcode='40001';end if;
  org:=(s->>'organization_id')::uuid;
  if not p_active and s->>'target_role' in ('ADMIN','SUPERVISOR') then
    select array_agg(x::uuid order by x::uuid) into teams from jsonb_array_elements_text(s->'team_ids') x;
    begin
      select coalesce(array_agg((x->>'team_id')::uuid order by (x->>'team_id')::uuid),'{}')
        into supplied from jsonb_array_elements(p_continuity) x;
    exception when invalid_text_representation then
      raise exception 'Continuity team identity is invalid' using errcode='22023';
    end;
    if supplied is distinct from teams then
      raise exception 'One explicit continuity decision required for every reviewed team' using errcode='22023';end if;
    for entry in select * from jsonb_array_elements(p_continuity) loop
      if jsonb_typeof(entry)<>'object' or entry->>'decision' is null
        or exists(select 1 from jsonb_object_keys(entry) k where k not in ('team_id','decision','manager_user_id')) then
        raise exception 'Invalid continuity decision' using errcode='22023';end if;
      team:=(entry->>'team_id')::uuid;
      if entry->>'decision'='KEEP_MANAGER' then
        begin manager:=(entry->>'manager_user_id')::uuid;
        exception when invalid_text_representation then
          raise exception 'Continuity manager identity is invalid' using errcode='22023';end;
        if manager is null or manager=p_target
          or not private.team_capability_for_user(manager,org,team,'WORK') then
          raise exception 'Continuity manager lacks current active team authority' using errcode='42501';end if;
      elsif entry->>'decision'='NEEDS_MANAGER' then
        if entry ? 'manager_user_id' or exists(
          select 1 from private.account_work_access a where a.organization_id=org and a.user_id<>p_target
            and private.team_capability_for_user(a.user_id,org,team,'WORK')
        ) then raise exception 'Team continuity must use an existing authorized manager' using errcode='22023';end if;
      else raise exception 'Unknown continuity decision' using errcode='22023';end if;
    end loop;
  elsif p_continuity<>'[]'::jsonb then
    raise exception 'Continuity decisions apply only to office disablement' using errcode='22023';
  end if;
  select * into result from private.set_account_work_access_engine(
    p_action,p_target,p_expected_revision,p_active,p_reason,p_environment);
  insert into private.account_work_access_reviews(action_id,review_fingerprint,continuity,affected_jobs)
    values(p_action,p_review_fingerprint,p_continuity,(s->>'affected_jobs')::bigint);
  return query select result.action_id,result.target_user_id,result.active,result.revision,result.recovery_grant_id;
end; $$;

create function public.review_account_work_access(
  p_target uuid,p_active boolean,p_environment text,p_limit integer default 25,
  p_after_team uuid default null,p_expected_fingerprint text default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.review_account_work_access(p_target,p_active,p_environment,p_limit,p_after_team,p_expected_fingerprint);
$$;
create function public.set_reviewed_account_work_access(
  p_action uuid,p_target uuid,p_expected_revision uuid,p_active boolean,p_reason text,p_environment text,
  p_review_fingerprint text,p_continuity jsonb
) returns table(action_id uuid,target_user_id uuid,active boolean,revision uuid,recovery_grant_id uuid)
language sql security invoker set search_path='' as $$
  select * from private.set_reviewed_account_work_access(p_action,p_target,p_expected_revision,p_active,p_reason,p_environment,p_review_fingerprint,p_continuity);
$$;
revoke all on function private.review_account_work_access(uuid,boolean,text,integer,uuid,text),
  private.set_reviewed_account_work_access(uuid,uuid,uuid,boolean,text,text,text,jsonb),
  public.review_account_work_access(uuid,boolean,text,integer,uuid,text),
  public.set_reviewed_account_work_access(uuid,uuid,uuid,boolean,text,text,text,jsonb) from public,anon;
grant execute on function private.review_account_work_access(uuid,boolean,text,integer,uuid,text),
  private.set_reviewed_account_work_access(uuid,uuid,uuid,boolean,text,text,text,jsonb),
  public.review_account_work_access(uuid,boolean,text,integer,uuid,text),
  public.set_reviewed_account_work_access(uuid,uuid,uuid,boolean,text,text,text,jsonb) to authenticated,service_role;
