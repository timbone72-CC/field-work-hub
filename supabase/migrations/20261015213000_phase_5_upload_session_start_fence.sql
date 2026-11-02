-- Phase 5D additive one-shot fence: the remote upload-initiation POST must
-- NEVER precede a durably recorded attempt for the original preallocated ID.
-- This migration does not start Google uploads or authorize any live worker.
create table private.client_delivery_upload_starts (
  file_plan_id uuid primary key references private.client_delivery_file_plans(id) on delete restrict,
  package_id uuid not null references private.client_packages(id) on delete restrict,
  started_at timestamptz not null default clock_timestamp()
);
create index client_delivery_upload_starts_package_idx
  on private.client_delivery_upload_starts(package_id);
alter table private.client_delivery_upload_starts enable row level security;
revoke all on private.client_delivery_upload_starts from public,anon,authenticated,service_role;
grant select on private.client_delivery_upload_starts to service_role;

-- One current fenced lease can mark an exact reserved JPEG/manifest start.
-- A second start is NEVER permitted, even if Google has not returned a
-- resumable session URL; independent reconciliation must resolve uncertainty.
create function private.service_begin_upload_session(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $beginstart$
declare f private.client_delivery_file_plans%rowtype; started uuid;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into f from private.client_delivery_file_plans where id=p_plan for update;
 if f.id is null or f.package_id is distinct from p_package
   or f.kind not in ('PHOTO','MANIFEST') or f.state<>'PREALLOCATED'
   or f.expected_size is null
   or exists(select 1 from private.client_delivery_upload_sessions s where s.file_plan_id=p_plan)
 then
   raise exception 'Exact unstarted preallocated upload required' using errcode='40001';
 end if;
 insert into private.client_delivery_upload_starts(file_plan_id,package_id)
   values(p_plan,p_package) on conflict (file_plan_id) do nothing
   returning file_plan_id into started;
 if started is null then
   raise exception 'Previous remote session start uncertain; reconcile original file ID'
     using errcode='40001';
 end if;
 return jsonb_build_object('plan_id',p_plan,'start_recorded',true);
end;
$beginstart$;
create function public.service_begin_upload_session(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_begin_upload_session(p_package,p_worker,p_generation,p_plan)
$wrap$;
revoke all on function private.service_begin_upload_session(uuid,uuid,bigint,uuid),
 public.service_begin_upload_session(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_begin_upload_session(uuid,uuid,bigint,uuid),
 public.service_begin_upload_session(uuid,uuid,bigint,uuid) to service_role;

-- Existing saved encrypted sessions remain recoverable. If an attempt marker
-- exists with no saved session, missing ciphertext does NOT mean safe absence.
create or replace function private.service_read_upload_session(
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
   if exists(select 1 from private.client_delivery_upload_starts s
     where s.file_plan_id=p_plan and s.package_id=p_package) then
     raise exception 'Remote session start uncertain; reconcile original file ID'
       using errcode='40001';
   end if;
   return jsonb_build_object('exists',false,'file_plan_id',p_plan);
 end if;
 if sess.package_id<>p_package or sess.total_bytes<>f.expected_size or sess.state='UNCERTAIN' then
   raise exception 'Remote session uncertain; explicit reconciliation required' using errcode='40001';end if;
 return jsonb_build_object('exists',true,'package_id',sess.package_id,'plan_id',p_plan,
  'total_bytes',sess.total_bytes,'encrypted',sess.ciphertext,
  'recorded_offset',sess.recorded_offset,'session_state',sess.state);
end;
$readsession$;
-- Retain exact service-only execution grants from original function.
