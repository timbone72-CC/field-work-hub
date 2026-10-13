-- Source-only Phase 6F: completed-field-work handoff and exact old-office photo cutoff.
-- Does not move Contractors, change field/run/photo identity, Send, or permit started work.
alter table private.photo_recovery_grants
  add column scope_work_order_id uuid references public.work_orders(id) on delete restrict;
create index photo_recovery_grants_scope_wo_idx on private.photo_recovery_grants(scope_work_order_id)
  where scope_work_order_id is not null;

create function private.freeze_photo_recovery_scope(
  p_action uuid,p_org uuid,p_user uuid,p_expected_access uuid,p_removed_teams uuid[],p_reason text,p_work_order uuid
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
    if row(prior.organization_id,prior.user_id,prior.access_revision,prior.removed_team_ids,prior.reason,prior.scope_work_order_id)
      is distinct from row(p_org,p_user,p_expected_access,teams,btrim(p_reason),p_work_order) then
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
  if p_work_order is not null and (work_role='CONTRACTOR' or not exists(
    select 1 from public.work_orders w where w.id=p_work_order
      and w.organization_id=p_org and w.responsible_team_id=any(teams))) then
    raise exception 'Exact work order is outside the reviewed office cutoff' using errcode='42501';
  end if;
  insert into private.photo_recovery_grants(action_id,organization_id,user_id,access_revision,source_role,removed_team_ids,reason,actor_user_id,scope_work_order_id)
    values(p_action,p_org,p_user,p_expected_access,work_role,teams,btrim(p_reason),auth.uid(),p_work_order);
  insert into private.photo_recovery_members(grant_id,organization_id,user_id,photo_id,work_order_id,run_id,
    captured_by,captured_at,finish_set_id,assignment_instance_id,requirement_revision,finish_digest,accepted_finish_at_cutoff)
    select p_action,p_org,p_user,p.id,p.work_order_id,p.run_id,p.captured_by,p.captured_at,
      p.finish_set_id,p.assignment_instance_id,p.requirement_revision,f.digest,private.photo_has_accepted_finish(p.id)
    from public.photos p join public.work_orders w on w.id=p.work_order_id
    left join public.photo_finish_sets f on f.id=p.finish_set_id
    where w.organization_id=p_org and (p_work_order is null or w.id=p_work_order) and
      ((work_role='CONTRACTOR' and p.captured_by=p_user) or
       (work_role in ('ADMIN','SUPERVISOR') and w.responsible_team_id=any(teams)));
  get diagnostics n=row_count;
  update private.photo_recovery_grants set member_count=n where action_id=p_action;
  return p_action;
end;
$$;

-- The existing six-argument owner delegates to the same exact-cutoff implementation.
-- Existing whole-team disablement behavior is unchanged; only the internal overload can narrow to one WO.
create or replace function private.freeze_photo_recovery_scope(
  p_action uuid,p_org uuid,p_user uuid,p_expected_access uuid,p_removed_teams uuid[],p_reason text
) returns uuid language sql security definer set search_path='' as $$
  select private.freeze_photo_recovery_scope(p_action,p_org,p_user,p_expected_access,p_removed_teams,p_reason,null)
$$;
revoke all on function private.freeze_photo_recovery_scope(uuid,uuid,uuid,uuid,uuid[],text,uuid)
  from public,anon,authenticated;
grant execute on function private.freeze_photo_recovery_scope(uuid,uuid,uuid,uuid,uuid[],text,uuid) to service_role;

create or replace function private.protect_photo_recovery_header() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Recovery snapshot cannot be deleted' using errcode='42501';end if;
  if row(new.action_id,new.organization_id,new.user_id,new.access_revision,new.source_role,
    new.removed_team_ids,new.reason,new.cutoff_at,new.actor_user_id,new.operator_role,new.scope_work_order_id)
    is distinct from row(old.action_id,old.organization_id,old.user_id,old.access_revision,old.source_role,
    old.removed_team_ids,old.reason,old.cutoff_at,old.actor_user_id,old.operator_role,old.scope_work_order_id)
    or (old.state='READY' and new is distinct from old)
    or (new.member_count<>old.member_count and (old.state<>'PENDING' or old.member_count<>0
      or new.member_count<>(select count(*) from private.photo_recovery_members where grant_id=old.action_id))) then
    raise exception 'Recovery cutoff header is immutable' using errcode='42501';end if;
  return new;
end;
$$;
alter table private.work_order_team_handoff_actions
  add column original_run_id uuid references public.work_order_runs(id) on delete restrict,
  add column original_assignment_id uuid references public.work_order_assignments(id) on delete restrict,
  add column original_assignee_id uuid references auth.users(id) on delete restrict,
  add column handoff_kind text not null default 'UNDISPATCHED'
    check(handoff_kind in ('UNDISPATCHED','FIELD_COMPLETE'));

-- Recipient identities stay backend-private. Expose only count in the operator's preview.
create function private.handoff_recovery_recipients(p_org uuid,p_source uuid,p_target uuid)
returns table(user_id uuid,access_revision uuid)
language sql stable security definer set search_path='' as $$
  select a.user_id,a.revision from private.account_work_access a
  where a.organization_id=p_org and a.work_role in ('ADMIN','SUPERVISOR')
    and private.team_capability_for_user(a.user_id,p_org,p_source,'WORK')
    and not private.team_capability_for_user(a.user_id,p_org,p_target,'WORK')
  order by a.user_id
$$;
revoke all on function private.handoff_recovery_recipients(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function private.work_order_team_handoff_review(
  p_work_order uuid,p_destination uuid,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' as $review$
declare
  w public.work_orders%rowtype;
  source_team public.admin_teams%rowtype;
  target_team public.admin_teams%rowtype;
  safe boolean;
  fp text; complete_safe boolean; recipients jsonb; photo_facts jsonb; run_facts jsonb;
  assignment_id uuid;
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
  select a.id into assignment_id from public.work_order_assignments a
    where a.run_id=w.current_run_id and a.assigned_user_id=w.assigned_user_id
      and a.end_reason='FIELD_COMPLETE' order by a.assignment_started_at desc,a.created_at desc,a.id desc limit 1;
  complete_safe:=w.field_status='FIELD_COMPLETE' and w.pending_assignee_user_id is null
    and w.assigned_user_id is not null and assignment_id is not null
    and exists(select 1 from public.work_order_runs r where r.id=w.current_run_id
      and r.work_order_id=w.id and r.field_status='FIELD_COMPLETE'
      and r.current_assignee_user_id=w.assigned_user_id)
    and exists(select 1 from public.field_actions f where f.work_order_id=w.id
      and f.run_id=w.current_run_id and f.assignment_instance_id=assignment_id
      and f.action_kind='COMPLETE' and f.result->>'outcome' in ('APPLIED','ALREADY_APPLIED'))
    and not exists(select 1 from public.work_order_runs r where r.work_order_id=w.id
      and r.field_status in ('ASSIGNED','IN_PROGRESS'))
    and not exists(select 1 from public.photos p where p.work_order_id=w.id
      and not private.photo_has_accepted_finish(p.id))
    and not exists(select 1 from private.client_packages k where k.work_order_id=w.id
      and k.status in ('QUEUED','DELIVERING','UNCERTAIN','FAILED'));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.user_id),'[]'::jsonb) into recipients
    from private.handoff_recovery_recipients(w.organization_id,source_team.id,target_team.id) r;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) into photo_facts
    from public.photos p where p.work_order_id=w.id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) into run_facts
    from public.work_order_runs r where r.work_order_id=w.id;
  fp:=md5(to_jsonb(w)::text || ':' || source_team.revision::text
    || ':' || target_team.revision::text || ':' || safe::text || ':' || complete_safe::text
    || ':' || recipients::text || ':' || photo_facts::text || ':' || run_facts::text);
  return jsonb_build_object(
    'work_order_id',w.id,'organization_id',w.organization_id,
    'old_team_id',source_team.id,'old_team_name',source_team.name,
    'new_team_id',target_team.id,'new_team_name',target_team.name,
    'field_status',w.field_status,'eligible',safe or complete_safe,
    'handoff_kind',case when complete_safe then 'FIELD_COMPLETE' else 'UNDISPATCHED' end,
    'recovery_recipient_count',case when complete_safe then jsonb_array_length(recipients) else 0 end,
    'protected_photo_count',case when complete_safe then jsonb_array_length(photo_facts) else 0 end,
    'original_run_id',case when complete_safe then w.current_run_id else null end,
    'original_assignment_id',case when complete_safe then assignment_id else null end,
    'original_assignee_id',case when complete_safe then w.assigned_user_id else null end,
    'block_reason',case when safe or complete_safe then null
      else 'Active assignments need consent; incomplete evidence or unresolved delivery must be reconciled' end,
    'review_fingerprint',fp);
