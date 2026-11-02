-- Protected Drive upload sessions: encrypted in the trusted worker with
-- AES-GCM; only ciphertext, nonce and immutable reserved file identity persist.
-- This migration does NOT contain a key, real session URL, credentials, or cron.
create table private.client_delivery_upload_sessions (
  file_plan_id uuid primary key references private.client_delivery_file_plans(id) on delete restrict,
  package_id uuid not null references private.client_packages(id) on delete restrict,
  ciphertext jsonb not null,
  recorded_offset bigint not null default 0 check(recorded_offset>=0),
  total_bytes bigint not null check(total_bytes>0 and total_bytes<=33554432),
  state text not null default 'SESSION_STARTED'
    check(state in ('SESSION_STARTED','UPLOADING','VERIFYING','UNCERTAIN')),
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  last_checked_at timestamptz,
  check(jsonb_typeof(ciphertext)='object'
    and ciphertext ? 'version' and ciphertext ? 'nonce' and ciphertext ? 'payload'
    and ciphertext->>'version'='1')
);
-- Plaintext session URLs, Google access tokens and refresh tokens never appear
-- in the source, SQL rows, audit JSON, or browser responses.
create index client_delivery_upload_sessions_package_idx
 on private.client_delivery_upload_sessions(package_id,state);
alter table private.client_delivery_upload_sessions enable row level security;
revoke all on private.client_delivery_upload_sessions
 from public,anon,authenticated,service_role;
grant select on private.client_delivery_upload_sessions to service_role;

create function private.service_store_upload_session(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid,p_sealed jsonb
) returns jsonb language plpgsql security definer set search_path='' as $save$
declare f private.client_delivery_file_plans%rowtype;
 existing private.client_delivery_upload_sessions%rowtype;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into f from private.client_delivery_file_plans where id=p_plan for update;
 if f.id is null or f.package_id<>p_package or f.kind not in ('PHOTO','MANIFEST')
   or f.state<>'PREALLOCATED' or f.expected_size is null then
   raise exception 'Exact reserved upload file required' using errcode='42501';end if;
 if p_sealed is null or jsonb_typeof(p_sealed)<>'object'
   or (select array_agg(k order by k) from jsonb_object_keys(p_sealed) k)
         is distinct from array['nonce','payload','version']::text[]
   or p_sealed->>'version'<>'1'
   or char_length(coalesce(p_sealed->>'nonce','')) not between 16 and 32
   or (p_sealed->>'nonce') !~ '^[A-Za-z0-9_-]+$'
   or char_length(coalesce(p_sealed->>'payload','')) not between 50 and 8000
   or (p_sealed->>'payload') !~ '^[A-Za-z0-9_-]+$'
 then raise exception 'Encrypted session envelope required' using errcode='22023';end if;
 select * into existing from private.client_delivery_upload_sessions where file_plan_id=p_plan for update;
 if found then
   if existing.ciphertext is distinct from p_sealed or existing.total_bytes<>f.expected_size then
     raise exception 'Existing provider session must be reconciled, not replaced' using errcode='40001';end if;
 else
   insert into private.client_delivery_upload_sessions(file_plan_id,package_id,ciphertext,total_bytes)
     values(p_plan,p_package,p_sealed,f.expected_size);
 end if;
 return jsonb_build_object('file_plan_id',p_plan,'state','SESSION_STARTED','already_reserved',existing.file_plan_id is not null);
