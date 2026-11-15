-- FWH 5D-T03: block client roles from reading or changing pg_net wake transport.
-- The one-use event token is in net.http_request_queue briefly before delivery;
-- granting PUBLIC SQL access to pg_net internal tables fails the activation gate.
-- This is only transport-table privilege hardening. Existing work orders,
-- package/outbox identity, provider receipts and independent SQL dispatch stay intact.
-- Disposable CI PostgreSQL does not install pg_net; skip when both the extension
-- and its tables are absent, and verify the hosted pg_net install before activation.
do $fwh_net_acl$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net')
     and to_regclass('net.http_request_queue') is null
     and to_regclass('net._http_response') is null then
    return;
  end if;

  if to_regclass('net.http_request_queue') is null
     or to_regclass('net._http_response') is null then
    raise exception 'FWH_WAKE_NET_TABLES_MISSING';
  end if;

  revoke all privileges on table net.http_request_queue, net._http_response
    from public, anon, authenticated;

  if has_schema_privilege('anon', 'net', 'USAGE')
     and (has_table_privilege('anon', 'net.http_request_queue', 'SELECT')
          or has_table_privilege('anon', 'net.http_request_queue', 'INSERT')
          or has_table_privilege('anon', 'net.http_request_queue', 'UPDATE')
          or has_table_privilege('anon', 'net._http_response', 'SELECT')) then
    raise exception 'FWH_WAKE_NET_ANON_ACL_UNSAFE';
  end if;
  if has_schema_privilege('authenticated', 'net', 'USAGE')
     and (has_table_privilege('authenticated', 'net.http_request_queue', 'SELECT')
          or has_table_privilege('authenticated', 'net.http_request_queue', 'INSERT')
          or has_table_privilege('authenticated', 'net.http_request_queue', 'UPDATE')
          or has_table_privilege('authenticated', 'net._http_response', 'SELECT')) then
    raise exception 'FWH_WAKE_NET_AUTH_ACL_UNSAFE';
  end if;
end;
$fwh_net_acl$;
