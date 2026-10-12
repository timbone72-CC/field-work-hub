-- Phase 6F: keep the existing Contractor consent owner, but recheck the
-- current team assignment boundary before an in-progress reassignment can commit.
create or replace function private.respond_reassignment(
  p_work_order_id uuid,p_accept boolean
) returns table(work_order_id uuid,accepted boolean,assigned_user_id uuid,field_status text)
language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_org uuid:=nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid;
  v_role text:=auth.jwt()->'app_metadata'->>'role'; v_row public.work_orders%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role not in ('ADMIN','CONTRACTOR') or v_org is null then raise exception 'Not permitted' using errcode='42501'; end if;
  select * into v_row from public.work_orders where id=p_work_order_id for update;
  if not found or v_row.organization_id is distinct from v_org or v_row.assigned_user_id is distinct from v_uid then
    raise exception 'Work order not available to this user' using errcode='42501'; end if;
  if v_row.field_status<>'IN_PROGRESS' then
    raise exception 'Reassignment consent is only available while work is in progress' using errcode='22023'; end if;
  if v_row.pending_assignee_user_id is null then raise exception 'No reassignment request is pending' using errcode='22023'; end if;

  if p_accept then
    if v_row.responsible_team_id is null or not exists(
      select 1 from private.contractor_team_memberships m
      join private.account_work_access a on a.organization_id=m.organization_id and a.user_id=m.user_id
      join auth.users u on u.id=m.user_id
      where m.organization_id=v_org and m.team_id=v_row.responsible_team_id
        and m.user_id=v_row.pending_assignee_user_id and m.active
        and a.work_role='CONTRACTOR' and a.active and a.disabled_at is null
        and a.suspension_authority is null and u.deleted_at is null and u.email_confirmed_at is not null
        and private.is_assignable_contractor(u.id,v_org)
    ) then raise exception 'Proposed assignee is no longer eligible for this work team' using errcode='42501'; end if;
    update public.work_orders set assigned_user_id=pending_assignee_user_id,assignment_received_at=null,
      pending_assignee_user_id=null,reassignment_requested_at=null
      where id=p_work_order_id returning * into v_row;
  else
    update public.work_orders set pending_assignee_user_id=null,reassignment_requested_at=null
      where id=p_work_order_id returning * into v_row;
  end if;
  return query select v_row.id,p_accept,v_row.assigned_user_id,v_row.field_status;
end;$$;