end;
$save$;
create function public.service_store_upload_session(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid,p_sealed jsonb
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_store_upload_session(p_package,p_worker,p_generation,p_plan,p_sealed)
$wrap$;
revoke all on function private.service_store_upload_session(uuid,uuid,bigint,uuid,jsonb),
 public.service_store_upload_session(uuid,uuid,bigint,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.service_store_upload_session(uuid,uuid,bigint,uuid,jsonb),
 public.service_store_upload_session(uuid,uuid,bigint,uuid,jsonb) to service_role;

-- Offset is from a real provider HEAD/status reply. Server forbids backward
-- progress, skipping end-of-file and unauthorized/stale worker writes.
create function private.service_record_upload_offset(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid,
 p_offset bigint,p_complete_candidate boolean
) returns jsonb language plpgsql security definer set search_path='' as $progress$
declare f private.client_delivery_file_plans%rowtype;
 sess private.client_delivery_upload_sessions%rowtype;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 if p_offset is null or p_complete_candidate is null then
   raise exception 'Observed provider offset required' using errcode='22023';end if;
 select * into f from private.client_delivery_file_plans where id=p_plan for update;
 select * into sess from private.client_delivery_upload_sessions where file_plan_id=p_plan for update;
 if f.id is null or sess.file_plan_id is null or f.package_id<>p_package
   or sess.package_id<>p_package or f.state<>'PREALLOCATED'
   or sess.state='UNCERTAIN' or p_offset<sess.recorded_offset
   or p_offset>sess.total_bytes or (p_complete_candidate and p_offset<>sess.total_bytes)
   or (not p_complete_candidate and p_offset=sess.total_bytes) then
   raise exception 'Provider offset uncertain or mismatched; reconcile before retry' using errcode='40001';end if;
 update private.client_delivery_upload_sessions set
   recorded_offset=p_offset,last_checked_at=clock_timestamp(),
   state=case when p_complete_candidate then 'VERIFYING' else 'UPLOADING' end,
   revision=revision+1 where file_plan_id=p_plan;
 return jsonb_build_object('file_plan_id',p_plan,'recorded_offset',p_offset,
   'state',case when p_complete_candidate then 'VERIFYING' else 'UPLOADING' end);
end;
$progress$;
create function public.service_record_upload_offset(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid,
 p_offset bigint,p_complete_candidate boolean
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_record_upload_offset(p_package,p_worker,p_generation,p_plan,
  p_offset,p_complete_candidate)
$wrap$;
revoke all on function private.service_record_upload_offset(uuid,uuid,bigint,uuid,bigint,boolean),
 public.service_record_upload_offset(uuid,uuid,bigint,uuid,bigint,boolean)
 from public,anon,authenticated,service_role;
grant execute on function private.service_record_upload_offset(uuid,uuid,bigint,uuid,bigint,boolean),
 public.service_record_upload_offset(uuid,uuid,bigint,uuid,bigint,boolean) to service_role;

-- Encrypted session recovery is an internal service-role-only, current-lease
-- capability. It must never be returned through an ordinary Admin RPC.
create function private.service_read_upload_session(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language plpgsql security definer set search_path='' as $readsession$
declare f private.client_delivery_file_plans%rowtype;
 sess private.client_delivery_upload_sessions%rowtype;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into f from private.client_delivery_file_plans
  where id=p_plan and package_id=p_package;
 if f.id is null or f.kind not in ('PHOTO','MANIFEST') then
  raise exception 'Exact reserved session file required' using errcode='42501';end if;
 select * into sess from private.client_delivery_upload_sessions where file_plan_id=p_plan;
 if sess.file_plan_id is null then
   return jsonb_build_object('exists',false,'file_plan_id',p_plan);end if;
 if sess.package_id<>p_package or sess.total_bytes<>f.expected_size or sess.state='UNCERTAIN' then
   raise exception 'Remote session uncertain; explicit reconciliation required' using errcode='40001';end if;
 return jsonb_build_object('exists',true,'package_id',sess.package_id,'plan_id',p_plan,
  'total_bytes',sess.total_bytes,'encrypted',sess.ciphertext,
  'recorded_offset',sess.recorded_offset,'session_state',sess.state);
end;
$readsession$;
create function public.service_read_upload_session(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_read_upload_session(p_package,p_worker,p_generation,p_plan)
$wrap$;
revoke all on function private.service_read_upload_session(uuid,uuid,bigint,uuid),
 public.service_read_upload_session(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_read_upload_session(uuid,uuid,bigint,uuid),
 public.service_read_upload_session(uuid,uuid,bigint,uuid) to service_role;
