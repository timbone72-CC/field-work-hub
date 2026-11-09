-- Phase 5D package-scoped permit gate. Real PostgreSQL, rollback only.
-- Never activate a worker, alter the legacy singleton or contact Google.
begin;
do $gate$
declare
  cfg private.client_delivery_package_dispatch_config%rowtype;
  before_old bigint;
  before_new bigint;
  before_outbox bigint;
  result jsonb;
  denied boolean:=false;
  old_function text:='public.service_acquire_delivery_dispatch(uuid)';
  claim_function text:='public.service_claim_package_and_acquire_dispatch(uuid,uuid,text,uuid,uuid)';
  release_function text:='public.service_release_package_dispatch(uuid,uuid,uuid,bigint)';
  read_function text:='public.service_read_package_dispatch_owner(uuid,uuid,uuid,bigint)';
  step_begin text:='public.service_begin_package_dispatch_step(uuid,uuid,uuid,bigint,uuid)';
  pinned_read text:='public.service_read_pinned_package_dispatch(uuid,uuid,text)';
  step_end text:='public.service_complete_package_dispatch_step(uuid,uuid,uuid,bigint,uuid,text)';
  photo_scope text:='private.service_bounded_frozen_photo_ids(jsonb)';
  bounded_source text;
  provider_source text;
  resume_source text;
  claim_source text;
  release_source text;
  central_guard text;
