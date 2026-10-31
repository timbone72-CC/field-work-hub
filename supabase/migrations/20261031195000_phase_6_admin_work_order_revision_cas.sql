-- Phase 6A: exact ordinary-field revision compare-and-swap for the existing
-- office work-order mutation owner. SOURCE-ONLY until the governed Level 3
-- deployment gate; no existing held delivery/Google object is touched.
--
-- Prior v4 had requirements-revision CAS but no ordinary WO-field CAS:
-- concurrent Admin edits could overwrite each other's details after a stale
-- list read. Use the existing work_orders.updated_at trigger revision.
-- Lock the same WO before checking, then delegate to the established
-- requirements and assignment mutation owners in the same transaction.
do $preflight$
begin
  if to_regprocedure('private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb)') is null
     or to_regprocedure('public.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb)') is null
  then raise exception 'Expected Phase 4 Admin edit owner missing; stop upgrade';end if;
end;
$preflight$;

drop function public.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb);
drop function private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb);

create function private.admin_update_work_order_v4(
  p_work_order_id uuid,p_wo_number text,p_property_address text,
  p_work_type text,p_instructions text,p_due_date date,p_assigned_user_id uuid,
  p_expected_revision uuid,p_requirements jsonb,p_expected_updated_at timestamptz
) returns setof jsonb language plpgsql security definer
set search_path='' set lock_timeout='5s' as $update$
declare
  actor_org uuid; current_wo public.work_orders%rowtype;
begin
  actor_org:=private.phase4_admin_org();
  if p_work_order_id is null or p_expected_updated_at is null then
    raise exception 'Exact work-order identity and revision required' using errcode='PT409';
  end if;
  select * into current_wo from public.work_orders
    where id=p_work_order_id for update;
  if current_wo.id is null or current_wo.organization_id is distinct from actor_org then
    raise exception 'Work order unavailable to this Admin' using errcode='42501';
  end if;
  if current_wo.updated_at is distinct from p_expected_updated_at then
    raise exception 'Work order changed on server. Reload before saving.' using errcode='PT409';
  end if;
  if p_requirements is not null then
    perform private.admin_set_photo_requirements(
      p_work_order_id,p_expected_revision,p_requirements);
  end if;
  return query select to_jsonb(updated) from private.admin_update_work_order(
    p_work_order_id,p_wo_number,p_property_address,p_work_type,
    p_instructions,p_due_date,p_assigned_user_id
  ) updated;
end;
$update$;

create function public.admin_update_work_order_v4(
  p_work_order_id uuid,p_wo_number text,p_property_address text,
  p_work_type text,p_instructions text,p_due_date date,p_assigned_user_id uuid,
  p_expected_revision uuid,p_requirements jsonb,p_expected_updated_at timestamptz
) returns setof jsonb language sql security invoker set search_path='' as $update$
  select * from private.admin_update_work_order_v4(
    p_work_order_id,p_wo_number,p_property_address,p_work_type,
    p_instructions,p_due_date,p_assigned_user_id,
    p_expected_revision,p_requirements,p_expected_updated_at);
$update$;

revoke all on function private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb,timestamptz)
 from public,anon,authenticated;
grant execute on function private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb,timestamptz)
 to authenticated,service_role;
revoke all on function public.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb,timestamptz)
 from public,anon,authenticated;
grant execute on function public.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb,timestamptz)
 to authenticated,service_role;