end;
$review$;

create or replace function public.handoff_work_order_team(
  p_action uuid,p_work_order uuid,p_destination uuid,p_expected_fingerprint text,
  p_reason text,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $handoff$
declare
  previous private.work_order_team_handoff_actions%rowtype;
  reviewed jsonb;
  source_team uuid;
  org uuid; recipient record; grant_id uuid;
begin
  if p_action is null or p_work_order is null or p_destination is null
    or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[0-9a-f]{32}$'
    or coalesce(char_length(btrim(p_reason)) between 1 and 1000,false)=false
    or p_environment is null or p_environment not in ('TEST','PRODUCTION') then
    raise exception 'Exact reviewed handoff inputs required' using errcode='22023';
  end if;
  -- Match cutoff/lifecycle ordering before upgrading grant/work locks.
  lock table private.photo_recovery_grants in share row exclusive mode;
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
  lock table private.client_packages in share mode;
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
    environment,expected_fingerprint,reason,source_transaction,original_run_id,original_assignment_id,original_assignee_id,handoff_kind
  ) values(p_action,org,p_work_order,auth.uid(),source_team,p_destination,
    p_environment,p_expected_fingerprint,btrim(p_reason),txid_current(),
    (reviewed->>'original_run_id')::uuid,(reviewed->>'original_assignment_id')::uuid,
    (reviewed->>'original_assignee_id')::uuid,reviewed->>'handoff_kind');
  if reviewed->>'handoff_kind'='FIELD_COMPLETE' then
    for recipient in select * from private.handoff_recovery_recipients(org,source_team,p_destination) loop
      grant_id:=private.freeze_photo_recovery_scope(gen_random_uuid(),org,recipient.user_id,
        recipient.access_revision,array[source_team],btrim(p_reason),p_work_order);
      perform private.complete_photo_recovery_grant(grant_id);
    end loop;
  end if;
  update public.work_orders set responsible_team_id=p_destination where id=p_work_order;
  return jsonb_build_object('action_id',p_action,'work_order_id',p_work_order,
    'old_team_id',source_team,'new_team_id',p_destination,'status','HANDED_OFF');
