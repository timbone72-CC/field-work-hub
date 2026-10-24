-- Controlled PostgreSQL/RLS equivalent of client JWT contexts, not signed JWTs.
-- Run with the governed FWH database connector after the Phase 3A migration.
-- Uses existing accepted test users; never alters Auth accounts or existing WOs.
-- Custom WO numbers avoid consuming the nontransactional business sequence.
-- Every fixture and operation rolls back even on a successful gate.
begin;
do $gate$
declare
  v_admin uuid;
  v_a uuid;
  v_b uuid;
  v_org uuid;
  v_other_org uuid;
  v_admin_claims text;
  v_a_claims text;
  v_b_claims text;
  v_wo uuid;
  v_wo_b uuid;
  v_foreign_wo uuid;
  v_run uuid;
  v_other_run uuid;
  v_receipt timestamptz;
  v_started timestamptz;
  v_number text := 'FWH-3A-GATE-' || gen_random_uuid()::text;
  v_denied boolean;
  v_relation text;
  v_privilege text;
  v_function regprocedure;
begin
  select id, (raw_app_meta_data->>'organization_id')::uuid
    into v_admin, v_org from auth.users
    where raw_app_meta_data->>'role' = 'ADMIN' and deleted_at is null
    order by created_at limit 1;
  select id into v_a from auth.users
    where private.is_assignable_contractor(id, v_org)
    order by created_at, id limit 1;
  select id into v_b from auth.users
    where private.is_assignable_contractor(id, v_org) and id <> v_a
    order by created_at, id limit 1;
  if v_admin is null or v_a is null or v_b is null then
    raise exception 'Gate requires one existing Admin and two accepted test Contractors';
  end if;
  v_admin_claims := jsonb_build_object('sub',v_admin,'session_id',v_admin,'role','authenticated',
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',v_org))::text;
  v_a_claims := jsonb_build_object('sub',v_a,'session_id',v_a,'role','authenticated',
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',v_org))::text;
  v_b_claims := jsonb_build_object('sub',v_b,'session_id',v_b,'role','authenticated',
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',v_org))::text;

  foreach v_relation in array array['public.work_order_runs','public.work_order_assignments'] loop
    if not has_table_privilege('authenticated',v_relation,'SELECT') then
      raise exception 'Missing narrow history read grant';
    end if;
    foreach v_privilege in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('authenticated',v_relation,v_privilege)
         or has_table_privilege('anon',v_relation,v_privilege) then
        raise exception 'Unexpected client history write grant';
      end if;
    end loop;
    if has_table_privilege('anon',v_relation,'SELECT')
       or not (select relrowsecurity from pg_class where oid=v_relation::regclass) then
      raise exception 'History tables must have RLS and no anonymous read grant';
    end if;
  end loop;
  foreach v_function in array array[
    'private.prepare_work_order_run_identity()'::regprocedure,
    'private.create_initial_work_order_run()'::regprocedure,
    'private.sync_current_work_order_run()'::regprocedure] loop
    if has_function_privilege('authenticated',v_function,'EXECUTE')
       or has_function_privilege('anon',v_function,'EXECUTE') then
      raise exception 'Private trigger functions must not be client-callable';
    end if;
  end loop;

  -- Nested subtransaction also removes fixtures on success, using one
  -- deliberately caught sentinel. Every unexpected error escapes the gate.
  begin
    insert into public.organizations(name) values ('FWH PHASE 3A TEMPORARY TEST')
      returning id into v_other_org;
    insert into public.work_orders(organization_id,wo_number,property_address,work_type,due_date)
      values(v_other_org,v_number || '-FOREIGN','FWH TEMPORARY TEST','TEST ONLY',current_date)
      returning id into v_foreign_wo;

    perform set_config('request.jwt.claims',v_admin_claims,true);
    execute 'set local role authenticated';
    select work_order_id into v_wo from public.admin_create_work_order(
      false,v_number,'FWH TEMPORARY TEST','TEST ONLY','gate',current_date,v_a);
    select work_order_id into v_wo_b from public.admin_create_work_order(
      false,v_number || '-B','FWH TEMPORARY TEST B','TEST ONLY','gate',current_date,v_b);
    select current_run_id into v_run from public.work_orders where id=v_wo;
    select current_run_id into v_other_run from public.work_orders where id=v_wo_b;
    if v_run is null or (select count(*) from public.work_order_runs where id=v_run) <> 1
       or (select count(*) from public.work_order_assignments where run_id=v_run) <> 1 then
      raise exception 'Admin create did not create exactly one run and assignment';
    end if;
    if exists(select 1 from public.work_order_runs where work_order_id=v_foreign_wo) then
      raise exception 'Admin can see another organization run';
    end if;

    -- Invalid target and wrong-role Admin operation must be denied.
    v_denied:=false;
    begin
      perform public.admin_create_work_order(false,v_number || '-INVALID',
        'FWH TEMPORARY TEST','TEST ONLY','gate',current_date,gen_random_uuid());
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'Bogus assignee was accepted'; end if;
    perform set_config('request.jwt.claims',v_a_claims,true);
    v_denied:=false;
    begin
      perform public.admin_create_work_order(false,v_number || '-WRONGROLE',
        'FWH TEMPORARY TEST','TEST ONLY','gate',current_date,v_a);
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'Contractor performed an Admin action'; end if;
    if (select count(*) from public.work_order_runs where id=v_run) <> 1
       or exists(select 1 from public.work_order_runs where id=v_other_run)
       or exists(select 1 from public.work_order_assignments where assigned_user_id<>v_a)
       or exists(select 1 from public.work_order_runs where work_order_id=v_foreign_wo) then
      raise exception 'Contractor owner/organization isolation failed';
    end if;
    v_denied:=false;
    begin
      update public.work_order_runs set field_status='CANCELLED' where id=v_run;
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'Direct run update was accepted'; end if;
    v_denied:=false;
    begin
      update public.work_orders set field_status='CANCELLED' where id=v_wo;
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'Direct work-order update was accepted'; end if;

    select assignment_received_at into v_receipt from public.acknowledge_assignment_received(v_wo);
    perform public.acknowledge_assignment_received(v_wo);
    if v_receipt is null
       or (select assignment_received_at from public.work_order_runs where id=v_run) is distinct from v_receipt
       or (select assignment_received_at from public.work_order_assignments
           where run_id=v_run and assignment_ended_at is null) is distinct from v_receipt then
      raise exception 'Idempotent receipt did not reach the active assignment and run';
    end if;

    -- Reassign untouched work, clear receipt, preserve one run and closed history.
    perform set_config('request.jwt.claims',v_admin_claims,true);
    perform public.admin_update_work_order(v_wo,v_number,'FWH TEMPORARY TEST',
      'TEST ONLY','updated',current_date,v_b);
    if (select current_run_id from public.work_orders where id=v_wo) <> v_run
       or (select assignment_received_at from public.work_order_runs where id=v_run) is not null
       or (select count(*) from public.work_order_assignments where run_id=v_run) <> 2
       or (select count(*) from public.work_order_assignments
           where run_id=v_run and end_reason='REASSIGNED') <> 1 then
      raise exception 'Untouched reassignment corrupted run/receipt/history';
    end if;
    perform set_config('request.jwt.claims',v_a_claims,true);
    if exists(select 1 from public.work_order_runs where id=v_run) then
      raise exception 'Previous contractor still sees transferred run';
    end if;
    v_denied:=false;
    begin perform public.acknowledge_assignment_received(v_wo);
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'Previous contractor acknowledged new assignment'; end if;

    perform set_config('request.jwt.claims',v_b_claims,true);
    perform public.acknowledge_assignment_received(v_wo);
    select started_at into v_started from public.start_work(v_wo);
    perform public.start_work(v_wo);
    if v_started is null
       or (select started_at from public.work_order_runs where id=v_run) is distinct from v_started then
      raise exception 'Start did not preserve an idempotent run timestamp';
    end if;
    perform set_config('request.jwt.claims',v_admin_claims,true);
    perform public.admin_update_work_order(v_wo,v_number,'FWH TEMPORARY TEST',
      'TEST ONLY','handoff',current_date,v_a);
    if (select current_assignee_user_id from public.work_order_runs where id=v_run) <> v_b then
      raise exception 'Handoff transferred before consent';
    end if;
    perform set_config('request.jwt.claims',v_b_claims,true);
    perform public.respond_reassignment(v_wo,false);
    if (select current_assignee_user_id from public.work_order_runs where id=v_run) <> v_b then
      raise exception 'Declining handoff changed ownership';
    end if;
    perform set_config('request.jwt.claims',v_admin_claims,true);
    perform public.admin_update_work_order(v_wo,v_number,'FWH TEMPORARY TEST',
      'TEST ONLY','handoff',current_date,v_a);
    perform set_config('request.jwt.claims',v_b_claims,true);
    perform public.respond_reassignment(v_wo,true);
    perform set_config('request.jwt.claims',v_admin_claims,true);
    if (select current_assignee_user_id from public.work_order_runs where id=v_run) <> v_a
       or (select started_at from public.work_order_runs where id=v_run) is distinct from v_started
       or (select count(*) from public.work_order_assignments where run_id=v_run) <> 3
       or (select count(*) from public.work_order_assignments
           where run_id=v_run and assigned_user_id=v_b and end_reason='HANDOFF') <> 1 then
      raise exception 'Approved handoff lost identity, started state or history';
    end if;

    -- Receipt must reach the returned A assignment, even with equal timestamps.
    -- Completing before receipt additionally covers the closed FIELD_COMPLETE row.
    perform set_config('request.jwt.claims',v_a_claims,true);
    perform public.complete_field_work(v_wo);
    perform public.complete_field_work(v_wo);
    select assignment_received_at into v_receipt from public.acknowledge_assignment_received(v_wo);
    perform set_config('request.jwt.claims',v_admin_claims,true);
    if v_receipt is null
       or (select assignment_received_at from public.work_order_assignments
           where run_id=v_run and assigned_user_id=v_a and end_reason='FIELD_COMPLETE') is distinct from v_receipt
       or (select count(*) from public.work_order_assignments
           where run_id=v_run and assignment_ended_at is null) <> 0
       or (select field_status from public.work_order_runs where id=v_run) <> 'FIELD_COMPLETE' then
      raise exception 'Late completed-run receipt targeted a historical assignment';
    end if;

    -- Photo policy accepts exact WO/run metadata and rejects wrong bindings.
    perform set_config('request.jwt.claims',v_a_claims,true);
    insert into public.photos(id,work_order_id,run_id,captured_by,captured_at)
      values(gen_random_uuid(),v_wo,v_run,v_a,now());
    v_denied:=false;
    begin
      insert into public.photos(id,work_order_id,run_id,captured_by,captured_at)
        values(gen_random_uuid(),v_wo,v_other_run,v_a,now());
    exception when insufficient_privilege or foreign_key_violation then v_denied:=true;
    end;
    if not v_denied then raise exception 'Photo accepted a run belonging to another WO'; end if;
    v_denied:=false;
    begin
      insert into public.photos(id,work_order_id,run_id,captured_by,captured_at)
        values(gen_random_uuid(),v_wo_b,v_other_run,v_a,now());
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'Photo accepted another contractor WO'; end if;

    -- Wrong organization and role cannot acknowledge the current assignment.
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_a,'session_id',v_a,'role','authenticated',
      'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',v_other_org))::text,true);
    if exists(select 1 from public.work_order_runs where id=v_run)
       or exists(select 1 from public.work_order_assignments where run_id=v_run) then
      raise exception 'Cross-organization history became visible';
    end if;
    v_denied:=false;
    begin perform public.acknowledge_assignment_received(v_wo);
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'Cross-organization RPC succeeded'; end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_a,'session_id',v_a,'role','authenticated',
      'app_metadata',jsonb_build_object('role','VIEWER','organization_id',v_org))::text,true);
    v_denied:=false;
    begin perform public.acknowledge_assignment_received(v_wo);
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'Wrong-role RPC succeeded'; end if;
    execute 'reset role';
    execute 'set local role anon';
    v_denied:=false;
    begin perform count(*) from public.work_order_runs;
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'Anonymous history read succeeded'; end if;
    execute 'reset role';

    -- Force immediate checking of the deferred WO/run ownership constraint.
    set constraints all immediate;
    raise exception using errcode='ZX001',message='Gate passed; roll back all fixtures';
  exception when sqlstate 'ZX001' then
    null;
  end;
end;
$gate$;
select 'PASS: Phase 3A RPC, history, RLS/grants, receipt and photo identity; all fixtures rolled back' as result;
rollback;