begin
  select * into cfg from private.client_delivery_package_dispatch_config where singleton;
  if cfg.singleton is null or cfg.enabled or cfg.legacy_worker_off_verified
    or cfg.max_in_flight<>2
    or (select count(*) from private.client_delivery_package_dispatch_config)<>1
  then raise exception 'Package permit activation must be disabled, cap two';end if;
  if not (select relrowsecurity from pg_class
    where oid='private.client_delivery_package_dispatch_permits'::regclass)
    or not (select relrowsecurity from pg_class
    where oid='private.client_delivery_package_dispatch_config'::regclass)
  then raise exception 'New private permit tables must have RLS enabled';end if;
  if has_table_privilege('service_role',
       'private.client_delivery_package_dispatch_permits','INSERT')
    or has_table_privilege('service_role',
       'private.client_delivery_package_dispatch_permits','DELETE')
    or has_table_privilege('authenticated',
       'private.client_delivery_package_dispatch_permits','SELECT')
    or has_table_privilege('anon',
       'private.client_delivery_package_dispatch_config','SELECT')
    or has_table_privilege('service_role',
       'private.client_delivery_package_dispatch_config','UPDATE')
  then raise exception 'Direct package permit/control table access must be denied';end if;
  if to_regprocedure(pinned_read) is null
    or not has_function_privilege('service_role',pinned_read,'EXECUTE')
    or has_function_privilege('anon',pinned_read,'EXECUTE')
    or has_function_privilege('authenticated',pinned_read,'EXECUTE')
  then raise exception 'Pinned package snapshot must be service-only';end if;
  if to_regprocedure(step_begin) is null or to_regprocedure(step_end) is null
    or not has_function_privilege('service_role',step_begin,'EXECUTE')
    or not has_function_privilege('service_role',step_end,'EXECUTE')
    or has_function_privilege('anon',step_begin,'EXECUTE')
    or has_function_privilege('authenticated',step_end,'EXECUTE')
    or has_table_privilege('service_role',
       'private.client_delivery_package_step_attempts','INSERT')
    or has_table_privilege('authenticated',
       'private.client_delivery_package_step_attempts','SELECT')
    or not (select relrowsecurity from pg_class
       where oid='private.client_delivery_package_step_attempts'::regclass)
  then raise exception 'Durable step gate must be private/service-only';end if;
  if to_regprocedure(read_function) is null
    or not has_function_privilege('service_role',read_function,'EXECUTE')
    or has_function_privilege('anon',read_function,'EXECUTE')
    or has_function_privilege('authenticated',read_function,'EXECUTE')
  then raise exception 'Package owner proof must be service only';end if;
  if to_regprocedure(claim_function) is null
    or to_regprocedure(release_function) is null
    or to_regprocedure(old_function) is null
    or not has_function_privilege('service_role',claim_function,'EXECUTE')
    or not has_function_privilege('service_role',release_function,'EXECUTE')
    or has_function_privilege('anon',claim_function,'EXECUTE')
    or has_function_privilege('authenticated',claim_function,'EXECUTE')
    or has_function_privilege('anon',release_function,'EXECUTE')
    or has_function_privilege('authenticated',release_function,'EXECUTE')
  then raise exception 'New private RPCs must be service-only and legacy intact';end if;
  if to_regprocedure(photo_scope) is null
    or has_function_privilege('anon',photo_scope,'EXECUTE')
    or has_function_privilege('authenticated',photo_scope,'EXECUTE')
    or has_function_privilege('service_role',photo_scope,'EXECUTE')
  then raise exception 'Frozen photo helper must exist and stay private';end if;
  if not private.service_bounded_frozen_photo_ids(
      '[{"photo_id":"11111111-1111-4111-8111-111111111111"},
        {"photo_id":"22222222-2222-4222-8222-222222222222"}]'::jsonb)
    or not private.service_bounded_frozen_photo_ids(
      (select jsonb_agg(jsonb_build_object('photo_id',gen_random_uuid()))
         from generate_series(1,200)))
    or private.service_bounded_frozen_photo_ids('[]'::jsonb)
    or private.service_bounded_frozen_photo_ids('null'::jsonb)
    or private.service_bounded_frozen_photo_ids('{}'::jsonb)
    or private.service_bounded_frozen_photo_ids('[{"photo_id":"bad"}]'::jsonb)
    or private.service_bounded_frozen_photo_ids(
      '[{"photo_id":"11111111-1111-4111-8111-111111111111"},
        {"photo_id":"11111111-1111-4111-8111-111111111111"}]'::jsonb)
    or private.service_bounded_frozen_photo_ids(
      '[{"photo_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
        {"photo_id":"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"}]'::jsonb)
    or private.service_bounded_frozen_photo_ids(
      (select jsonb_agg(jsonb_build_object('photo_id',gen_random_uuid()))
         from generate_series(1,201)))
  then raise exception 'Frozen 1-200 photo ID proof accepted malformed/duplicate bounds';end if;
  provider_source:=pg_get_functiondef(
    'private.service_record_pinned_package_provider_check(uuid,uuid,text,text,text,text,timestamptz,uuid)'::regprocedure);
  resume_source:=pg_get_functiondef(
    'private.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid)'::regprocedure);
  if position('private.service_bounded_frozen_photo_ids' in provider_source)=0
    or position('private.service_bounded_frozen_photo_ids' in resume_source)=0
    or not has_function_privilege('service_role',
       'public.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid)','EXECUTE')
    or has_function_privilege('authenticated',
       'public.service_resume_pinned_package_dispatch(uuid,uuid,text,uuid,uuid,bigint,text,text,text,timestamptz,uuid)','EXECUTE')
  then raise exception 'Package provider/renewal bounded scope or service gate missing';end if;
  claim_source:=pg_get_functiondef('private.service_claim_package_and_acquire_dispatch(uuid,uuid,text,uuid,uuid)'::regprocedure);
  release_source:=pg_get_functiondef('private.service_release_package_dispatch(uuid,uuid,uuid,bigint)'::regprocedure);
  if position('service_claim_delivery(' in claim_source)>0
    or position('private.client_delivery_package_dispatch_config' in claim_source)=0
    or position('for update' in lower(claim_source))=0
    or position('private.client_delivery_package_dispatch_permits' in claim_source)=0
    or position('on conflict (package_id) do nothing' in lower(claim_source))=0
    or position('private.client_delivery_final_receipts' in release_source)=0
    or position('o.state' in release_source)=0
  then raise exception 'Exact atomic package ownership or final receipt fence missing';end if;
  if position('private.client_delivery_package_step_attempts' in release_source)=0
  then raise exception 'Unfinished package step cannot release permit';end if;
  central_guard:=pg_get_functiondef(
   'private.service_delivery_guard(uuid,uuid,bigint)'::regprocedure);
  if position('private.client_delivery_package_dispatch_permits' in central_guard)=0
    or position('cfg.enabled or cfg.legacy_worker_off_verified' in central_guard)=0
    or position('held.worker_id is distinct from p_worker' in central_guard)=0
    or position('o.lease_generation is distinct from p_generation' in central_guard)=0
    or position('for share' in lower(central_guard))=0
    or position('private.client_delivery_package_step_attempts' in central_guard)=0
  then raise exception 'Central legacy/package cutover fence missing';end if;
  select count(*) into before_old from private.client_delivery_dispatch_permit;
  select count(*) into before_new from private.client_delivery_package_dispatch_permits;
  select count(*) into before_outbox from private.client_delivery_outbox;
  result:=private.service_claim_package_and_acquire_dispatch(
    gen_random_uuid(),gen_random_uuid(),'synthetic_approved_root_123456',
    gen_random_uuid(),gen_random_uuid());
  if result is distinct from '{"claimed": false, "acquired": false}'::jsonb
  then raise exception 'Default-OFF claim must deny without mutating';end if;
  result:=private.service_read_pinned_package_dispatch(
    gen_random_uuid(),gen_random_uuid(),'safe_test_root_123456');
  if result is distinct from '{"present":false,"active":false}'::jsonb
  then raise exception 'Default OFF pinned snapshot must deny';end if;
  result:=private.service_begin_package_dispatch_step(
   gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,gen_random_uuid());
  if result is distinct from '{"acquired":false}'::jsonb
  then raise exception 'Default OFF package step unexpectedly admitted';end if;
  result:=private.service_read_package_dispatch_owner(
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1);
  if result is distinct from '{"active":false}'::jsonb
  then raise exception 'Inactive permit owner proof must deny';end if;
  begin
    perform private.service_release_package_dispatch(
      gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1);
  exception when others then denied:=true;end;
  if not denied then raise exception 'Unknown package permit was released';end if;
  if (select count(*) from private.client_delivery_dispatch_permit)<>before_old
    or (select count(*) from private.client_delivery_package_dispatch_permits)<>before_new
    or (select count(*) from private.client_delivery_outbox)<>before_outbox
  then raise exception 'Denied package RPC altered original/new dispatch state';end if;
  raise notice 'PASS: disabled-by-default exact package permit, service-only grants, no legacy mutation';
end;
$gate$;
rollback;
