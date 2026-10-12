-- Phase 6F: guarded Supervisor scheduling/instruction correction inside
-- the existing server work-order authority; no assignment, requirement,
-- photos, completion, handoff or delivery mutation is granted.
-- Supersede only the detail projection to expose its existing row revision.
create or replace function public.office_supervisor_work_detail(
  p_org uuid, p_work_order uuid, p_expected_scope_fingerprint text
) returns jsonb
language plpgsql security definer set search_path='' as $detail$
declare
  caller_tier smallint;
  scope_fingerprint text;
  selected jsonb;
begin
  if p_org is null or p_work_order is null
    or p_expected_scope_fingerprint is null
    or p_expected_scope_fingerprint !~ '^[0-9a-f]{32}$'
    or not private.current_identity_valid()
    or private.current_work_role(p_org) is distinct from 'SUPERVISOR'
    or not exists(select 1 from private.org_work_settings s
      where s.organization_id=p_org and s.supervisor_work_ready) then
    raise exception 'Current Supervisor work authorization required'
      using errcode='42501';
  end if;
  select g.tier into caller_tier from private.supervisor_grants g
    where g.organization_id=p_org and g.user_id=auth.uid() and g.active;
  if caller_tier is null or caller_tier not between 1 and 3 then
    raise exception 'Current Supervisor tier required' using errcode='42501';
  end if;
  -- Exact formula shared with office_supervisor_work_page; a grant/tier
  -- change refuses stale selection rather than mixing authorized scopes.
  select md5(p_org::text || '|' || caller_tier::text || '|' ||
    coalesce(string_agg(t.id::text, ',' order by t.id),''))
    into scope_fingerprint
    from public.admin_teams t where t.organization_id=p_org and t.active
      and private.has_team_capability(p_org,t.id,'WORK');
  if scope_fingerprint is distinct from p_expected_scope_fingerprint then
    raise exception 'Supervisor work scope changed; reload before viewing details'
      using errcode='40001';
  end if;
  -- Only the selected exact-team WO, never photos, release, staff or account data.
  select jsonb_build_object(
    'work_order_id',w.id,'team_id',w.responsible_team_id,'team_name',t.name,
    'wo_number',w.wo_number,'property_address',w.property_address,
    'work_type',w.work_type,'instructions',w.instructions,
    'due_date',w.due_date,'field_status',w.field_status,
    'created_at',w.created_at,'updated_at',w.updated_at,
    'work_revision',md5(to_jsonb(w)::text),'updated_at',w.updated_at
  ) into selected from public.work_orders w
    join public.admin_teams t on t.id=w.responsible_team_id
      and t.organization_id=w.organization_id and t.active
    where w.id=p_work_order and w.organization_id=p_org
      and private.has_team_capability(w.organization_id,w.responsible_team_id,'WORK');
  if selected is null then
    raise exception 'Work order unavailable in current Supervisor scope'
      using errcode='42501';
  end if;
  return jsonb_build_object('organization_id',p_org,'caller_tier',caller_tier,
    'scope_fingerprint',scope_fingerprint,'work_order',selected);
end;
$detail$;
revoke all on function public.office_supervisor_work_detail(uuid,uuid,text) from public,anon;
grant execute on function public.office_supervisor_work_detail(uuid,uuid,text) to authenticated;

create table private.supervisor_work_note_actions (
  action_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  team_id uuid not null,
  expected_scope_fingerprint text not null check(expected_scope_fingerprint ~ '^[0-9a-f]{32}$'),
  expected_updated_at timestamptz not null,
  expected_work_revision text not null check(expected_work_revision ~ '^[0-9a-f]{32}$'),
  due_date date not null,
  appended_note text not null check(char_length(appended_note)<=1000),
  reason text not null check(char_length(btrim(reason)) between 1 and 1000),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,team_id) references public.admin_teams(organization_id,id) on delete restrict
);
create index supervisor_work_notes_wo_idx on private.supervisor_work_note_actions(organization_id,work_order_id,created_at);
alter table private.supervisor_work_note_actions enable row level security;
revoke all on private.supervisor_work_note_actions from public,anon,authenticated,service_role;
create trigger supervisor_work_note_actions_immutable before update or delete
  on private.supervisor_work_note_actions for each row
  execute function private.protect_photo_transfer_ledger();

