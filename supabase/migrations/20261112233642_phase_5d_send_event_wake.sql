-- Phase 5D / FWH-F04: notifications for the EXISTING fenced queue worker.
-- New transport defaults OFF. No extension/cron install, activation or Send.
-- Only a random single-use, expiring wake token enters pg_net; never reusable
-- worker/service/OAuth credentials or a caller-selected package/destination.
create table private.client_delivery_event_wake (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null default false,
 ticket_id uuid,
 token_sha256 text check (token_sha256 ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz,
 consumed_at timestamptz,
 last_enqueued_at timestamptz,
 last_consumed_at timestamptz,
 transport_problem text check (transport_problem in ('WAKE_TRANSPORT_UNAVAILABLE'))
);
insert into private.client_delivery_event_wake(singleton) values(true);
alter table private.client_delivery_event_wake enable row level security;
revoke all on private.client_delivery_event_wake from public,anon,authenticated,service_role;

-- One notification producer, shared by Send, verified-step events and the
-- separately authorized recovery cron. No package claim or provider replay.
create function private.request_client_delivery_wake()
returns boolean language plpgsql security definer set search_path='' as $wake$
declare
 cfg private.client_delivery_event_wake%rowtype;
 token text; ticket uuid; selected jsonb;
begin
 select * into cfg from private.client_delivery_event_wake
   where singleton for update;
 if cfg.singleton is null or not cfg.enabled then return false;end if;
 if cfg.ticket_id is not null and cfg.consumed_at is null
   and cfg.expires_at>clock_timestamp() then return false;end if;
 selected:=private.service_select_next_delivery_package();
 if selected->>'available' is distinct from 'true' then return false;end if;
 -- Three independent CSPRNG UUIDs supply >256 bits before SHA-256 encoding.
 token:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text
   ||gen_random_uuid()::text,'UTF8')),'hex');
 ticket:=gen_random_uuid();
 begin
  update private.client_delivery_event_wake set ticket_id=ticket,
    token_sha256=encode(sha256(convert_to(token,'UTF8')),'hex'),
    expires_at=clock_timestamp()+interval '60 seconds',consumed_at=null,
    last_enqueued_at=clock_timestamp(),transport_problem=null where singleton;
  -- pg_net dispatches only after commit. Missing/failed transport rolls back
  -- this subtransaction, not the caller's durable Send/verified step.
  perform net.http_post(
    url:='https://vyocaujuwrivoqynvitm.supabase.co/functions/v1/client-delivery',
    body:='{"operation":"advance_queued_package_once"}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json',
      'x-fwh-wake-id',ticket::text,'x-fwh-wake-token',token),
    timeout_milliseconds:=40000);
  return true;
 exception when others then
  update private.client_delivery_event_wake
    set transport_problem='WAKE_TRANSPORT_UNAVAILABLE' where singleton;
  return false;
 end;
end;
$wake$;
revoke all on function private.request_client_delivery_wake() from public,anon,authenticated,service_role;

create function private.service_consume_client_delivery_wake(p_ticket uuid,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $consume$
declare accepted uuid;
begin
 if p_ticket is null or p_token is null or p_token !~ '^[a-f0-9]{64}$'
 then return '{"accepted":false}'::jsonb;end if;
 update private.client_delivery_event_wake w set consumed_at=clock_timestamp(),
   last_consumed_at=clock_timestamp()
 where w.singleton and w.enabled and w.ticket_id=p_ticket
   and w.token_sha256=encode(sha256(convert_to(p_token,'UTF8')),'hex')
   and w.expires_at>clock_timestamp() and w.consumed_at is null
   and exists(select 1 from private.client_delivery_package_dispatch_config d
     where d.singleton and d.enabled and d.legacy_worker_off_verified)
 returning w.ticket_id into accepted;
 return jsonb_build_object('accepted',accepted is not null);
end;
$consume$;
create function public.service_consume_client_delivery_wake(p_ticket uuid,p_token text)
returns jsonb language sql security invoker set search_path='' as $wrapper$
 select private.service_consume_client_delivery_wake(p_ticket,p_token);
$wrapper$;
revoke all on function private.service_consume_client_delivery_wake(uuid,text) from public,anon,authenticated;
revoke all on function public.service_consume_client_delivery_wake(uuid,text) from public,anon,authenticated;
grant execute on function private.service_consume_client_delivery_wake(uuid,text) to service_role;
grant execute on function public.service_consume_client_delivery_wake(uuid,text) to service_role;

create function private.notify_client_delivery_wake()
returns trigger language plpgsql security definer set search_path='' as $notify$
begin
 -- An infrastructure failure must not undo committed delivery evidence.
 begin
  perform private.request_client_delivery_wake();
 exception when others then
  -- Do not log raw SQL/provider messages or token data. The recovery cron can
  -- reselect safe work after a transient database/transport failure.
  null;
 end;
 return new;
end;
$notify$;
revoke all on function private.notify_client_delivery_wake() from public,anon,authenticated,service_role;
create trigger client_delivery_send_wake
 after insert on private.client_delivery_outbox
 for each row execute function private.notify_client_delivery_wake();
create trigger client_delivery_verified_step_wake
 after update of verified_at on private.client_delivery_package_step_attempts
 for each row when (old.verified_at is null and new.verified_at is not null
   and new.verified_outcome in ('VERIFIED_METADATA_STEP','VERIFIED_PROVIDER_STEP','VERIFIED_FINAL_RECEIPT'))
 execute function private.notify_client_delivery_wake();
