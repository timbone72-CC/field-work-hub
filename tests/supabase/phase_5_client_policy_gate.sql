-- Disposable Phase 5A/5C company-policy gate, synthetic actors only.
begin;
do $test$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 admin_id uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011';
 team uuid:='00000000-0000-0000-0000-000000000020';
 company uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid();
 wo uuid; cfg jsonb; rev uuid; action uuid:=gen_random_uuid(); got jsonb; replay jsonb; denied boolean;
begin
 insert into public.organizations(id,name) values(other_org,'OTHER COMPANY TEST');
 insert into private.client_companies(id,organization_id,name)
 values(company,org,'DISPOSABLE CLIENT'),(other_company,other_org,'FOREIGN CLIENT');
 insert into private.client_delivery_destinations(organization_id,company_id,provider,provider_identity,root_folder_id)
 values(org,company,'GOOGLE_DRIVE','test@example.invalid','NOT-VERIFIED-ROOT');
 if exists(select 1 from private.client_delivery_destinations where active or verified)
 then raise exception 'Unverified destinations activated';end if;
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
 'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
 'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 select (j->>'work_order_id')::uuid into wo from
 public.admin_create_work_order_v4(false,'DISPOSABLE COMPANY TEST','TEST','TEST','',current_date,contractor,cfg) j;
 update public.work_orders set responsible_team_id=team where id=wo;
 select review_policy_revision into rev from public.work_orders where id=wo;
 if (select client_company_id from public.work_orders where id=wo) is not null
 or not (select review_required from public.work_orders where id=wo)
 then raise exception 'Company guessed or review not required by default';end if;
 execute 'set local role authenticated';
 denied:=false;
 begin perform public.admin_assign_client_company(gen_random_uuid(),wo,other_company,rev);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Cross-org company binding allowed';end if;
 got:=public.admin_assign_client_company(gen_random_uuid(),wo,company,rev);
 if got->>'company_id'<>company::text then raise exception 'Company binding failed';end if;
 rev:=(got->>'review_policy_revision')::uuid;
 got:=public.admin_set_review_required(action,wo,rev,false,'Review not required for test');
 replay:=public.admin_set_review_required(action,wo,rev,false,'Review not required for test');
 if got<>replay or got->>'review_required'<>'false'
 then raise exception 'Review toggle did not replay';end if;
 denied:=false;
 begin perform public.admin_set_review_required(gen_random_uuid(),wo,rev,true,'Stale setting');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale policy was accepted';end if;
 execute 'reset role';
 if (select count(*) from private.review_policy_actions where work_order_id=wo)<>1
 then raise exception 'Policy audit was not immutable or replay-safe';end if;
 if has_table_privilege('authenticated','private.client_companies','select')
 or has_table_privilege('authenticated','private.client_delivery_destinations','select')
 or has_table_privilege('authenticated','private.review_policy_actions','select')
 then raise exception 'Private client metadata exposed';end if;
 raise notice 'Phase 5 client mapping, default-deny destination, revision and audit PASS';
end;
$test$;

-- The recovery reader is service_role-only and performs no claim, heartbeat,
-- quarantine, new ID reservation or other delivery state mutation.
do $lease_acl$
declare got jsonb; denied boolean:=false;
begin
 if has_function_privilege('authenticated',
   'public.service_read_active_delivery_lease()','execute')
   or has_function_privilege('anon',
   'public.service_read_active_delivery_lease()','execute')
   or not has_function_privilege('service_role',
   'public.service_read_active_delivery_lease()','execute')
 then raise exception 'Delivery lease recovery reader grants are unsafe'; end if;
 execute 'set local role authenticated';
 begin
  perform public.service_read_active_delivery_lease();
 exception when insufficient_privilege then denied:=true;
 end;
 execute 'reset role';
 if not denied then raise exception 'Authenticated user read delivery worker lease';end if;
 execute 'set local role service_role';
 got:=public.service_read_active_delivery_lease();
 execute 'reset role';
 if got is distinct from '{"state":"NONE"}'::jsonb
 then raise exception 'Empty delivery outbox incorrectly resumed';end if;
 if exists(select 1 from private.client_delivery_outbox)
 then raise exception 'Read-only lease probe mutated delivery outbox';end if;
 raise notice 'Service-only inactive/empty lease recovery PASS';
