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