create function public.office_supervisor_correct_work_schedule(
 p_action uuid,p_org uuid,p_work_order uuid,p_expected_scope_fingerprint text,
 p_expected_updated_at timestamptz,p_expected_work_revision text,
 p_due_date date,p_append_note text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $schedule$
declare
 authorized jsonb;
 w public.work_orders%rowtype;
 prior private.supervisor_work_note_actions%rowtype;
 normalized_note text:=btrim(coalesce(p_append_note,''));
 normalized_reason text:=btrim(coalesce(p_reason,''));
 new_instructions text;
 response jsonb;
begin
 if p_action is null or p_org is null or p_work_order is null
   or p_expected_updated_at is null or p_due_date is null
   or p_expected_work_revision is null or p_expected_work_revision !~ '^[0-9a-f]{32}$'
   or p_append_note is null or char_length(normalized_note)>1000
   or coalesce(char_length(normalized_reason) between 1 and 1000,false)=false
 then raise exception 'Bounded correction action, revision and reason required' using errcode='22023';end if;
 -- Lock the same current identity/scope tables as the existing work owner,
 -- then recheck both active team authority and selected row after the lock.
 perform private.lock_legacy_work_authority();
 authorized:=public.office_supervisor_work_detail(p_org,p_work_order,p_expected_scope_fingerprint);
 select * into w from public.work_orders where id=p_work_order for update;
 if w.id is null or w.organization_id is distinct from p_org or
    w.responsible_team_id::text is distinct from authorized->'work_order'->>'team_id'
 then raise exception 'Selected work changed team scope' using errcode='42501';end if;
 select * into prior from private.supervisor_work_note_actions a
   where a.action_id=p_action;
 if prior.action_id is not null then
   if row(prior.organization_id,prior.work_order_id,prior.actor_id,prior.team_id,
       prior.expected_scope_fingerprint,prior.expected_updated_at,
       prior.expected_work_revision,prior.due_date,prior.appended_note,prior.reason)
       is distinct from row(p_org,p_work_order,auth.uid(),w.responsible_team_id,
         p_expected_scope_fingerprint,p_expected_updated_at,
         p_expected_work_revision,p_due_date,
         normalized_note,normalized_reason)
   then raise exception 'Changed Supervisor correction action identity' using errcode='40001';end if;
   return prior.result;
 end if;
 if w.updated_at is distinct from p_expected_updated_at
    or md5(to_jsonb(w)::text) is distinct from p_expected_work_revision
 then raise exception 'Work order changed; reload before correction' using errcode='40001';end if;
 if w.field_status not in ('ASSIGNED','IN_PROGRESS')
 then raise exception 'Completed or cancelled work cannot be corrected here' using errcode='40001';end if;
 if p_due_date is not distinct from w.due_date and normalized_note=''
 then raise exception 'No schedule or instruction correction supplied' using errcode='22023';end if;
 new_instructions:=concat_ws(E'\n',nullif(w.instructions,''),nullif(normalized_note,''));
 if char_length(new_instructions)>4000
 then raise exception 'Instructions exceed approved bounded field' using errcode='22023';end if;
 -- Only two non-identity columns may change; the current assignment, Run,
 -- requirements, status, responsible team, package and photo state stay put.
 update public.work_orders
    set due_date=p_due_date,
        instructions=nullif(new_instructions,''),
        updated_at=clock_timestamp()
    where id=w.id returning * into w;
 response:=jsonb_build_object('action_id',p_action,'work_order_id',w.id,
    'team_id',w.responsible_team_id,'due_date',w.due_date,
    'instructions',w.instructions,'updated_at',w.updated_at,
    'work_revision',md5(to_jsonb(w)::text),'status','SAVED');
 insert into private.supervisor_work_note_actions(
    action_id,organization_id,work_order_id,actor_id,team_id,
    expected_scope_fingerprint,expected_updated_at,expected_work_revision,
    due_date,appended_note,reason,result)
 values(p_action,p_org,w.id,auth.uid(),w.responsible_team_id,
    p_expected_scope_fingerprint,p_expected_updated_at,p_expected_work_revision,
    p_due_date,normalized_note,normalized_reason,response);
 return response;
end;
$schedule$;
revoke all on function public.office_supervisor_correct_work_schedule(
 uuid,uuid,uuid,text,timestamptz,text,date,text,text) from public,anon;
grant execute on function public.office_supervisor_correct_work_schedule(
 uuid,uuid,uuid,text,timestamptz,text,date,text,text) to authenticated;
