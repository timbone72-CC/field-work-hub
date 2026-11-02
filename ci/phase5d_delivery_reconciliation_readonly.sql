-- Field Work Hub Phase 5D | READ-ONLY operator diagnostic
-- Approved Phase 5/6 PR #40: existing dispatch/lease/Google identity owner.
-- Run ONLY in the authorized FWH Team Supabase SQL editor while processing
-- the genuine TEST provider gate or diagnosing a stuck single-flight permit.
-- Never substitute the Field Photo Prep project or a customer dataset.
-- This file contains SELECT statements only. It never acquires/releases a
-- permit, advances an outbox, resets an uncertain result, sends a photo,
-- changes permissions, or clears a provider session.
--
-- Treat the returned worker/package/provider IDs as PRIVATE operational data.
-- Do not copy them into public GitHub issues, logs or repository documentation.
-- This is a read-only snapshot, NOT authorization to resume/retry; correlate
-- the original lease, immutable Drive IDs and real provider evidence first.

-- A. Safe high-level snapshot (no private identities in this result).
select
  (select count(*) from private.client_delivery_dispatch_permit) as occupied_dispatches,
  (select count(*) from private.client_delivery_outbox) as outbox_rows,
  (select count(*) from private.client_delivery_file_plans) as file_plan_rows,
  (select count(*) from private.client_delivery_upload_sessions) as upload_session_rows,
  (select count(*) from private.client_delivery_final_receipts) as final_receipt_rows,
  (select count(*) from private.client_delivery_runtime where worker_ready) as ready_workers,
  (select count(*) from private.client_delivery_destinations where active) as active_destinations,
  (select count(*) from private.client_delivery_destinations where verified and not active)
     as verified_inactive_destinations,
  to_regclass('cron.job') is not null as scheduler_present;

-- B. Private operator evidence. These are ordered and bounded snapshots;
-- do not mistake omitted rows for proof that the broader DB is empty.
select request_id,acquired_at
  from private.client_delivery_dispatch_permit
 order by acquired_at,request_id limit 20;

select package_id,state,worker_id,lease_generation,lease_until,
       attempts,last_heartbeat_at,uncertain_reason
  from private.client_delivery_outbox
 order by enqueued_at,package_id limit 20;

select id as plan_id,package_id,kind,drive_file_id,drive_parent_id,
       expected_sha256,expected_size,state,verified_at
  from private.client_delivery_file_plans
 order by created_at,id limit 50;

-- Never SELECT encrypted ciphertext or resumable session URI.
select file_plan_id,package_id,state,recorded_offset,total_bytes,
       revision,last_checked_at
  from private.client_delivery_upload_sessions
 order by last_checked_at nulls last,file_plan_id limit 50;

select package_id,approved_sha256,destination_id,confirmed_at
  from private.client_delivery_final_receipts
 order by confirmed_at desc,package_id limit 20;

-- STOP / human reconciliation boundary:
-- 1. If a permit exists, pause any scheduler (if one is ever provisioned).
-- 2. Confirm the ORIGINAL outbox lease and exact frozen provider IDs.
-- 3. Inspect real Google GET, same ID/parent/checksum and upload state
--    before any recovery step; ambiguous observations stay UNCERTAIN.
-- 4. Do not DELETE/TRUNCATE the permit, allocate new Google IDs, replay
--    an upload, requeue Send, or claim DELIVERED from this diagnostic.
-- 5. Recovery requires existing governed operator reconciliation evidence.
