-- Disposable CI proof for the FWH 5D-T03 pg_net privilege hardening.
-- This simulates pg_net's permissive default table ACLs without contacting
-- any provider, creating wake tickets, or altering an installed backend.
begin;
create schema net;
create table net.http_request_queue(id bigint primary key);
create table net._http_response(id bigint primary key);
grant usage on schema net to public;
grant all privileges on table net.http_request_queue, net._http_response
  to public, anon, authenticated;

do $pre$
begin
  if not has_table_privilege('anon', 'net.http_request_queue', 'SELECT')
     or not has_table_privilege('authenticated', 'net._http_response', 'SELECT')
  then raise exception 'FWH_WAKE_ACL_TEST_NOT_PERMISSIVE'; end if;
end;
$pre$;

-- Exercise the actual new migration against the synthetic queue/response.
\i supabase/migrations/20261115124000_phase_5d_event_net_privileges.sql

do $gate$
declare r text; t text;
begin
  foreach r in array array['anon','authenticated'] loop
    foreach t in array array['net.http_request_queue','net._http_response'] loop
      if has_table_privilege(r,t,'SELECT')
         or has_table_privilege(r,t,'INSERT')
         or has_table_privilege(r,t,'UPDATE')
         or has_table_privilege(r,t,'DELETE') then
        raise exception 'FWH_WAKE_NET_ACL_NOT_RESTRICTED: % %',r,t;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('postgres','net.http_request_queue','INSERT')
     or not has_table_privilege('postgres','net._http_response','SELECT') then
    raise exception 'FWH_WAKE_NET_PRIVILEGED_OWNER_LOST_ACCESS';
  end if;
  raise notice 'PASS: pg_net internal tables denied to ordinary client roles';
end;
$gate$;
rollback;
