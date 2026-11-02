-- Phase 5D: database-backed single-flight permit for the EXISTING delivery Edge.
-- SOURCE ONLY. No cron/job, provider writes, new queue, automatic retry,
-- worker-ready switch, destination activation, or cleanup.
--
-- A persisted permit intentionally has NO TTL and cannot be stolen. Losing an
-- HTTP response or crashing during Google activity leaves the slot occupied
-- until a separately reviewed same-ID provider/lease reconciliation. Do not
-- casually clear this row or add an expiry-based takeover.
create table private.client_delivery_dispatch_permit (
  singleton boolean primary key default true check (singleton),
  request_id uuid not null unique,
  acquired_at timestamptz not null default clock_timestamp()
);
alter table private.client_delivery_dispatch_permit enable row level security;
revoke all on table private.client_delivery_dispatch_permit
  from public,anon,authenticated,service_role;

create function private.service_acquire_delivery_dispatch(p_request uuid)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $acquire$
declare acquired uuid;
begin
  if p_request is null then
    raise exception 'Worker request identity required' using errcode='22023';
  end if;
  -- A single PK arbitrates simultaneous sessions across Edge isolates and
  -- cron invocations; this is NOT a session-local advisory lock.
  insert into private.client_delivery_dispatch_permit(singleton,request_id)
    values(true,p_request) on conflict (singleton) do nothing
    returning request_id into acquired;
  return jsonb_build_object('acquired',acquired is not null);
end;
$acquire$;

create function public.service_acquire_delivery_dispatch(p_request uuid)
returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_acquire_delivery_dispatch(p_request)
$wrap$;

create function private.service_release_delivery_dispatch(p_request uuid)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $release$
declare removed uuid;
begin
  if p_request is null then
    raise exception 'Worker request identity required' using errcode='22023';
  end if;
  delete from private.client_delivery_dispatch_permit
   where singleton and request_id=p_request
   returning request_id into removed;
  if removed is distinct from p_request then
    raise exception 'Only the original dispatch may release its permit'
      using errcode='42501';
  end if;
  return jsonb_build_object('released',true);
end;
$release$;

create function public.service_release_delivery_dispatch(p_request uuid)
returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.service_release_delivery_dispatch(p_request)
$wrap$;

revoke all on function
  private.service_acquire_delivery_dispatch(uuid),
  public.service_acquire_delivery_dispatch(uuid),
  private.service_release_delivery_dispatch(uuid),
  public.service_release_delivery_dispatch(uuid)
  from public,anon,authenticated,service_role;
grant execute on function
  private.service_acquire_delivery_dispatch(uuid),
  public.service_acquire_delivery_dispatch(uuid),
  private.service_release_delivery_dispatch(uuid),
  public.service_release_delivery_dispatch(uuid)
  to service_role;
