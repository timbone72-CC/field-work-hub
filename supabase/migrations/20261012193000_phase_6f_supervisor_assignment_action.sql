-- Phase 6F: Supervisor assignment/reassignment through exact scoped work authority.
-- ASSIGNED work changes immediately through the existing work_order run-sync trigger.
-- IN_PROGRESS work only records the proposed assignee; the current Contractor
-- remains authoritative until the existing respond_reassignment consent path accepts it.
create table private.supervisor_assignment_actions (
  action_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  requested_assignee_user_id uuid not null references auth.users(id) on delete restrict,
  request_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
revoke all on private.supervisor_assignment_actions from public,anon,authenticated;
grant all on private.supervisor_assignment_actions to service_role;

create function public.office_supervisor_assign_work(
  p_action uuid,p_org uuid,p_work_order uuid,p_assignee uuid,
  p_expected_scope_fingerprint text,p_expected_work_revision text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $assign$
declare
  caller_tier smallint; scope_fingerprint text; request_fingerprint text;
  prior private.supervisor_assignment_actions%rowtype;
  w public.work_orders%rowtype; outcome jsonb;
begin
  if p_action is null or p_org is null or p_work_order is null or p_assignee is null
    or p_expected_scope_fingerprint !~ '^[0-9a-f]{32}$'
    or p_expected_work_revision !~ '^[0-9a-f]{32}$'
    or nullif(btrim(coalesce(p_reason,'')),'') is null or length(p_reason)>1000
    or not private.current_identity_valid()
    or private.current_work_role(p_org) is distinct from 'SUPERVISOR'
    or not exists(select 1 from private.org_work_settings s
      where s.organization_id=p_org and s.supervisor_work_ready)
  then raise exception 'Exact current Supervisor assignment authority required' using errcode='42501'; end if;

  select g.tier into caller_tier from private.supervisor_grants g
   where g.organization_id=p_org and g.user_id=auth.uid() and g.active;
  if caller_tier is null or caller_tier not between 1 and 3 then
    raise exception 'Current Supervisor tier required' using errcode='42501'; end if;

  select md5(p_org::text||'|'||caller_tier::text||'|'||
    coalesce(string_agg(t.id::text,',' order by t.id),''))
  into scope_fingerprint from public.admin_teams t
  where t.organization_id=p_org and t.active
    and private.has_team_capability(p_org,t.id,'WORK');
  if scope_fingerprint is distinct from p_expected_scope_fingerprint then
    raise exception 'Supervisor work scope changed; reload before assignment' using errcode='40001'; end if;

  request_fingerprint:=md5(concat_ws('|',p_org,p_work_order,p_assignee,
    p_expected_scope_fingerprint,p_expected_work_revision,btrim(p_reason)));
  perform pg_advisory_xact_lock(hashtextextended('fwh.supervisor.assign.'||p_action::text,0));
  select * into prior from private.supervisor_assignment_actions where action_id=p_action;
  if found then
    if prior.actor_id is distinct from auth.uid()
      or prior.organization_id is distinct from p_org
      or prior.request_fingerprint is distinct from request_fingerprint
    then raise exception 'Assignment action conflict' using errcode='40001'; end if;
    return prior.result;
  end if;

  select * into w from public.work_orders where id=p_work_order for update;
  if not found or w.organization_id is distinct from p_org
    or w.responsible_team_id is null
    or not private.has_team_capability(p_org,w.responsible_team_id,'WORK')
  then raise exception 'Work order unavailable in current Supervisor scope' using errcode='42501'; end if;
  if md5(to_jsonb(w)::text) is distinct from p_expected_work_revision then
    raise exception 'Work order changed; reload before assignment' using errcode='40001'; end if;
  if w.field_status not in ('ASSIGNED','IN_PROGRESS') then
    raise exception 'Completed or cancelled work cannot be reassigned' using errcode='22023'; end if;
  if p_assignee is not distinct from w.assigned_user_id then
    raise exception 'Contractor is already assigned to this work order' using errcode='22023'; end if;
  if not exists(
    select 1 from private.contractor_team_memberships m
    join private.account_work_access a
      on a.organization_id=m.organization_id and a.user_id=m.user_id
    join auth.users u on u.id=m.user_id
    where m.organization_id=p_org and m.team_id=w.responsible_team_id
      and m.user_id=p_assignee and m.active
      and a.work_role='CONTRACTOR' and a.active and a.disabled_at is null
      and a.suspension_authority is null and u.deleted_at is null
      and u.email_confirmed_at is not null
      and private.is_assignable_contractor(u.id,p_org)
  ) then raise exception 'Contractor is no longer eligible for this team' using errcode='42501'; end if;

  if w.field_status='ASSIGNED' then
    update public.work_orders set assigned_user_id=p_assignee,
      assignment_received_at=null,pending_assignee_user_id=null,reassignment_requested_at=null
      where id=w.id returning * into w;
    outcome:=jsonb_build_object('status','ASSIGNED','action_id',p_action,
      'work_order_id',w.id,'assigned_user_id',w.assigned_user_id,
      'pending_assignee_user_id',w.pending_assignee_user_id,
      'work_revision',md5(to_jsonb(w)::text));
  else
    update public.work_orders set pending_assignee_user_id=p_assignee,
      reassignment_requested_at=clock_timestamp()
      where id=w.id returning * into w;
    outcome:=jsonb_build_object('status','CONSENT_REQUIRED','action_id',p_action,
      'work_order_id',w.id,'assigned_user_id',w.assigned_user_id,
      'pending_assignee_user_id',w.pending_assignee_user_id,
      'work_revision',md5(to_jsonb(w)::text));
  end if;

  insert into private.supervisor_assignment_actions(
    action_id,organization_id,actor_id,work_order_id,requested_assignee_user_id,
    request_fingerprint,result)
  values(p_action,p_org,auth.uid(),p_work_order,p_assignee,request_fingerprint,outcome);
  return outcome;
end;
$assign$;
revoke all on function public.office_supervisor_assign_work(uuid,uuid,uuid,uuid,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.office_supervisor_assign_work(uuid,uuid,uuid,uuid,text,text,text)
 to authenticated;
