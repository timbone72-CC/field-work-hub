-- Phase 6F: audited handoff of an entirely undispatched work order.
-- Assigned, started, photo-bearing or otherwise historical work needs the
-- separate consent / exact-recovery handoff. This must not invent it.
create table private.work_order_team_handoff_actions (
  action_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  old_team_id uuid not null,
  new_team_id uuid not null,
  environment text not null check (environment in ('TEST','PRODUCTION')),
  expected_fingerprint text not null check (expected_fingerprint ~ '^[0-9a-f]{32}$'),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  source_transaction bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,old_team_id)
    references public.admin_teams(organization_id,id) on delete restrict,
  foreign key (organization_id,new_team_id)
    references public.admin_teams(organization_id,id) on delete restrict,
  check(old_team_id<>new_team_id)
);
create index work_order_team_handoffs_wo_idx
  on private.work_order_team_handoff_actions(organization_id,work_order_id,created_at);
alter table private.work_order_team_handoff_actions enable row level security;
revoke all on private.work_order_team_handoff_actions from public,anon,authenticated,service_role;

create function private.reject_work_order_handoff_audit_mutation()
returns trigger language plpgsql set search_path='' as $audit$
begin
  raise exception 'Work order handoff audit is immutable' using errcode='42501';
end;
$audit$;
revoke all on function private.reject_work_order_handoff_audit_mutation()
  from public,anon,authenticated;
create trigger work_order_team_handoff_actions_immutable
before update or delete on private.work_order_team_handoff_actions
for each row execute function private.reject_work_order_handoff_audit_mutation();

-- The original team-binding trigger remains the single guard. Only a
-- matching audit fact created *in the same transaction* can permit a change.
-- A caller-supplied GUC or a preexisting audit row never unlocks a WO.
create or replace function private.protect_responsible_team_binding() returns trigger
language plpgsql set search_path='' as $team_guard$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Work order organization identity is immutable' using errcode='42501';
  end if;
  if new.responsible_team_id is distinct from old.responsible_team_id
    and old.responsible_team_id is not null
    and not exists (
      select 1 from private.work_order_team_handoff_actions a
      where a.work_order_id=old.id
        and a.organization_id=old.organization_id
        and a.old_team_id=old.responsible_team_id
        and a.new_team_id=new.responsible_team_id
        and a.actor_id=auth.uid()
        and a.source_transaction=txid_current()
    ) then
    raise exception 'Responsible team requires a current audited handoff'
      using errcode='42501';
  end if;
  return new;
end;
$team_guard$;
revoke all on function private.protect_responsible_team_binding()
  from public,anon,authenticated;

