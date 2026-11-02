-- Run only in the disposable FWH Team TEST database; this is one transaction.
-- Real private tables/RPCs/constraints. No provider call or committed fixture.
begin;
set local lock_timeout='4s';
update private.client_delivery_package_dispatch_config
 set enabled=true,legacy_worker_off_verified=true where singleton;
do $live$
declare
 d record; work_item record;actor uuid; layout jsonb;
 pkg uuid[]:=array[]::uuid[];
 worker uuid[]:=array[]::uuid[];
 request_uuid uuid[]:=array[]::uuid[];
 step_uuid uuid[]:=array[]::uuid[];
 claim jsonb; step jsonb; check_owner jsonb; blocked boolean;
 n integer:=0; new_pkg uuid; action_uuid uuid; original_pkg uuid;
begin
 select id,organization_id,company_id,root_folder_id,revision into d
 from private.client_delivery_destinations
 where active and verified order by id limit 1;
 if d.id is null then raise exception 'TEST destination missing';end if;
 select approved_by into actor from private.client_packages
  where approved_by is not null limit 1;
 if actor is null then raise exception 'TEST approver missing';end if;
 layout:=private.phase_5_current_folder_layout(d.id,d.organization_id,d.company_id);
 if layout->>'layout'<>'ADDRESS_WORK_ORDER'
 then raise exception 'Unexpected configured TEST layout';end if;
 update private.client_delivery_runtime set last_verified_at=clock_timestamp()
 where organization_id=d.organization_id and worker_ready and worker_identity is not null;
 if not found then raise exception 'TEST runtime readiness missing';end if;
 for work_item in
   select wr.id run_id,wr.work_order_id
   from public.work_order_runs wr
   join public.work_orders wo on wo.id=wr.work_order_id
   where wo.organization_id=d.organization_id and wo.client_company_id=d.company_id
     and not exists (select 1 from private.client_packages k
       where k.run_id=wr.id and k.work_order_id=wr.work_order_id)
   order by wr.id limit 2
 loop
   n:=n+1;new_pkg:=gen_random_uuid();action_uuid:=gen_random_uuid();
   insert into private.client_packages(
      id,organization_id,company_id,work_order_id,run_id,notes,status,
      approved_manifest,approved_sha256,approved_by,approved_at,destination_id)
   values(new_pkg,d.organization_id,d.company_id,work_item.work_order_id,
     work_item.run_id,'ROLLBACK ONLY independent permit fixture','QUEUED',
     jsonb_build_object('package_id',new_pkg::text,'destination_id',d.id::text,
        'destination_root',d.root_folder_id,'destination_revision',d.revision::text,
        'folder_layout','ADDRESS_WORK_ORDER',
        'folder_layout_revision',layout->>'revision',
        'selected_photos',jsonb_build_array(
           jsonb_build_object('photo_id',gen_random_uuid()::text))),
     repeat('a',64),actor,clock_timestamp(),d.id);
   insert into private.client_package_actions(
       action_id,package_id,actor_user_id,action_kind,request_fingerprint,result)
   values(action_uuid,new_pkg,actor,'SEND',repeat('b',64),'{}'::jsonb);
   insert into private.client_delivery_outbox(
       package_id,action_id,approved_sha256,destination_id)
   values(new_pkg,action_uuid,repeat('a',64),d.id);
   pkg:=array_append(pkg,new_pkg);
   worker:=array_append(worker,gen_random_uuid());
   request_uuid:=array_append(request_uuid,gen_random_uuid());
 end loop;
 if n<>2 then raise exception 'Expected two independent eligible fixtures, got %',n;end if;
 for n in 1..2 loop
   claim:=private.service_claim_package_and_acquire_dispatch(
     pkg[n],d.id,d.root_folder_id,worker[n],request_uuid[n]);
   if claim->>'acquired' is distinct from 'true' then
     raise exception 'Package % claim failed: %',n,claim;end if;
   check_owner:=private.service_read_pinned_package_dispatch(
     pkg[n],d.id,d.root_folder_id);
   if check_owner->>'active' is distinct from 'true' then
     raise exception 'Package % owner proof failed',n;end if;
   step:=private.service_begin_package_dispatch_step(
     pkg[n],worker[n],request_uuid[n],1,gen_random_uuid());
   if step->>'acquired' is distinct from 'true' then
     raise exception 'Package % step admission failed: %',n,step;end if;
   step_uuid:=array_append(step_uuid,(step->>'step_id')::uuid);
 end loop;
 step:=private.service_begin_package_dispatch_step(
   pkg[2],worker[2],request_uuid[2],1,gen_random_uuid());
 if step->>'acquired' is distinct from 'false' then
   raise exception 'Unresolved package allowed duplicate step';end if;
 -- Package 2 remains HELD. An independent package can still finish a
 -- database-only verified metadata step and admit a later step.
 claim:=private.service_complete_package_dispatch_step(
    pkg[1],worker[1],request_uuid[1],1,step_uuid[1],'VERIFIED_METADATA_STEP');
 if claim->>'completed' is distinct from 'true' then
   raise exception 'Unaffected package could not complete metadata';end if;
 step:=private.service_begin_package_dispatch_step(
    pkg[1],worker[1],request_uuid[1],1,gen_random_uuid());
 if step->>'acquired' is distinct from 'true' then
   raise exception 'Held unrelated package blocked independent continuation';end if;

 blocked:=false;
 begin
   perform private.service_release_package_dispatch(
     pkg[2],worker[2],request_uuid[2],1);
 exception when sqlstate '42501' then blocked:=true;end;
 if not blocked then raise exception 'Unresolved package allowed permit release';end if;
 select package_id into original_pkg from private.client_delivery_outbox
  where state='DELIVERING' and attempts=1 and package_id<>all(pkg)
  order by package_id limit 1;
 if original_pkg is null then raise exception 'Original held outbox disappeared';end if;
 blocked:=false;
 begin
   update private.client_delivery_outbox set lease_until=lease_until
    where package_id=original_pkg;
 exception when sqlstate '42501' then blocked:=true;end;
 if not blocked then raise exception 'Legacy original outbox update crossed cutover';end if;
 blocked:=false;
 begin
   perform private.service_acquire_delivery_dispatch(gen_random_uuid());
 exception when sqlstate '42501' then blocked:=true;end;
 if not blocked then raise exception 'Legacy singleton permit crossed cutover';end if;
 if (select count(*) from private.client_delivery_package_dispatch_permits)<>2
  or (select count(*) from private.client_delivery_package_step_attempts
      where verified_at is null)<>2
  or (select count(*) from private.client_delivery_package_step_attempts
      where verified_at is not null)<>1
 then raise exception 'Independent package/step isolation failed';end if;
 raise notice 'PASS: two real-schema owners, independent recovery, held step, legacy denied';
end;
$live$;
rollback;
select enabled,legacy_worker_off_verified,
 (select count(*) from private.client_delivery_package_dispatch_permits) as new_permits,
 (select count(*) from private.client_delivery_package_step_attempts) as new_steps,
 (select count(*) from private.client_delivery_dispatch_permit) as original_held
from private.client_delivery_package_dispatch_config where singleton;
