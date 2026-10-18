-- Real PostgreSQL 17 CI uses only disposable synthetic auth, SQL rolled back.
begin;
do $gate$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 admin_id uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011';
 other_contractor uuid:='00000000-0000-0000-0000-000000000012';
 wo uuid; run uuid; instance uuid; action uuid:=gen_random_uuid();
 claims text; cfg jsonb; ack jsonb; replay jsonb; denied boolean;
begin
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
   'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
   'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 execute 'set local role authenticated';
 select (j->>'work_order_id')::uuid into wo
   from public.admin_create_work_order_v4(false,'ACK-TEST-'||gen_random_uuid(),
     'Synthetic address','CHECK','',current_date,contractor,cfg) j;
 execute 'reset role';
 select current_run_id into run from public.work_orders where id=wo;
 select id into instance from public.work_order_assignments
   where run_id=run and assignment_ended_at is null;
 if exists(select 1 from public.work_order_assignments
   where id=instance and acknowledgment_received_at is not null) then
   raise exception 'Download/dispatch synthesized human Accept';end if;
 claims:=jsonb_build_object('sub',contractor,'session_id',contractor,
   'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text;
 perform set_config('request.jwt.claims',claims,true);execute 'set local role authenticated';
 ack:=public.acknowledge_assignment_acceptance(
   action,wo,run,instance,'2026-10-11T10:30:00Z');
 replay:=public.acknowledge_assignment_acceptance(
   action,wo,run,instance,'2026-10-11T10:30:00Z');
 if ack->>'outcome'<>'APPLIED' or replay->>'outcome'<>'ALREADY_APPLIED'
   or ack->>'accepted_at'<>replay->>'accepted_at'
 then raise exception 'Exact Accept/replay failed: % %',ack,replay;end if;
 if not exists(select 1 from public.field_assignments() j where j->>'id'=wo::text
   and j->>'acknowledgment_received_at'=ack->>'accepted_at')
 then raise exception 'Current exact-instance ACK projection missing';end if;
 denied:=false;
 begin perform public.acknowledge_assignment_acceptance(
   action,wo,run,instance,'2026-10-11T10:31:00Z');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Changed-payload ACK replay accepted';end if;
 denied:=false;
 begin perform public.acknowledge_assignment_acceptance(
   gen_random_uuid(),wo,run,instance,'2026-10-11T10:30:00Z');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Second human ACK rewrote original event';end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_contractor,
   'session_id',other_contractor,'app_metadata',jsonb_build_object(
   'role','CONTRACTOR','organization_id',org))::text,true);
 execute 'set local role authenticated';
 denied:=false;
 begin perform public.acknowledge_assignment_acceptance(
   action,wo,run,instance,'2026-10-11T10:30:00Z');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Wrong actor replayed another ACK';end if;
 denied:=false;
 begin perform public.acknowledge_assignment_acceptance(
   gen_random_uuid(),wo,run,instance,'2026-10-11T10:30:00Z');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Wrong contractor accepted work';end if;
 execute 'reset role';
 if has_table_privilege('authenticated','public.work_order_assignments','UPDATE') or
   has_function_privilege('anon','public.acknowledge_assignment_acceptance(uuid,uuid,uuid,uuid,text)','EXECUTE')
 then raise exception 'Broad ACK mutation grant';end if;
 raise notice 'Phase 6B explicit human Accept, action replay and isolation PASS';
end;$gate$;
rollback;