-- Same server review is used both for preview and under lock at commit.
-- The preview is advisory until the exact fingerprint is rechecked.
create function private.work_order_team_handoff_review(
  p_work_order uuid,p_destination uuid,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' as $review$
declare
  w public.work_orders%rowtype;
  source_team public.admin_teams%rowtype;
  target_team public.admin_teams%rowtype;
  safe boolean;
  fp text;
begin
  if p_work_order is null or p_destination is null
    or p_environment is null or p_environment not in ('TEST','PRODUCTION')
    or not private.current_identity_valid() then
    raise exception 'Verified handoff inputs/session required' using errcode='42501';
  end if;
  select * into w from public.work_orders where id=p_work_order;
  if not found or w.responsible_team_id is null
    or w.responsible_team_id=p_destination
    or private.current_work_role(w.organization_id) is distinct from 'SUPERVISOR'
    or not private.has_team_capability(w.organization_id,w.responsible_team_id,'HANDOFF_TEAM')
    or not private.has_team_capability(w.organization_id,p_destination,'HANDOFF_TEAM') then
    raise exception 'Current Tier 3 authority over both active teams required'
      using errcode='42501';
  end if;
  select * into source_team from public.admin_teams t
    where t.id=w.responsible_team_id and t.organization_id=w.organization_id and t.active;
  select * into target_team from public.admin_teams t
    where t.id=p_destination and t.organization_id=w.organization_id and t.active;
  if source_team.id is null or target_team.id is null then
    raise exception 'Active same-organization handoff teams required'
      using errcode='42501';
  end if;
  -- No active person, accepted field fact, historical assignment, photograph,
  -- accepted Finish or corrective run may be moved in this narrow path.
  -- Photo-bearing moves require exact cutoff recovery for prior office scope.
  safe:=w.assigned_user_id is null and w.pending_assignee_user_id is null
    and w.field_status='ASSIGNED' and w.started_at is null
    and w.field_completed_at is null and w.current_run_sequence=1
    and not exists(select 1 from public.work_order_runs r
      where r.work_order_id=w.id and
        (r.field_status<>'ASSIGNED' or r.current_assignee_user_id is not null
          or r.started_at is not null or r.field_completed_at is not null))
    and not exists(select 1 from public.work_order_assignments a
      join public.work_order_runs r on r.id=a.run_id
      where r.work_order_id=w.id)
    and not exists(select 1 from public.photos p where p.work_order_id=w.id)
    and not exists(select 1 from public.field_actions f where f.work_order_id=w.id)
    and not exists(select 1 from public.photo_finish_sets f where f.work_order_id=w.id);
  fp:=md5(to_jsonb(w)::text || ':' || source_team.revision::text
    || ':' || target_team.revision::text || ':' || safe::text);
  return jsonb_build_object(
    'work_order_id',w.id,'organization_id',w.organization_id,
    'old_team_id',source_team.id,'old_team_name',source_team.name,
    'new_team_id',target_team.id,'new_team_name',target_team.name,
    'field_status',w.field_status,'eligible',safe,
    'block_reason',case when safe then null
      else 'Active assignments or protected history require reviewed consent and exact recovery' end,
    'review_fingerprint',fp);
end;
$review$;
revoke all on function private.work_order_team_handoff_review(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function private.work_order_team_handoff_review(uuid,uuid,text)
  to service_role;

create function public.preview_work_order_team_handoff(
  p_work_order uuid,p_destination uuid,p_environment text
) returns jsonb
language sql security definer set search_path='' as $$
  select private.work_order_team_handoff_review(p_work_order,p_destination,p_environment)
$$;
revoke all on function public.preview_work_order_team_handoff(uuid,uuid,text)
  from public,anon;
grant execute on function public.preview_work_order_team_handoff(uuid,uuid,text)
  to authenticated;

create function public.handoff_work_order_team(
  p_action uuid,p_work_order uuid,p_destination uuid,p_expected_fingerprint text,
  p_reason text,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $handoff$
declare
  previous private.work_order_team_handoff_actions%rowtype;
  reviewed jsonb;
  source_team uuid;
  org uuid;
begin
  if p_action is null or p_work_order is null or p_destination is null
    or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[0-9a-f]{32}$'
    or coalesce(char_length(btrim(p_reason)) between 1 and 1000,false)=false
    or p_environment is null or p_environment not in ('TEST','PRODUCTION') then
    raise exception 'Exact reviewed handoff inputs required' using errcode='22023';
  end if;
  perform private.lock_legacy_work_authority();
  -- Replays remain bound to the original actor, inputs and *current* tier.
  select * into previous from private.work_order_team_handoff_actions a
    where a.action_id=p_action;
  if found then
    if row(previous.work_order_id,previous.actor_id,previous.new_team_id,
      previous.expected_fingerprint,previous.reason,previous.environment)
       is distinct from
       row(p_work_order,auth.uid(),p_destination,
         p_expected_fingerprint,btrim(p_reason),p_environment) then
      raise exception 'Handoff action UUID reused with different inputs' using errcode='22023';
    end if;
    if not private.current_identity_valid()
      or private.current_work_role(previous.organization_id) is distinct from 'SUPERVISOR'
      or not private.has_team_capability(previous.organization_id,previous.old_team_id,'HANDOFF_TEAM')
      or not private.has_team_capability(previous.organization_id,previous.new_team_id,'HANDOFF_TEAM') then
      raise exception 'Current authority required for historical handoff receipt'
        using errcode='42501';
    end if;
    return jsonb_build_object('action_id',p_action,
      'work_order_id',previous.work_order_id,'old_team_id',previous.old_team_id,
      'new_team_id',previous.new_team_id,'status','HANDED_OFF');
  end if;
  -- Short locks exclude racing edits, newly accepted actions/photos and
  -- reviewed account/scope changes between validation and commit.
  lock table public.work_orders,public.work_order_runs,public.work_order_assignments,
    public.photos,public.field_actions,public.photo_finish_sets in share row exclusive mode;
  perform 1 from public.work_orders w where w.id=p_work_order for update;
  reviewed:=private.work_order_team_handoff_review(p_work_order,p_destination,p_environment);
  if (reviewed->>'review_fingerprint') is distinct from p_expected_fingerprint then
    raise exception 'Work order/team review changed; refresh before handoff' using errcode='40001';
  end if;
  if (reviewed->>'eligible')::boolean is not true then
    raise exception 'Active or protected work requires separate consent/recovery handoff'
      using errcode='42501';
  end if;
  source_team:=(reviewed->>'old_team_id')::uuid;
  org:=(reviewed->>'organization_id')::uuid;
  insert into private.work_order_team_handoff_actions(
    action_id,organization_id,work_order_id,actor_id,old_team_id,new_team_id,
    environment,expected_fingerprint,reason,source_transaction
  ) values(p_action,org,p_work_order,auth.uid(),source_team,p_destination,
    p_environment,p_expected_fingerprint,btrim(p_reason),txid_current());
  update public.work_orders set responsible_team_id=p_destination where id=p_work_order;
  return jsonb_build_object('action_id',p_action,'work_order_id',p_work_order,
    'old_team_id',source_team,'new_team_id',p_destination,'status','HANDED_OFF');
end;
$handoff$;
revoke all on function public.handoff_work_order_team(uuid,uuid,uuid,text,text,text)
  from public,anon;
grant execute on function public.handoff_work_order_team(uuid,uuid,uuid,text,text,text)
  to authenticated;
