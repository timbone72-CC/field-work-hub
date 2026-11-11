-- FWH-F04: read-only server-selected queue gate, disposable PostgreSQL.
-- Tests never enable dispatch, acquire permits, requeue, or write to Google.
begin;
do $gate$
declare
  result jsonb;
  before_held bigint;
  before_new bigint;
  before_outbox bigint;
  before_receipts bigint;
  source text;
  too_many jsonb;
  signature text:='public.service_select_next_delivery_package()';
begin
  if to_regprocedure(signature) is null
    or not has_function_privilege('service_role',signature,'EXECUTE')
    or has_function_privilege('anon',signature,'EXECUTE')
    or has_function_privilege('authenticated',signature,'EXECUTE')
    or has_function_privilege('anon','private.service_select_next_delivery_package()','EXECUTE')
    or has_function_privilege('authenticated','private.service_select_next_delivery_package()','EXECUTE')
  then raise exception 'Queue selector must be accessible to service_role only';end if;

  select count(*) into before_held from private.client_delivery_dispatch_permit;
  select count(*) into before_new from private.client_delivery_package_dispatch_permits;
  select count(*) into before_outbox from private.client_delivery_outbox;
  select count(*) into before_receipts from private.client_delivery_final_receipts;

  if (select enabled or not legacy_worker_off_verified
      from private.client_delivery_package_dispatch_config where singleton)
     is distinct from false
  then
    -- This schema fixture is deliberately OFF and keeps the legacy worker
    -- cutover attestation separately; never enable service in this CI gate.
    if (select enabled from private.client_delivery_package_dispatch_config where singleton)
    then raise exception 'Queue selector CI must be OFF';end if;
  end if;

  -- 5D-T02: exact empty-array acceptance, no malformed or duplicate IDs.
  select jsonb_agg(jsonb_build_object('photo_id',
    'abcdef01-0000-4000-8000-'||lpad(to_hex(n),12,'0')))
    into too_many from generate_series(1,201) g(n);
  if private.service_bounded_frozen_photo_ids('[]'::jsonb) is distinct from true
    or private.service_bounded_frozen_photo_ids(
      '[{"photo_id":"abcdef01-0000-4000-8000-000000000001"}]'::jsonb)
      is distinct from true
    or private.service_bounded_frozen_photo_ids('null'::jsonb) is distinct from false
    or private.service_bounded_frozen_photo_ids('{}'::jsonb) is distinct from false
    or private.service_bounded_frozen_photo_ids(
      '[{"photo_id":"not-a-uuid"}]'::jsonb) is distinct from false
    or private.service_bounded_frozen_photo_ids(
      '[{"photo_id":"abcdef01-0000-4000-8000-000000000001"},'
      ||'{"photo_id":"ABCDEF01-0000-4000-8000-000000000001"}]' ) is distinct from false
    or private.service_bounded_frozen_photo_ids(too_many) is distinct from false
    or has_function_privilege('anon',
      'private.service_bounded_frozen_photo_ids(jsonb)','EXECUTE')
    or has_function_privilege('authenticated',
      'private.service_bounded_frozen_photo_ids(jsonb)','EXECUTE')
    or has_function_privilege('service_role',
      'private.service_bounded_frozen_photo_ids(jsonb)','EXECUTE')
  then raise exception 'Manifest-only frozen selection authorization/bounds changed';end if;

  result:=private.service_select_next_delivery_package();
  if result is distinct from '{"available":false}'::jsonb
  then raise exception 'OFF selector returned delivery package identity';end if;
  result:=public.service_select_next_delivery_package();
  if result is distinct from '{"available":false}'::jsonb
  then raise exception 'OFF public wrapper returned package identity';end if;

  source:=pg_get_functiondef('private.service_select_next_delivery_package()'::regprocedure);
  if position('private.client_delivery_package_dispatch_config' in source)=0
    or position('private.client_delivery_package_dispatch_permits' in source)=0
    or position('private.client_delivery_package_step_attempts' in source)=0
    or position('s.verified_at is null' in source)=0
    or position('v.verified_outcome in' in source)=0
    or position('o.lease_until<=clock_timestamp()' in source)=0
    or position('private.client_delivery_final_receipts' in source)=0
    or position('o.state=' in source)=0
    or position('clock_timestamp()' in source)=0
  then raise exception 'Package selection misses exact lease/step/receipt recovery boundary';end if;

  if (select count(*) from private.client_delivery_dispatch_permit)<>before_held
    or (select count(*) from private.client_delivery_package_dispatch_permits)<>before_new
    or (select count(*) from private.client_delivery_outbox)<>before_outbox
    or (select count(*) from private.client_delivery_final_receipts)<>before_receipts
  then raise exception 'Read-only queue selector modified protected delivery state';end if;
  raise notice 'PASS: queue selector OFF, service-only, no legacy mutation; expired safe-step fence present';
end;
$gate$;
rollback;