end;
$handoff$;
revoke all on function public.handoff_work_order_team(uuid,uuid,uuid,text,text,text)
  from public,anon;
grant execute on function public.handoff_work_order_team(uuid,uuid,uuid,text,text,text)
  to authenticated;

-- One exact completed-assignment exception, shared by RLS and the existing
-- durable download receipt owner. No new field action/capture permission.
create function private.completed_handoff_assignment_for_user(p_user uuid,p_work_order uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.work_orders w
    join private.work_order_team_handoff_actions h on h.work_order_id=w.id and h.organization_id=w.organization_id
    join public.work_order_assignments a on a.id=h.original_assignment_id
    where w.id=p_work_order and w.field_status='FIELD_COMPLETE' and w.assigned_user_id=p_user
      and h.handoff_kind='FIELD_COMPLETE' and h.original_run_id=w.current_run_id
      and h.original_assignee_id=p_user and a.run_id=w.current_run_id
      and a.assigned_user_id=p_user and a.end_reason='FIELD_COMPLETE')
$$;
revoke all on function private.completed_handoff_assignment_for_user(uuid,uuid) from public,anon,authenticated;

-- Completed original owners retain only their exact completed assignment read.
-- This does NOT authorize START/Finish/capture/edit/human Accept or a later run.
create or replace function private.can_read_work_order(p_work_order uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_identity_valid() and exists(select 1 from public.work_orders w
    join public.admin_teams t on t.id=w.responsible_team_id and t.organization_id=w.organization_id and t.active
    where w.id=p_work_order and private.current_operational_identity(w.organization_id) and (
      private.has_team_capability(w.organization_id,w.responsible_team_id,'WORK')
      or (private.current_work_role(w.organization_id)='CONTRACTOR' and w.assigned_user_id=auth.uid()
        and (private.contractor_current_team(auth.uid(),w.organization_id)=w.responsible_team_id
          or private.completed_handoff_assignment_for_user(auth.uid(),w.id)))));
$$;

-- A delayed download receipt for the unchanged completed instance must not
-- strand an Android refresh. Reuse the retained receipt engine, never human ACK.
create or replace function private.acknowledge_assignment_received(p_work_order_id uuid)
returns table(work_order_id uuid,assignment_received_at timestamptz)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare org uuid;
begin
  perform private.lock_legacy_work_authority();
  org:=private.legacy_work_org('CONTRACTOR');
  perform 1 from public.work_orders w where w.id=p_work_order_id and w.organization_id=org for update;
  if private.completed_handoff_assignment_for_user(auth.uid(),p_work_order_id)
    and private.can_read_work_order(p_work_order_id) then
    return query select * from private.acknowledge_assignment_received_phase4_engine(p_work_order_id);
  else
    perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
    return query select * from private.acknowledge_assignment_received_phase4_engine(p_work_order_id);
  end if;
end;$$;

-- Receiving Admin retains legacy edit continuity only for this unchanged completed assignee.
create or replace function private.admin_update_work_order(p_work_order_id uuid, p_wo_number text, p_property_address text, p_work_type text, p_instructions text, p_due_date date, p_assigned_user_id uuid) returns TABLE(work_order_id uuid, organization_id uuid, assigned_user_id uuid, pending_assignee_user_id uuid, reassignment_requested_at timestamp with time zone, wo_number text, property_address text, work_type text, instructions text, due_date date, field_status text, updated_at timestamp with time zone)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'ADMIN');
  if p_assigned_user_id is distinct from (select w.assigned_user_id from public.work_orders w where w.id=p_work_order_id) then
    if private.legacy_dispatch_team(private.phase4_admin_org(),p_assigned_user_id) is distinct from (select w.responsible_team_id from public.work_orders w where w.id=p_work_order_id) then
      raise exception 'Reassignment must retain responsible team' using errcode='42501';end if;
  elsif private.work_role_for_user(p_assigned_user_id,private.phase4_admin_org())='CONTRACTOR' then
    if private.contractor_current_team(p_assigned_user_id,private.phase4_admin_org()) is distinct from (select w.responsible_team_id from public.work_orders w where w.id=p_work_order_id)
      and not private.completed_handoff_assignment_for_user(p_assigned_user_id,p_work_order_id) then
      raise exception 'Current Contractor unavailable in responsible team' using errcode='42501';end if;
  end if;
  return query select * from private.admin_update_work_order_phase4_engine(p_work_order_id,p_wo_number,p_property_address,p_work_type,p_instructions,p_due_date,p_assigned_user_id);
