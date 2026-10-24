-- Phase 6B: an explicit human Accept is separate from durable download receipt,
-- Start and Finish. Exact assignment instance, no state/status invented.
alter table public.work_order_assignments
 add column acknowledged_at timestamptz,
 add column acknowledgment_received_at timestamptz,
 add column acknowledgment_action_id uuid,
 add constraint work_order_assignments_accept_fields_chk check (
   (acknowledged_at is null and acknowledgment_received_at is null and acknowledgment_action_id is null)
   or (acknowledged_at is not null and acknowledgment_received_at is not null and acknowledgment_action_id is not null));
create unique index work_order_assignments_accept_action_idx
 on public.work_order_assignments(acknowledgment_action_id)
 where acknowledgment_action_id is not null;

-- Current Phase 5 office capability is checked by the existing protected work
-- gate. An old accepted action may be replayed by its still-authorized actor.
-- No human Accept is manufactured by old receipt/Start/Finish functions.
create function public.acknowledge_assignment_acceptance(
 p_action_id uuid,p_work_order_id uuid,p_run_id uuid,
 p_assignment_instance_id uuid,p_event_time text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $ack$
declare
 v_org uuid; v_uid uuid:=auth.uid(); v_event timestamptz;
 old public.work_order_assignments%rowtype; a public.work_order_assignments%rowtype;
 w public.work_orders%rowtype; r public.work_order_runs%rowtype;
begin
 v_org:=private.legacy_work_org('CONTRACTOR');
 if p_action_id is null or p_work_order_id is null or p_run_id is null
   or p_assignment_instance_id is null or nullif(btrim(p_event_time),'') is null
 then raise exception 'Exact acknowledgment identity required' using errcode='22023';end if;
 begin v_event:=p_event_time::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then
   raise exception 'Invalid acceptance event time' using errcode='22023';
 end;
 if v_event is null or not isfinite(v_event) then
   raise exception 'Invalid acceptance time' using errcode='22023';end if;
 -- Serializes same actor/run and duplicate action even on concurrent devices.
 perform pg_advisory_xact_lock(hashtextextended('fwh.ack.'||p_action_id::text,0));
 select * into old from public.work_order_assignments
   where acknowledgment_action_id=p_action_id;
 if old.id is not null then
   if old.id is distinct from p_assignment_instance_id or
      old.run_id is distinct from p_run_id or
      old.assigned_user_id is distinct from v_uid or
      old.acknowledged_at is distinct from v_event or
      not exists(select 1 from public.work_order_runs rr where rr.id=old.run_id
        and rr.work_order_id=p_work_order_id and rr.organization_id=v_org)
   then raise exception 'Acknowledgment action conflict' using errcode='40001';end if;
   return jsonb_build_object('outcome','ALREADY_APPLIED','action_id',p_action_id,
     'field_status',(select field_status from public.work_order_runs where id=old.run_id),
     'acknowledgment_received_at',old.acknowledgment_received_at,
     'accepted_at',old.acknowledgment_received_at,'server_updated_at',old.acknowledgment_received_at);
 end if;
 perform private.guard_legacy_work_order(p_work_order_id,'CONTRACTOR');
 select * into w from public.work_orders where id=p_work_order_id for update;
 select * into r from public.work_order_runs
   where id=p_run_id and work_order_id=p_work_order_id for update;
 select * into a from public.work_order_assignments
   where id=p_assignment_instance_id and run_id=p_run_id for update;
 if w.current_run_id is distinct from p_run_id or r.id is null
   or r.organization_id is distinct from v_org
   or a.id is null or a.organization_id is distinct from v_org
   or a.assigned_user_id is distinct from v_uid
   or w.assigned_user_id is distinct from v_uid
   or r.current_assignee_user_id is distinct from v_uid
   or w.field_status not in ('ASSIGNED','IN_PROGRESS','FIELD_COMPLETE')
   or (a.assignment_ended_at is not null and
      not (w.field_status='FIELD_COMPLETE' and a.end_reason='FIELD_COMPLETE'))
 then raise exception 'Assignment no longer available for acknowledgment' using errcode='42501';end if;
 if a.acknowledgment_action_id is not null then
   raise exception 'Assignment already acknowledged by a different action' using errcode='40001';end if;
 update public.work_order_assignments
   set acknowledged_at=v_event,acknowledgment_received_at=clock_timestamp(),
       acknowledgment_action_id=p_action_id
   where id=a.id returning * into a;
 return jsonb_build_object('outcome','APPLIED','action_id',p_action_id,
    'field_status',w.field_status,'acknowledgment_received_at',a.acknowledgment_received_at,
    'accepted_at',a.acknowledgment_received_at,'server_updated_at',a.acknowledgment_received_at);
end;
$ack$;
revoke all on function public.acknowledge_assignment_acceptance(uuid,uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.acknowledge_assignment_acceptance(uuid,uuid,uuid,uuid,text)
 to authenticated;

-- Keep existing Phase 4 field_assignments server owner. Add exact current
-- assignment's human ACK, never infer ACK from download or field state.
create or replace function private.field_assignments() returns setof jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $field$
begin
 perform private.legacy_work_org(auth.jwt()->'app_metadata'->>'role');
 return query
 select j || jsonb_build_object(
    'acknowledgment_received_at',h.acknowledgment_received_at,
    'acknowledged_at',h.acknowledged_at,
    'reopen_reason',r.reopen_reason
  )
 from private.field_assignments_phase4_engine() j
 left join public.work_order_assignments h
   on h.id=nullif(j->>'assignment_instance_id','')::uuid
   and h.run_id=(j->>'current_run_id')::uuid
   and h.organization_id=(j->>'organization_id')::uuid
 left join public.work_order_runs r
   on r.id=(j->>'current_run_id')::uuid
   and r.work_order_id=(j->>'id')::uuid
 where private.can_read_work_order((j->>'id')::uuid);
end;
$field$;
