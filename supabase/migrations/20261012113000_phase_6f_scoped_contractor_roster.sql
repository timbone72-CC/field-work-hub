-- Approved Phase 6F: bounded, audited Contractor roster placement / idle transfer.
-- This operation NEVER moves an existing WO, run, assignment, photo, Finish,
-- package or client destination. Busy-worker handoff is a separate approved gate.
create table private.contractor_roster_actions (
 action_id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 old_team_id uuid,
 new_team_id uuid not null,
 expected_revision uuid,
 result_revision uuid not null,
 action_kind text not null check(action_kind in ('PLACE','TRANSFER')),
 reason text not null check(char_length(btrim(reason)) between 1 and 1000),
 environment text not null check(environment in ('TEST','PRODUCTION')),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(organization_id,new_team_id) references public.admin_teams(organization_id,id) on delete restrict
);
create index contractor_roster_actor_idx on private.contractor_roster_actions(organization_id,user_id,created_at);
create function private.protect_contractor_roster_action() returns trigger
language plpgsql set search_path='' as $roster_audit$
begin
  raise exception 'Contractor roster action history is immutable' using errcode='42501';
  return old;
end;
$roster_audit$;
revoke all on function private.protect_contractor_roster_action() from public,anon,authenticated;
create trigger contractor_roster_actions_immutable
 before update or delete on private.contractor_roster_actions
 for each row execute function private.protect_contractor_roster_action();

alter table private.contractor_roster_actions enable row level security;
revoke all on private.contractor_roster_actions from public,anon,authenticated,service_role;
grant select,insert on private.contractor_roster_actions to service_role;

