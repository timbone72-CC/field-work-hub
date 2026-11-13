-- Disposable PostgreSQL only. Rollback restores selector/transport fixtures.
-- Real SQL authorization and transaction tests; HTTP transport is simulated.
begin;
create schema net;
create table net.fwh_ci_requests(id bigint generated always as identity, headers jsonb, body jsonb, url text);
create function net.http_post(url text, body jsonb default '{}'::jsonb,
 params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
 timeout_milliseconds integer default 1000)
returns bigint language plpgsql as $stub$
declare result bigint;
begin
 if current_setting('fwh.test_transport_fails',true)='true' then
  raise exception 'Synthetic unavailable transport';end if;
 insert into net.fwh_ci_requests(headers,body,url) values(headers,body,url) returning id into result;
 return result;
end;
$stub$;
-- Isolate notification admission from provider fixtures. Existing selector
-- fairness and exact-package claims are covered by their independent gates.
create or replace function private.service_select_next_delivery_package()
returns jsonb language sql security definer set search_path='' as $fixture$
 select jsonb_build_object('available',
   coalesce(current_setting('fwh.test_eligible',true),'true')='true');
$fixture$;

do $gate$
declare ticket uuid; token text; n bigint; result jsonb;
begin
 if (select enabled from private.client_delivery_event_wake where singleton)
 then raise exception 'Event transport must default OFF';end if;
 if has_table_privilege('anon','private.client_delivery_event_wake','SELECT')
   or has_table_privilege('authenticated','private.client_delivery_event_wake','UPDATE')
   or has_table_privilege('service_role','private.client_delivery_event_wake','SELECT')
   or not (select relrowsecurity from pg_class where oid='private.client_delivery_event_wake'::regclass)
 then raise exception 'Wake state must remain private with RLS';end if;
 foreach token in array array['anon','authenticated'] loop
  if has_function_privilege(token,'public.service_consume_client_delivery_wake(uuid,text)','EXECUTE')
    or has_function_privilege(token,'private.service_consume_client_delivery_wake(uuid,text)','EXECUTE')
    or has_function_privilege(token,'private.request_client_delivery_wake()','EXECUTE')
  then raise exception 'Ordinary user can invoke wake authority';end if;
 end loop;
 if not has_function_privilege('service_role','public.service_consume_client_delivery_wake(uuid,text)','EXECUTE')
 then raise exception 'Service admission missing';end if;
 if private.request_client_delivery_wake() or exists(select 1 from net.fwh_ci_requests)
 then raise exception 'OFF transport issued request';end if;
 update private.client_delivery_event_wake set enabled=true where singleton;
 perform set_config('fwh.test_eligible','false',true);
 if private.request_client_delivery_wake() then raise exception 'Idle work issued wake';end if;
 perform set_config('fwh.test_eligible','true',true);
 if not private.request_client_delivery_wake() then raise exception 'Eligible work did not wake';end if;
 select (headers->>'x-fwh-wake-id')::uuid,headers->>'x-fwh-wake-token'
 into ticket,token from net.fwh_ci_requests order by id desc limit 1;
 if length(token)<>64 or (select token_sha256 from private.client_delivery_event_wake)=token
   or exists(select 1 from net.fwh_ci_requests where headers ? 'x-fwh-delivery-secret'
     or body<>'{"operation":"advance_queued_package_once"}'::jsonb
     or url<>'https://vyocaujuwrivoqynvitm.supabase.co/functions/v1/client-delivery')
 then raise exception 'Unsafe credential or payload';end if;
 if private.request_client_delivery_wake() or (select count(*) from net.fwh_ci_requests)<>1
 then raise exception 'Pending notification was not coalesced';end if;
 -- Admission remains blocked while SQL dispatch is OFF.
 if (private.service_consume_client_delivery_wake(ticket,token)->>'accepted')::boolean
 then raise exception 'Disabled dispatch admitted event';end if;
 update private.client_delivery_package_dispatch_config
   set enabled=true,legacy_worker_off_verified=true where singleton;
 if (private.service_consume_client_delivery_wake(gen_random_uuid(),token)->>'accepted')::boolean
   or (private.service_consume_client_delivery_wake(ticket,repeat('b',64))->>'accepted')::boolean
 then raise exception 'Wrong ticket/token admitted';end if;
 result:=public.service_consume_client_delivery_wake(ticket,token);
 if result<>'{"accepted":true}'::jsonb then raise exception 'Valid admission failed';end if;
 if (public.service_consume_client_delivery_wake(ticket,token)->>'accepted')::boolean
 then raise exception 'Ticket replay admitted';end if;
 if not private.request_client_delivery_wake() then raise exception 'Consumed wake did not allow continuation';end if;
 select (headers->>'x-fwh-wake-id')::uuid,headers->>'x-fwh-wake-token'
 into ticket,token from net.fwh_ci_requests order by id desc limit 1;
 update private.client_delivery_event_wake set expires_at=clock_timestamp()-interval '1 second';
 if (private.service_consume_client_delivery_wake(ticket,token)->>'accepted')::boolean
 then raise exception 'Expired ticket admitted';end if;
 -- A rolled-back caller cannot leave a ticket or HTTP notification behind.
 select count(*) into n from net.fwh_ci_requests;
 begin
  perform private.request_client_delivery_wake();
  raise exception 'ROLLBACK_NOTIFICATION';
 exception when raise_exception then null;
 end;
 if (select count(*) from net.fwh_ci_requests)<>n
 then raise exception 'Rolled-back event escaped transaction';end if;
 perform set_config('fwh.test_transport_fails','true',true);
 if private.request_client_delivery_wake()
   or (select transport_problem from private.client_delivery_event_wake)<>'WAKE_TRANSPORT_UNAVAILABLE'
 then raise exception 'Transport failure must preserve durable caller and report safe problem';end if;
 perform set_config('fwh.test_transport_fails','false',true);
 if not private.request_client_delivery_wake() then raise exception 'Transport could not recover';end if;
 -- Verify both actual trigger attachment/event filters, not a second caller.
 if not exists(select 1 from pg_trigger where tgname='client_delivery_send_wake'
    and tgrelid='private.client_delivery_outbox'::regclass and (tgtype & 4)=4)
   or not exists(select 1 from pg_trigger where tgname='client_delivery_verified_step_wake'
    and tgrelid='private.client_delivery_package_step_attempts'::regclass
    and pg_get_triggerdef(oid) like '%old.verified_at IS NULL%'
    and pg_get_triggerdef(oid) like '%new.verified_at IS NOT NULL%')
 then raise exception 'Missing committed Send/verified continuation event';end if;
 raise notice 'PASS: private wake admission, one-use/expiry, coalescing, rollback and transport recovery (simulated HTTP)';
end;
$gate$;
rollback;
