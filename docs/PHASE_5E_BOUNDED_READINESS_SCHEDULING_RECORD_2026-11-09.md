# Phase 5E — Bounded original-owner readiness scheduling impact / build-state record

**Scope key:** phase5e-bounded-readiness-poll-20261109  
**Parent phase:** approved Phase 5, section 5E (2026-10-05 plan plus merged PR #55 and PR #62)  
**Classification:** Level 3 (authenticated original-photo readiness, WorkManager and local evidence journal)  
**Branch:** feat/phase5e-bounded-readiness-poll-20261109  
**Baseline/rollback main:** a5ab15a3392e9ef4b690a657ede60b8ff03d511a  
**Approval:** Parent-phase plan approved; separate Level-3 operator approval **PENDING** before any merge

## Decision and source ownership

The next approved work is bounded, server-read-only cleanup readiness scheduling, *not automatic deletion*. Reuse the existing one WorkManager FieldActionWorker, the existing TeamRuntime/SessionCoordinator original-user token owner, Room PhotoCleanupDao and PhotoCleanupCoordinator for original-owner RPC/verified local HELD snapshot. No duplicate service, alternate remote delivery client or new destructive owner.

Touched surfaces: app/build.gradle (independent OFF switch); Android ActionScheduler.java, FieldActionWorker.java, TeamRuntime.java, PhotoCleanupReadinessPoller.java, PhotoCleanupDao.java; focused PhotoCleanupExecutorTest.java; this scoped record and authoritative Phase 5/6 record/archive history index.

**No external change:** No new APK, Android installed state, Supabase SQL/permissions, Google Drive object, client package/Send, dispatch worker, FPP original app, photo bytes or cleanup activation is changed. In source both CLEANUP_READINESS_POLLING_ENABLED and AUTOMATIC_CLEANUP_ENABLED remain false for normal and recovery artifacts. Release requires separately reviewed activation/version identity; no release permitted by merging this source.

## Behavior and failure containment

- Every 24 hours at most, WorkManager schedules one unique network-CONNECTED readiness-only job keyed by exact owner + organization. The scheduler uses KEEP and is cancelled on Sign Out; the worker rechecks current SessionCoordinator identity/generation. WorkManager time is best effort, not guaranteed clock precision.
- Readiness-only mode exits before the ordinary action/transfer/reconcile path. It never calls PhotoOwner deletion, READY/CLEANING/markCleaned, Google, or any delivery worker. Disabled builds schedule no new readiness job.
- A Room query selects unjournaled local WAITING originals with matching owner/org and durable private RECEIVED transfer receipt; the existing bridge independently checks accepted exact Finish and immutable photo/transfer identity before any authenticated server request. A fresh server decision may create only a durable HELD proof when eligible and exact identities match. Server negative/incomplete, offline, foreign owner, changed session or invalid local evidence never authorizes cleanup.
- Poll up to 8 photos per scheduled invocation. Save the last examined photo UUID cursor synchronously in private app preferences; use stable ordered keyset pagination and wrap to the beginning on the next invocation after reaching the end. Even a failed/denied one-photo read advances the bounded cursor, so other jobs can progress. No auth token or customer data enters WorkManager input, logs, or cursor key.
- On logout/account switch, explicit unique-periodic cancellation and generation guards stop stale reads; previous account's local evidence stays owner-scoped. A network or per-photo denial is confined to the queried photo, with no immediate retry storm; the next periodic invocation can revisit it. Shared service failure may prevent all reads, but cannot stop normal fieldwork, modify provider state or delete bytes.
- Previously journaled HELD, READY, CLEANING and CLEANED evidence is not repeatedly polled by the scheduler. Any future separately enabled destructive cleanup must still obtain fresh original-owner server approval on each transition, revalidate whole-WO pending work/receipt/corrections and preserve the Room crash-recovery journal. This poll alone never authorizes deletion or marks a work order COMPLETE.

## Verification and next gate

Pending focused Robolectric/Room: bounded 8-item batch, fair cursor/wrap, server ineligible and IOException isolation, owner/session sign-out stopping and absence of a HELD journal on interrupted read, disabled flag, skipped already-journaled photos, no original bytes removed. Require exact-head Android/Database/Admin/Governance CI, full diff and record-size review before Level 3 premerge approval. Preserve prior v40 phone-data preservation and single TEST final-package delivery PASS without retesting.

**Next:** finish CI and review; if PASS, request explicit merge authorization for this exact bounded source PR. Neither that merge nor earlier approvals authorize activating polling, cleanup, general dispatch, TEST provider operations or a new APK. Actual background scheduling and final-delivery-gated original deletion require a future controlled TEST release/device gate and separately authorized activation.

## Prior accepted merge checkpoint

Operator verified Android App info reported `0.5-phase5-merged-40-internal` and existing jobs/photos survived. PR #62 head `35124e2bcf9c24e8b1b6e35d5c80842e44c56c90` merged as `a5ab15a3392e9ef4b690a657ede60b8ff03d511a` after explicit authorization. Exact-main Android `42680804260`, Database `42680804112`, Admin `42680804140` CI PASS; publisher skipped an undesignated APK release. Its older PENDING pre-merge note is archived verbatim in Phase 5/6 history part 49.
