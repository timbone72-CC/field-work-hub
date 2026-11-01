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
  claim_source text;
  release_source text;
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
  select count(*) into before_old from private.client_delivery_dispatch_permit;
  select count(*) into before_new from private.client_delivery_package_dispatch_permits;
  select count(*) into before_outbox from private.client_delivery_outbox;
  result:=private.service_claim_package_and_acquire_dispatch(
    gen_random_uuid(),gen_random_uuid(),'synthetic_approved_root_123456',
    gen_random_uuid(),gen_random_uuid());
  if result is distinct from '{"claimed": false, "acquired": false}'::jsonb
  then raise exception 'Default-OFF claim must deny without mutating';end if;
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
