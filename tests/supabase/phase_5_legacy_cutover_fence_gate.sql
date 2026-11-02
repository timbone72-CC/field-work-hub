-- Phase 5D cutover backstop: PostgreSQL native, rollback ONLY.
begin;
do $gate$
declare
 cfg private.client_delivery_package_dispatch_config%rowtype;
 original_count bigint;
 denied boolean;
 old_pkg uuid;
begin
 select * into cfg from private.client_delivery_package_dispatch_config
  where singleton;
 if cfg.enabled or cfg.legacy_worker_off_verified
 then raise exception 'Cutover must default OFF';end if;
 if to_regprocedure('private.service_legacy_dispatch_cutover_row_guard()') is null
  or not exists(select 1 from pg_trigger
    where tgrelid='private.client_delivery_dispatch_permit'::regclass
      and tgname='phase5d_cutover_legacy_singleton' and tgenabled='O')
  or not exists(select 1 from pg_trigger
    where tgrelid='private.client_delivery_outbox'::regclass
      and tgname='phase5d_cutover_outbox' and tgenabled='O')
  or has_function_privilege(
    'authenticated','private.service_legacy_dispatch_cutover_row_guard()','EXECUTE')
  or has_function_privilege(
    'anon','private.service_legacy_dispatch_cutover_row_guard()','EXECUTE')
 then raise exception 'Legacy mutation cutover fence missing or exposed';end if;
 select count(*) into original_count from private.client_delivery_dispatch_permit;
 update private.client_delivery_package_dispatch_config
  set enabled=true,legacy_worker_off_verified=true where singleton;
 denied:=false;
 begin
  insert into private.client_delivery_dispatch_permit(singleton,request_id)
   values(true,gen_random_uuid()) on conflict (singleton) do nothing;
 exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'Legacy permit did not fail closed';end if;
 select package_id into old_pkg from private.client_delivery_outbox
   where state='DELIVERING' order by package_id limit 1;
 if old_pkg is not null then
   denied:=false;
   begin
     update private.client_delivery_outbox set lease_until=lease_until
      where package_id=old_pkg;
   exception when sqlstate '42501' then denied:=true;end;
   if not denied then raise exception 'Unpermitted original outbox update allowed';end if;
 end if;
 -- The finalizer's DELIVERING->DELIVERED lease cleanup is the sole
 -- permitted exception, and it needs the original worker, exact active
 -- step, immutable final receipt, and no non-terminal field changes.
 -- Source assertions supplement the live rollback-only denial above.
 if position('old.state=''DELIVERING'' and new.state=''DELIVERED''' in
   pg_get_functiondef('private.service_legacy_dispatch_cutover_row_guard()'::regprocedure))=0
   or position('old.worker_id is distinct from held.worker_id' in
     pg_get_functiondef('private.service_legacy_dispatch_cutover_row_guard()'::regprocedure))=0
   or position('s.request_id=held.request_id' in
     pg_get_functiondef('private.service_legacy_dispatch_cutover_row_guard()'::regprocedure))=0
   or position('r.approved_sha256=old.approved_sha256' in
     pg_get_functiondef('private.service_legacy_dispatch_cutover_row_guard()'::regprocedure))=0
   or position('new.worker_id is not null or new.lease_until is not null' in
     pg_get_functiondef('private.service_legacy_dispatch_cutover_row_guard()'::regprocedure))=0
   or position('to_jsonb(new)' in
     pg_get_functiondef('private.service_legacy_dispatch_cutover_row_guard()'::regprocedure))=0
 then raise exception 'Terminal release must require immutable verified owner and receipt';end if;
 if (select count(*) from private.client_delivery_dispatch_permit)<>original_count
 then raise exception 'Original singleton mutated in cutover test';end if;
 raise notice 'PASS: both legacy mutation backstops deny at rollback-only cutover';
end;
$gate$;
rollback;