end;
$lease_acl$;
-- Next reserved item is a current-lease service-only read, not a way
-- to claim an item, allocate a Drive ID or inspect another tenant.
do $next_acl$
declare denied boolean:=false;
begin
 if has_function_privilege('authenticated',
   'public.service_next_delivery_item(uuid,uuid,bigint)','execute')
   or has_function_privilege('anon',
   'public.service_next_delivery_item(uuid,uuid,bigint)','execute')
   or not has_function_privilege('service_role',
   'public.service_next_delivery_item(uuid,uuid,bigint)','execute')
 then raise exception 'Next-item reader must remain service-only';end if;
 execute 'set local role authenticated';
 begin
  perform public.service_next_delivery_item(gen_random_uuid(),gen_random_uuid(),1);
 exception when insufficient_privilege then denied:=true;end;
 execute 'reset role';
 if not denied then raise exception 'Authenticated caller read reserved work';end if;
 denied:=false;
 execute 'set local role service_role';
 begin
  perform public.service_next_delivery_item(gen_random_uuid(),gen_random_uuid(),1);
 exception when insufficient_privilege or serialization_failure then denied:=true;end;
 execute 'reset role';
 if not denied then raise exception 'Missing current lease was accepted';end if;
 if exists(select 1 from private.client_delivery_file_plans)
 then raise exception 'Next-item ACL probe created delivery plans';end if;
 raise notice 'Service-only next reserved item and missing lease denial PASS';
end;
$next_acl$;
-- Atomic remote-ID set is service-only, and stale/wrong workers can
-- never create even a partial package plan. Outer fixture ROLLBACK preserves data.
do $atomic_acl$
declare denied boolean:=false;
begin
 if has_function_privilege('authenticated',
   'public.service_reserve_delivery_file_set(uuid,uuid,bigint,text,text,jsonb,text)','EXECUTE')
   or has_function_privilege('anon',
   'public.service_reserve_delivery_file_set(uuid,uuid,bigint,text,text,jsonb,text)','EXECUTE')
   or not has_function_privilege('service_role',
   'public.service_reserve_delivery_file_set(uuid,uuid,bigint,text,text,jsonb,text)','EXECUTE') then
   raise exception 'Atomic reservation RPC grants are unsafe';
 end if;
 execute 'set local role authenticated';
 begin
   perform public.service_reserve_delivery_file_set(gen_random_uuid(),
     gen_random_uuid(),1,'folder_1234567890123456','parent_123456789012345',
     '[]'::jsonb,'manifest_123456789012');
 exception when insufficient_privilege then denied:=true;end;
 execute 'reset role';
 if not denied then raise exception 'Ordinary caller reserved Drive identities';end if;
 denied:=false;
 execute 'set local role service_role';
 begin
   perform public.service_reserve_delivery_file_set(gen_random_uuid(),
     gen_random_uuid(),1,'folder_1234567890123456','parent_123456789012345',
     '[]'::jsonb,'manifest_123456789012');
 exception when serialization_failure then denied:=true;end;
 execute 'reset role';
 if not denied then raise exception 'Unknown original lease reserved Drive identities';end if;
 if exists(select 1 from private.client_delivery_file_plans) then
   raise exception 'Stale lease left a partial file ID set';
 end if;
 raise notice 'Atomic file-set service-only and stale-lease denial PASS';
end;
$atomic_acl$;
do $final_acl$
declare denied boolean:=false;
begin
 if has_function_privilege('anon',
   'public.service_delivery_final_provider_snapshot(uuid,uuid,bigint)','execute')
   or has_function_privilege('authenticated',
   'public.service_delivery_final_provider_snapshot(uuid,uuid,bigint)','execute')
   or not has_function_privilege('service_role',
   'public.service_delivery_final_provider_snapshot(uuid,uuid,bigint)','execute')
 then raise exception 'Final provider snapshot grants are unsafe';end if;
 execute 'set local role authenticated';
 begin
   perform public.service_delivery_final_provider_snapshot(
     gen_random_uuid(),gen_random_uuid(),1);
 exception when insufficient_privilege then denied:=true;end;
 execute 'reset role';
 if not denied then raise exception 'Ordinary user obtained final delivery verification snapshot';end if;
 denied:=false;
 execute 'set local role service_role';
 begin
   perform public.service_delivery_final_provider_snapshot(
     gen_random_uuid(),gen_random_uuid(),1);
 exception when serialization_failure then denied:=true;end;
 execute 'reset role';
 if not denied then raise exception 'Unknown worker obtained final delivery snapshot';end if;
 raise notice 'Final provider projection service-only and original lease gated PASS';
end;
$final_acl$;

-- Same-host and cross-Edge races must use one global durable dispatch permit.
-- This entire fixture rolls back; no hosted permit or customer row changes.
do $dispatch_acl$
declare
  req1 uuid:=gen_random_uuid();
  req2 uuid:=gen_random_uuid();
  first jsonb; busy jsonb; last jsonb;
  denied boolean:=false;