create function public.manage_idle_contractor_roster(
 p_action uuid,p_org uuid,p_user uuid,p_team uuid,p_expected_revision uuid,
 p_reason text,p_environment text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 prior private.contractor_roster_actions%rowtype;
 membership private.contractor_team_memberships%rowtype;
 access_row private.account_work_access%rowtype;
 previous_team uuid;
 kind text;
 next_revision uuid:=gen_random_uuid();
 limit_value integer;
 used_count integer;
 pending_count integer;
 result jsonb;
begin
 if p_action is null or p_org is null or p_user is null or p_team is null
  or p_environment is null or p_environment not in ('TEST','PRODUCTION')
  or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000
 then raise exception 'Explicit roster move inputs required' using errcode='22023';end if;
 if not private.current_identity_valid() or auth.uid()=p_user then
   raise exception 'Verified separate staffing manager required' using errcode='42501';end if;
 perform private.lock_account_lifecycle();
 if not private.current_identity_valid() then
   raise exception 'Staffing session changed' using errcode='42501';end if;
 select * into prior from private.contractor_roster_actions a where a.action_id=p_action;
 if found then
   if row(prior.organization_id,prior.user_id,prior.actor_id,prior.new_team_id,
        prior.expected_revision,prior.reason,prior.environment)
     is distinct from row(p_org,p_user,auth.uid(),p_team,p_expected_revision,
        btrim(p_reason),p_environment)
   then raise exception 'Roster action UUID reused with changed inputs' using errcode='22023';end if;
   -- A replay returns the original immutable receipt, not renewed staffing
   -- authority. Do not disclose even that scoped receipt to a manager whose
   -- work entitlement, team grant or Owner capability was later removed.
   if prior.action_kind='PLACE' then
     if not (private.has_team_capability(p_org,p_team,'PLACE_UNASSIGNED_CONTRACTOR')
       or (private.is_current_platform_owner(p_environment)
         and exists(select 1 from private.org_office_allowances o
           where o.organization_id=p_org))) then
       raise exception 'Current placement authority required for roster replay'
         using errcode='42501';
     end if;
   elsif not ((private.has_team_capability(p_org,prior.old_team_id,'TRANSFER_CONTRACTOR')
       and private.has_team_capability(p_org,p_team,'TRANSFER_CONTRACTOR'))
     or (private.is_current_platform_owner(p_environment)
       and exists(select 1 from private.org_office_allowances o
         where o.organization_id=p_org))) then
     raise exception 'Current transfer authority required for roster replay'
       using errcode='42501';
   end if;
   return jsonb_build_object('action_id',p_action,'user_id',p_user,
     'old_team_id',prior.old_team_id,'new_team_id',prior.new_team_id,
     'revision',prior.result_revision,'action_kind',prior.action_kind);
 end if;
 select * into access_row from private.account_work_access a
    where a.organization_id=p_org and a.user_id=p_user for update;
 if not found or access_row.work_role<>'CONTRACTOR' or not access_row.active
    or access_row.disabled_at is not null or access_row.suspension_authority is not null
    or not private.account_identity_ready(p_org,p_user,'CONTRACTOR') then
   raise exception 'Active verified Contractor identity required' using errcode='42501';end if;
 if not exists(select 1 from public.admin_teams t
      where t.organization_id=p_org and t.id=p_team and t.active) then
   raise exception 'Active same-organization destination team required' using errcode='42501';end if;
 select * into membership from private.contractor_team_memberships m
    where m.organization_id=p_org and m.user_id=p_user for update;
 previous_team:=case when membership.active then membership.team_id else null end;
 if previous_team is not null and previous_team=p_team then
   raise exception 'Contractor already placed with destination team' using errcode='22023';end if;
 if membership.user_id is null and p_expected_revision is not null
   or membership.user_id is not null and membership.revision is distinct from p_expected_revision then
   raise exception 'Roster revision changed; refresh before moving' using errcode='40001';end if;
 if previous_team is null then
   kind:='PLACE';
   if not private.has_team_capability(p_org,p_team,'PLACE_UNASSIGNED_CONTRACTOR')
      and not (private.is_current_platform_owner(p_environment)
       and exists(select 1 from private.org_office_allowances o where o.organization_id=p_org)) then
     raise exception 'Tier 2 or 3 supervised placement authority required' using errcode='42501';end if;
   -- A Tier 2 manager places a Contractor UNDER an active team Admin,
   -- not into a freshly created but still unmanned placeholder team.
   if not private.has_team_capability(p_org,p_team,'TRANSFER_CONTRACTOR')
     and not private.is_current_platform_owner(p_environment)
     and not exists(select 1 from private.admin_team_memberships m
       join private.account_work_access a on a.organization_id=m.organization_id
         and a.user_id=m.user_id
       where m.organization_id=p_org and m.team_id=p_team and m.active
         and a.work_role='ADMIN' and a.active and a.disabled_at is null
         and a.suspension_authority is null
         and private.account_identity_ready(p_org,a.user_id,'ADMIN')) then
     raise exception 'A verified active team Admin is required for Tier 2 placement'
       using errcode='42501';end if;
 else
   kind:='TRANSFER';
   if not ((private.has_team_capability(p_org,previous_team,'TRANSFER_CONTRACTOR')
         and private.has_team_capability(p_org,p_team,'TRANSFER_CONTRACTOR'))
      or (private.is_current_platform_owner(p_environment)
       and exists(select 1 from private.org_office_allowances o where o.organization_id=p_org))) then
     raise exception 'Tier 3 or Product Owner transfer authority required' using errcode='42501';end if;
 end if;
 -- A roster change cannot imply a second handoff or authorize an old offline job.
 -- SHARE locks reject assignment writes while reading the exact idle condition.
 lock table public.work_orders,public.work_order_assignments in share mode;
 if exists(select 1 from public.work_orders w
    where w.organization_id=p_org and w.field_status not in ('FIELD_COMPLETE','CANCELLED')
      and (w.assigned_user_id=p_user or w.pending_assignee_user_id=p_user))
   or exists(select 1 from public.work_order_assignments a
       join public.work_orders w on w.current_run_id=a.run_id
       where w.organization_id=p_org and w.field_status not in ('FIELD_COMPLETE','CANCELLED')
         and a.assigned_user_id=p_user and a.assignment_ended_at is null)
 then raise exception 'Contractor has open or pending assignments; reviewed WO handoff required'
   using errcode='42501';end if;
 if kind='PLACE' then
   -- Placing an unassigned account consumes a real Contractor seat.
   select o.contractor_seat_limit into limit_value from public.organizations o
       where o.id=p_org for update;
   select count(*) into used_count from private.account_work_access a
       where a.organization_id=p_org and a.work_role='CONTRACTOR' and a.active
         and a.disabled_at is null and private.is_assignable_contractor(a.user_id,p_org);
   select count(*) into pending_count from public.contractor_invitations i
       where i.organization_id=p_org
         and i.status in ('RESERVED','SENT','PROBLEM','CANCELLING');
   if limit_value is null or used_count+pending_count>=limit_value then
      raise exception 'No Contractor seat is available for placement' using errcode='23514';end if;
 end if;
 if membership.user_id is null then
   insert into private.contractor_team_memberships(
     organization_id,user_id,team_id,active,revision)
   values(p_org,p_user,p_team,true,next_revision);
 else
   update private.contractor_team_memberships
     set team_id=p_team,active=true,revision=next_revision
     where organization_id=p_org and user_id=p_user;
 end if;
 -- The same authoritative assignment predicate must recognize the new
 -- roster identity; otherwise roll back placement/transfer without exposure.
 if not private.is_assignable_contractor(p_user,p_org) then
   raise exception 'Contractor cannot be assigned after roster change' using errcode='42501';end if;
 insert into private.contractor_roster_actions(
  action_id,organization_id,user_id,actor_id,old_team_id,new_team_id,
  expected_revision,result_revision,action_kind,reason,environment)
 values(p_action,p_org,p_user,auth.uid(),previous_team,p_team,
   p_expected_revision,next_revision,kind,btrim(p_reason),p_environment);
 result:=jsonb_build_object('action_id',p_action,'user_id',p_user,
   'old_team_id',previous_team,'new_team_id',p_team,
   'revision',next_revision,'action_kind',kind);
 return result;
end;
$$;
revoke all on function public.manage_idle_contractor_roster(
 uuid,uuid,uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.manage_idle_contractor_roster(
 uuid,uuid,uuid,uuid,uuid,text,text) to authenticated,service_role;
