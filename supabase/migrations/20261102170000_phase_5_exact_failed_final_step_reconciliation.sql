-- Phase 5D: exact, manual, fail-closed reconciliation of the known
-- 2026-11-02 TEST finalizer failure. SOURCE ONLY; migration does no DML.
-- Do NOT silently clear/delete the original unfinished step, package, permit,
-- Google IDs, uploaded photo, manifest, or legacy singleton.
-- Operator invocation is a separate gated step after migration parity/CI.
--
-- The older step journal uses verified_at as its ONLY closure timestamp.
-- This one explicitly non-VERIFIED outcome closes the old pending lock while
-- an immutable, private audit row proves it was FAILED, not delivered.
-- It is never a provider-verification or final-delivery receipt.
create table private.client_delivery_failed_final_step_reconciliations (
  step_id uuid primary key references private.client_delivery_package_step_attempts(step_id)
    on delete restrict,
  package_id uuid not null unique references private.client_packages(id) on delete restrict,
  worker_id uuid not null,
  request_id uuid not null,
  generation bigint not null check (generation > 0),
  failure_code text not null check (failure_code = 'FROZEN_PACKAGE_DELIVERY_OWNER_MISMATCH'),
  failure_observed_at timestamptz not null,
  source_final_receipt_count integer not null check (source_final_receipt_count = 0),
  reconciled_at timestamptz not null default clock_timestamp()
);
alter table private.client_delivery_failed_final_step_reconciliations enable row level security;
revoke all on private.client_delivery_failed_final_step_reconciliations
  from public,anon,authenticated,service_role;

