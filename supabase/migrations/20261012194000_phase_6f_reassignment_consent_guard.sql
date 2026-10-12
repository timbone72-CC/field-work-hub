-- Phase 6F: preserve the existing guarded Contractor reassignment/consent
-- owner and its Phase 4 action behavior. Only strengthen the pending target's
-- CURRENT team eligibility under that owner's authority and work-row lock.
-- Never derive consent authority from stale JWT role/org claims alone.
create or replace function private.respond_reassignment(
  p_work_order_id uuid,p_accept boolean
) returns table(work_order_id uuid,accepted boolean,assigned_user_id uuid,field_status text)
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  v_row public.work_orders%rowtype;
begin
  -- Existing phase-5 guard serializes current session/work/team authority
  -- with revocation and holds the exact work-order row lock.
  perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
  if p_accept then
    select * into v_row from public.work_orders where id=p_work_order_id for update;
    if v_row.pending_assignee_user_id is not null and
      (v_row.responsible_team_id is null or not exists(
        select 1 from private.contractor_team_memberships m
        join private.account_work_access a
          on a.organization_id=m.organization_id and a.user_id=m.user_id
        join auth.users u on u.id=m.user_id
        where m.organization_id=v_row.organization_id
          and m.team_id=v_row.responsible_team_id
          and m.user_id=v_row.pending_assignee_user_id and m.active
          and a.work_role='CONTRACTOR' and a.active and a.disabled_at is null
          and a.suspension_authority is null
          and u.deleted_at is null and u.email_confirmed_at is not null
          and private.is_assignable_contractor(u.id,v_row.organization_id)
      ))
    then
      raise exception 'Proposed assignee is no longer eligible for this work team'
        using errcode='42501';
    end if;
  end if;
  -- Retain the reviewed phase-4 consent engine: current assignee, field state,
  -- pending request, accepted/declined behavior and existing run history.
  return query select * from private.respond_reassignment_phase4_engine(
    p_work_order_id,p_accept);
end;$$;