end; $$;

-- Receiving Admin retains legacy edit continuity only for this unchanged completed assignee.
create or replace function private.admin_update_work_order_v4(p_work_order_id uuid, p_wo_number text, p_property_address text, p_work_type text, p_instructions text, p_due_date date, p_assigned_user_id uuid, p_expected_revision uuid, p_requirements jsonb) returns SETOF jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform private.guard_legacy_work_order(p_work_order_id,'ADMIN');
  if p_assigned_user_id is distinct from (select w.assigned_user_id from public.work_orders w where w.id=p_work_order_id) then
    if private.legacy_dispatch_team(private.phase4_admin_org(),p_assigned_user_id) is distinct from (select w.responsible_team_id from public.work_orders w where w.id=p_work_order_id) then
      raise exception 'Reassignment must retain responsible team' using errcode='42501';end if;
  elsif private.work_role_for_user(p_assigned_user_id,private.phase4_admin_org())='CONTRACTOR' then
    if private.contractor_current_team(p_assigned_user_id,private.phase4_admin_org()) is distinct from (select w.responsible_team_id from public.work_orders w where w.id=p_work_order_id)
      and not private.completed_handoff_assignment_for_user(p_assigned_user_id,p_work_order_id) then
      raise exception 'Current Contractor unavailable in responsible team' using errcode='42501';end if;
  end if;
  return query select * from private.admin_update_work_order_v4_phase4_engine(p_work_order_id,p_wo_number,p_property_address,p_work_type,p_instructions,p_due_date,p_assigned_user_id,p_expected_revision,p_requirements);