-- Deliberately postgres-only; no public RPC, Edge route, scheduler, or retry
-- loop. The TEST operator must use this narrow, explicit identity-bound action.
create function private.service_reconcile_exact_failed_final_step(
  p_package uuid,p_step uuid
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s'
as $recover$
declare
  cfg private.client_delivery_package_dispatch_config%rowtype;
  held private.client_delivery_package_dispatch_permits%rowtype;
  o private.client_delivery_outbox%rowtype;
  k private.client_packages%rowtype;
  d private.client_delivery_destinations%rowtype;
  pending private.client_delivery_package_step_attempts%rowtype;
  folder private.client_delivery_file_plans%rowtype;
  n bigint;
begin
  if p_package is distinct from 'f42e05df-de7a-4d20-8dee-f55e09511d1f'::uuid
    or p_step is null
  then raise exception 'Only original disposable TEST final marker may reconcile'
    using errcode='42501';end if;

  select * into cfg from private.client_delivery_package_dispatch_config
    where singleton for share;
  if cfg.singleton is null or cfg.enabled is distinct from false
    or cfg.legacy_worker_off_verified is distinct from true
    or cfg.max_in_flight<>2
  then raise exception 'Exact TEST gate must be OFF' using errcode='42501';end if;

  select * into held from private.client_delivery_package_dispatch_permits
    where package_id=p_package for update;
  select * into o from private.client_delivery_outbox
    where package_id=p_package for update;
  select * into k from private.client_packages
    where id=p_package for share;
  select * into d from private.client_delivery_destinations
    where id=k.destination_id;
  select * into pending from private.client_delivery_package_step_attempts
    where step_id=p_step and package_id=p_package for update;

  if held.package_id is null or o.package_id is null or k.id is null
    or d.id is null or pending.step_id is null
    or k.status<>'DELIVERING' or o.state<>'DELIVERING'
    or o.attempts<>1 or o.lease_generation<>1 or held.generation<>1
    or o.worker_id is distinct from held.worker_id
    or o.lease_generation is distinct from held.generation
    or o.destination_id is distinct from held.destination_id
    or k.destination_id is distinct from held.destination_id
    or k.organization_id is distinct from held.organization_id
    or k.organization_id is distinct from d.organization_id
    or k.company_id is distinct from d.company_id
    or d.active is distinct from true or d.verified is distinct from true
    or d.root_folder_id<>'1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK'
    or k.approved_manifest->>'package_id' is distinct from p_package::text
    or k.approved_manifest->>'destination_id' is distinct from d.id::text
    or k.approved_manifest->>'destination_root' is distinct from d.root_folder_id
    or k.approved_manifest->>'destination_revision' is distinct from d.revision::text
    or k.approved_manifest->>'folder_layout' is distinct from 'ADDRESS_WORK_ORDER'
    or jsonb_array_length(coalesce(k.approved_manifest->'selected_photos','[]'::jsonb))<>1
    or k.approved_sha256 is distinct from encode(sha256(convert_to(k.approved_manifest::text,'UTF8')),'hex')
    or o.approved_sha256 is distinct from k.approved_sha256
    or o.lease_until is null or o.lease_until>=clock_timestamp()
    or pending.worker_id is distinct from held.worker_id
    or pending.request_id is distinct from held.request_id
    or pending.generation is distinct from held.generation
    or pending.verified_at is not null or pending.verified_outcome is not null
    or pending.started_at not between
      '2026-11-02 15:12:00+00'::timestamptz
      and '2026-11-02 15:15:00+00'::timestamptz
    or exists (select 1 from private.client_delivery_final_receipts
       where package_id=p_package)
    or (select count(*) from private.client_delivery_dispatch_permit)<>1
    or (select count(*) from private.client_delivery_package_dispatch_permits)<>1
    or (select count(*) from private.client_delivery_package_step_attempts s
       where s.package_id=p_package and s.verified_at is null)<>1
    or (select count(*) from private.client_delivery_package_step_attempts s
       where s.package_id=p_package and s.verified_at is not null
         and s.worker_id=held.worker_id and s.request_id=held.request_id
         and s.generation=held.generation
         and s.verified_outcome='VERIFIED_PROVIDER_STEP')<>5
    or (select count(*) from private.client_delivery_package_step_attempts s
       where s.package_id=p_package and s.verified_at is not null
         and s.worker_id=held.worker_id and s.request_id=held.request_id
         and s.generation=held.generation
         and s.verified_outcome='VERIFIED_METADATA_STEP')<>1
    or (select count(*) from private.client_delivery_package_step_attempts
       where package_id=p_package)<>7
    or exists (select 1 from private.client_delivery_failed_final_step_reconciliations
       where package_id=p_package)
  then raise exception 'Original failed final step or immutable evidence changed'
    using errcode='42501';end if;

  select * into folder from private.client_delivery_file_plans
    where package_id=p_package and kind='FOLDER' and state='VERIFIED';
  if folder.id is null or folder.drive_file_id<>'196tHeV7eQB5DtKcpsBL1wWfrSg3C8z1_'
    or folder.verified_at is null or folder.remote_evidence is null
    or not exists (select 1 from private.client_delivery_package_folder_attempts a
       where a.package_id=p_package and a.file_plan_id=folder.id
         and a.verified_at is not null and a.remote_evidence is not null)
    or (select count(*) from private.client_delivery_file_plans
       where package_id=p_package)<>3
    or (select count(*) from private.client_delivery_file_plans
       where package_id=p_package and state='VERIFIED'
         and verified_at is not null and remote_evidence is not null)<>3
    or (select count(*) from private.client_delivery_file_plans
       where package_id=p_package and kind='PHOTO'
         and drive_file_id='1i9946peeZzZV6UsOduyy89HdGSr1VTnk'
         and drive_parent_id=folder.drive_file_id and expected_size=279184
         and photo_id::text is not distinct from
             k.approved_manifest->'selected_photos'->0->>'photo_id'
         and expected_sha256 is not distinct from
             k.approved_manifest->'selected_photos'->0->>'observed_sha256'
         and expected_size is not distinct from
             (k.approved_manifest->'selected_photos'->0->>'observed_size')::bigint
        )<>1
    or (select count(*) from private.client_delivery_file_plans
       where package_id=p_package and kind='MANIFEST'
         and drive_file_id='13M3HTcYkZ6yHfN2TaX-2i15KkMMHJgWM'
         and drive_parent_id=folder.drive_file_id and expected_size=1382
         and expected_size=octet_length(k.approved_manifest::text)
         and expected_sha256=k.approved_sha256)<>1
  then raise exception 'Original provider receipts not fully preserved'
    using errcode='42501';end if;

  -- Reconciles the *database-only, rolled-back* terminal attempt identified
  -- in the 15:14:50 UTC PostgreSQL log. The final worker made read-only
  -- Drive verification requests; no upload or final receipt was committed.
  insert into private.client_delivery_failed_final_step_reconciliations(
    step_id,package_id,worker_id,request_id,generation,
    failure_code,failure_observed_at,source_final_receipt_count
  ) values (
    pending.step_id,p_package,held.worker_id,held.request_id,held.generation,
    'FROZEN_PACKAGE_DELIVERY_OWNER_MISMATCH',
    '2026-11-02 15:14:50+00'::timestamptz,0
  );

  update private.client_delivery_package_step_attempts
     set verified_at=clock_timestamp(),
         verified_outcome='RECONCILED_FAILED_FINAL_NO_RECEIPT'
   where step_id=p_step and package_id=p_package
     and verified_at is null and verified_outcome is null;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Failed marker closure uncertain'
     using errcode='40001';end if;
  -- A closed failed step is NOT a VERIFIED_* provider step, nor a
  -- VERIFIED_FINAL_RECEIPT. The final delivery needs its own new fenced
  -- step, fresh Drive GETs and the ordinary final receipt transaction.
  return jsonb_build_object('reconciled',true,'delivered',false,
    'package_id',p_package,'step_id',p_step,
    'outcome','RECONCILED_FAILED_FINAL_NO_RECEIPT');
end;
$recover$;
revoke all on function private.service_reconcile_exact_failed_final_step(uuid,uuid)
  from public,anon,authenticated,service_role;