begin
  if has_table_privilege('service_role','private.client_delivery_dispatch_permit','insert')
     or has_table_privilege('authenticated','private.client_delivery_dispatch_permit','select')
     or has_function_privilege('anon','public.service_acquire_delivery_dispatch(uuid)','execute')
     or has_function_privilege('authenticated','public.service_release_delivery_dispatch(uuid)','execute')
     or not has_function_privilege('service_role','public.service_acquire_delivery_dispatch(uuid)','execute')
     or not has_function_privilege('service_role','public.service_release_delivery_dispatch(uuid)','execute') then
    raise exception 'Single-flight dispatch ACL unsafe';
  end if;
  execute 'set local role authenticated';
  begin
    perform public.service_acquire_delivery_dispatch(req1);
  exception when insufficient_privilege then denied:=true;end;
  execute 'reset role';
  if not denied then raise exception 'Ordinary user acquired worker dispatch';end if;
  execute 'set local role service_role';
  first:=public.service_acquire_delivery_dispatch(req1);
  busy:=public.service_acquire_delivery_dispatch(req2);
  if first->>'acquired'<>'true' or busy->>'acquired'<>'false' then
    raise exception 'Concurrent dispatch was not excluded';
  end if;
  -- Even the same UUID cannot reenter and circumvent the original claim.
  busy:=public.service_acquire_delivery_dispatch(req1);
  if busy->>'acquired'<>'false' then
    raise exception 'Reentrant dispatch bypassed singleton';
  end if;
  denied:=false;
  begin
    perform public.service_release_delivery_dispatch(req2);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Foreign dispatch released original owner';end if;
  execute 'reset role';
  if (select request_id from private.client_delivery_dispatch_permit) is distinct from req1
    then raise exception 'Wrong-worker release erased the permit';end if;
  execute 'set local role service_role';
  last:=public.service_release_delivery_dispatch(req1);
  if last->>'released'<>'true' then raise exception 'Owner failed to release';end if;
  last:=public.service_acquire_delivery_dispatch(req2);
  if last->>'acquired'<>'true' then raise exception 'Verified completion did not free slot';end if;
  perform public.service_release_delivery_dispatch(req2);
  execute 'reset role';
  if exists(select 1 from private.client_delivery_dispatch_permit) then
    raise exception 'Successful completion left a stale dispatch';end if;
  raise notice 'Exact one-slot service-only dispatch and wrong-owner denial PASS';
end;
$dispatch_acl$;

-- Original TEST expired-lease inspection/recovery is strictly service-only;
-- an unrelated package/worker can neither read another tenant nor renew.
-- This negative gate runs in the same rollback-only synthetic transaction.
do $test_expired_lease_acl$
declare
  pkg uuid:=gen_random_uuid();
  destination uuid:=gen_random_uuid();
  worker uuid:=gen_random_uuid();
  parent_map uuid:=gen_random_uuid();
  request_id uuid:=gen_random_uuid();
  root text:='fwh_ci_original_test_root_123456789';
  remote_id text:='fwh_ci_saved_original_folder_12345';
  previous_expiry timestamptz:=clock_timestamp()-interval '1 minute';
  denied boolean;
begin
  if has_function_privilege('authenticated',
      'public.service_read_expired_test_delivery_reservation(uuid,uuid,text)','execute')
    or has_function_privilege('anon',
      'public.service_read_expired_test_delivery_reservation(uuid,uuid,text)','execute')
    or has_function_privilege('authenticated',
      'public.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)','execute')
    or has_function_privilege('anon',
      'public.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)','execute')
    or not has_function_privilege('service_role',
      'public.service_read_expired_test_delivery_reservation(uuid,uuid,text)','execute')
    or not has_function_privilege('service_role',
      'public.service_resume_exact_test_expired_delivery(uuid,uuid,text,uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid)','execute')
    or has_table_privilege('service_role',
      'private.client_delivery_test_lease_recoveries','insert')
    or has_table_privilege('authenticated',
      'private.client_delivery_test_lease_recoveries','select')
  then raise exception 'Original TEST recovery authority exposed'; end if;
  denied:=false;
  execute 'set local role authenticated';
  begin
    perform public.service_read_expired_test_delivery_reservation(pkg,destination,root);
  exception when insufficient_privilege then denied:=true; end;
  execute 'reset role';
  if not denied then raise exception 'App role inspected expired worker lease'; end if;
  denied:=false;
  execute 'set local role service_role';
  begin
    perform public.service_read_expired_test_delivery_reservation(pkg,destination,root);
  exception when insufficient_privilege then denied:=true; end;
  execute 'reset role';
  if not denied then raise exception 'Nonexistent/other-company TEST scope inspected'; end if;
  denied:=false;
  execute 'set local role service_role';
  begin
    perform public.service_resume_exact_test_expired_delivery(
      pkg,destination,root,worker,1,parent_map,remote_id,
      previous_expiry,clock_timestamp(),'GOOGLE_FILE_ID_NOT_FOUND',request_id);
  exception when insufficient_privilege then denied:=true; end;
  execute 'reset role';
  if not denied then raise exception 'Foreign or absent expired lease recovered'; end if;
  if exists(select 1 from private.client_delivery_test_lease_recoveries)
  then raise exception 'Denied TEST recovery wrote an immutable audit row'; end if;
  raise notice 'TEST expired-lease read/CAS role, package, saved-ID and no-write denial PASS';
end;
$test_expired_lease_acl$;
rollback;