end; $$;


-- Phase 6F: separate, exact-instance Contractor consent for an office-team move.
-- This does not authorize an active handoff by itself. The guarded handoff
-- transaction must separately consume consent and retain the original assignment.
create table private.work_order_team_handoff_consent_requests (
  request_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  source_team_id uuid not null,
  target_team_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  contractor_id uuid not null references auth.users(id) on delete restrict,
  run_id uuid not null references public.work_order_runs(id) on delete restrict,
  assignment_id uuid not null references public.work_order_assignments(id) on delete restrict,
  expected_fingerprint text not null check(expected_fingerprint ~ '^[0-9a-f]{32}$'),
  reason text not null check(char_length(btrim(reason)) between 1 and 1000),
  environment text not null check(environment in ('TEST','PRODUCTION')),
  decision text not null default 'PENDING'
    check(decision in ('PENDING','APPROVED','DECLINED','SUPERSEDED','CONSUMED')),
  decided_by uuid references auth.users(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  consumed_action_id uuid,
  foreign key(organization_id,source_team_id)
    references public.admin_teams(organization_id,id) on delete restrict,
  foreign key(organization_id,target_team_id)
    references public.admin_teams(organization_id,id) on delete restrict,
  check(source_team_id<>target_team_id),
  check((decision='PENDING' and decided_at is null and decided_by is null)
    or (decision<>'PENDING')),
  check((consumed_action_id is null) or decision='CONSUMED')
);
create unique index work_order_team_handoff_one_live_consent
 on private.work_order_team_handoff_consent_requests(work_order_id)
 where decision in ('PENDING','APPROVED');
create index work_order_team_handoff_consent_contractor
 on private.work_order_team_handoff_consent_requests(contractor_id,decision,work_order_id);
alter table private.work_order_team_handoff_consent_requests enable row level security;
revoke all on private.work_order_team_handoff_consent_requests from public,anon,authenticated,service_role;

-- The same Tier 3 review/fingerprint is mandatory before requesting consent.
-- A consent request is deliberately not a WO move or a new assignment.
create function public.request_work_order_team_handoff_consent(
 p_request uuid,p_work_order uuid,p_destination uuid,p_expected_fingerprint text,
 p_reason text,p_environment text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $consent$
declare v public.work_orders%rowtype; a public.work_order_assignments%rowtype;
  r private.work_order_team_handoff_consent_requests%rowtype; reviewed jsonb;
begin
 if p_request is null or p_work_order is null or p_destination is null
   or p_expected_fingerprint !~ '^[0-9a-f]{32}$'
   or coalesce(char_length(btrim(p_reason)) between 1 and 1000,false)=false
   or p_environment not in ('TEST','PRODUCTION') then
   raise exception 'Exact active handoff request required' using errcode='22023';end if;
 perform private.lock_legacy_work_authority();
 select * into v from public.work_orders where id=p_work_order for update;
 reviewed:=private.work_order_team_handoff_review(p_work_order,p_destination,p_environment);
 if (reviewed->>'review_fingerprint') is distinct from p_expected_fingerprint then
   raise exception 'Active handoff review changed' using errcode='40001';end if;
 select * into r from private.work_order_team_handoff_consent_requests where request_id=p_request;
 if found then
   if row(r.work_order_id,r.source_team_id,r.target_team_id,r.requested_by,r.expected_fingerprint,r.reason,r.environment)
     is distinct from row(p_work_order,v.responsible_team_id,p_destination,auth.uid(),p_expected_fingerprint,btrim(p_reason),p_environment)
     then raise exception 'Consent request ID reused with changed inputs' using errcode='22023';end if;
   return jsonb_build_object('request_id',p_request,'status',r.decision,'work_order_id',p_work_order);
 end if;
 if v.field_status<>'IN_PROGRESS' or v.assigned_user_id is null
   or v.pending_assignee_user_id is not null or v.current_run_id is null
   or v.started_at is null or v.field_completed_at is not null
   or private.contractor_current_team(v.assigned_user_id,v.organization_id)
       is distinct from v.responsible_team_id
   or exists(select 1 from public.work_order_runs x where x.work_order_id=v.id
       and x.id<>v.current_run_id and x.field_status in ('ASSIGNED','IN_PROGRESS'))
   or exists(select 1 from private.client_packages k where k.work_order_id=v.id
       and k.status in ('QUEUED','DELIVERING','UNCERTAIN','FAILED')) then
   raise exception 'Only current in-progress original assignments can request team consent'
     using errcode='42501';end if;
 select * into a from public.work_order_assignments
   where run_id=v.current_run_id and assigned_user_id=v.assigned_user_id
     and assignment_ended_at is null order by assignment_started_at desc limit 1;
 if not found then raise exception 'Original active assignment missing' using errcode='42501';end if;
 -- An outdated approval may not authorize a new request. A fresh reviewed
 -- fingerprint supersedes it atomically; the old UUID can never be approved.
 update private.work_order_team_handoff_consent_requests c
   set decision='SUPERSEDED'
   where c.work_order_id=p_work_order and c.decision in ('PENDING','APPROVED')
     and c.expected_fingerprint is distinct from p_expected_fingerprint;
 if exists(select 1 from private.work_order_team_handoff_consent_requests c
   where c.work_order_id=p_work_order and c.decision in ('PENDING','APPROVED')) then
   raise exception 'Existing consent request must be resolved before another'
     using errcode='40001';end if;
 insert into private.work_order_team_handoff_consent_requests(
   request_id,organization_id,work_order_id,source_team_id,target_team_id,requested_by,
   contractor_id,run_id,assignment_id,expected_fingerprint,reason,environment)
 values(p_request,v.organization_id,p_work_order,v.responsible_team_id,p_destination,auth.uid(),
   v.assigned_user_id,v.current_run_id,a.id,p_expected_fingerprint,btrim(p_reason),p_environment);
 return jsonb_build_object('request_id',p_request,'status','PENDING',
   'work_order_id',p_work_order);
end;$consent$;
revoke all on function public.request_work_order_team_handoff_consent(uuid,uuid,uuid,text,text,text)
  from public,anon;
grant execute on function public.request_work_order_team_handoff_consent(uuid,uuid,uuid,text,text,text)
  to authenticated;

-- Online-only Contractor prompt; no old team roster, destination credentials or
-- photo access is returned. It never exposes another Contractor's requests.
create function public.pending_work_order_team_handoff_consents()
returns setof jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('request_id',c.request_id,'work_order_id',c.work_order_id)
 from private.work_order_team_handoff_consent_requests c
 join public.work_orders w on w.id=c.work_order_id and w.organization_id=c.organization_id
 where c.contractor_id=auth.uid() and c.decision='PENDING'
   and w.current_run_id=c.run_id and w.assigned_user_id=c.contractor_id
   and w.responsible_team_id=c.source_team_id and w.field_status='IN_PROGRESS'
   and w.pending_assignee_user_id is null
   and private.current_operational_identity(c.organization_id)
   and private.current_work_role(c.organization_id)='CONTRACTOR'
   and private.contractor_current_team(auth.uid(),c.organization_id)=c.source_team_id
 order by c.requested_at,c.request_id
$$;
revoke all on function public.pending_work_order_team_handoff_consents() from public,anon;
grant execute on function public.pending_work_order_team_handoff_consents() to authenticated;

-- This is affirmative consent to move office responsibility, *not* reassignment
-- consent and not an authorization to discard locally captured work.
create function public.respond_work_order_team_handoff_consent(p_request uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $respond$
declare c private.work_order_team_handoff_consent_requests%rowtype;
  v public.work_orders%rowtype; reviewed jsonb; a public.work_order_assignments%rowtype;
begin
 if p_request is null or p_accept is null then
   raise exception 'Exact consent response required' using errcode='22023';end if;
 perform private.lock_legacy_work_authority();
 select * into c from private.work_order_team_handoff_consent_requests where request_id=p_request;
 if not found or c.contractor_id is distinct from auth.uid()
    or not private.current_operational_identity(c.organization_id)
    or private.current_work_role(c.organization_id)<>'CONTRACTOR' then
   raise exception 'Current original Contractor required' using errcode='42501';end if;
 select * into v from public.work_orders where id=c.work_order_id for update;
 select * into c from private.work_order_team_handoff_consent_requests where request_id=p_request for update;
 if c.decision in ('APPROVED','DECLINED') then
   if (c.decision='APPROVED') is distinct from p_accept then
     raise exception 'Consent response cannot be changed' using errcode='22023';end if;
   return jsonb_build_object('request_id',p_request,'status',c.decision,'work_order_id',c.work_order_id);
 end if;
 if c.decision<>'PENDING' then raise exception 'Consent request is no longer pending' using errcode='40001';end if;
 if v.organization_id is distinct from c.organization_id
   or v.responsible_team_id is distinct from c.source_team_id
   or v.current_run_id is distinct from c.run_id or v.assigned_user_id is distinct from c.contractor_id
   or private.contractor_current_team(auth.uid(),c.organization_id) is distinct from c.source_team_id
   or v.field_status<>'IN_PROGRESS' or v.pending_assignee_user_id is not null then
   raise exception 'Original assignment or authority changed' using errcode='40001';end if;
 select * into a from public.work_order_assignments where id=c.assignment_id;
 if not found or a.run_id<>c.run_id or a.assigned_user_id<>c.contractor_id or a.assignment_ended_at is not null then
   raise exception 'Original assignment instance changed' using errcode='40001';end if;
 if p_accept then
   -- Requires current manager scope and unchanged reviewed work/photo facts;
   -- the caller cannot approve an arbitrary destination or stale request.
   -- An actual move still needs a separate fresh Tier-3 confirmation.
   reviewed:=private.work_order_team_handoff_review(c.work_order_id,c.target_team_id,c.environment);
   if reviewed->>'review_fingerprint' is distinct from c.expected_fingerprint then
     raise exception 'Reviewed handoff facts changed; office must request again' using errcode='40001';end if;
 end if;
 update private.work_order_team_handoff_consent_requests set
   decision=case when p_accept then 'APPROVED' else 'DECLINED' end,
   decided_by=auth.uid(),decided_at=clock_timestamp()
 where request_id=p_request;
 return jsonb_build_object('request_id',p_request,'status',
   case when p_accept then 'APPROVED' else 'DECLINED' end,'work_order_id',c.work_order_id);
end;$respond$;
revoke all on function public.respond_work_order_team_handoff_consent(uuid,boolean) from public,anon;
grant execute on function public.respond_work_order_team_handoff_consent(uuid,boolean) to authenticated;
