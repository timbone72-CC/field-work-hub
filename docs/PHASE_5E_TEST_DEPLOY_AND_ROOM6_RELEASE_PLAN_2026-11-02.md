# FWH Phase 5E — Controlled TEST deployment and Room6 APK release handoff

**Date:** November 2, 2026 (America/Chicago)  
**Scope:** `phase5e-owner-cleanup-readiness` / draft [PR #55](https://github.com/timbone72-CC/field-work-hub/pull/55).  
**Risk:** Level 3 — original-photo deletion, owner-scoped authorization, SQL terminal delivery and Android Room migration.  
**Baseline:** `main` at `f7ec3695b68e8970f1a3df1ced3ca2c7c9bfbe34` and published v38 TEST Android (Room5).  
**Source owner:** `feat/phase5e-cleanup-closure-readiness`. This handoff refines the already-approved complete Phase 5 parent plan; it is NOT new permission to merge, deploy, publish or delete.

## Implemented in PR #55 (not activated)

1. **Server**: `20261102235900_phase_5e_photo_cleanup_readiness.sql` creates an immutable, RLS-isolated `client_package_runs` closure and owner-only read-only `field_photo_cleanup_readiness(uuid)`; receipt, accepted Finish, exact org/WO/run/photo and confirmed final package plus no open correction obligation are required. `20261102235930_phase_5e_exact_delivery_run_closure_writer.sql` writes primary-run membership only on the existing true terminal `DELIVERING → DELIVERED` service transition, never from Send, private receipt or historical backfill. Never infer a corrected/cross-run package closure.
2. **Android**: Room 5→6 adds an immutable owner/run/photo/Finish/private-receipt/package JSON snapshot in `photo_cleanup_journal`. `PhotoCleanupCoordinator` is an unscheduled owner-scoped read adapter. `PhotoCleanupDao` blocks READY when **any** same-work-order offline field action, assignment conflict/handoff, failed/uncertain/missing private photo receipt, unreadable Finish or missing photo remains. It commits `HELD → READY → CLEANING` durably before touching any file, and `CLEANING → CLEANED` only after the original, derivative and owned temporary file are absent.
3. **File owner & crash recovery**: Only `PhotoOwner` executes exact internal-directory UUID-derived removals. It rejects wrong identity/path, symlinks, changed original length, changed prepared SHA-256, and unfinished evidence. An interruption during partial deletion leaves `CLEANING`; the original owner resumes only missing exact operations on restart, never TUS, photo preparation or provider delivery. Unrelated jobs can continue. After success retain Room photo/transfer/Finish/package histories, original size and private receipt.
4. **Activation is OFF**: `BuildConfig.AUTOMATIC_CLEANUP_ENABLED=false` in both regular and recovery APKs, with a CI assertion against accidental activation. No scheduler polls for new readiness; the future owner entry points exist but are gated. Tests use a constructor-only activation seam against disposable app-private fixtures; they do NOT run against phone evidence.
5. **Regression coverage**: Room 5→6 preserves old originals/no fabricated journal; exact owner deletion, a same-WO pending action from another run, unreceived/uncertain second photo, wrong account, changed path, stale Finish, disabled production switch, one-file-deleted crash/resume and unrelated WO progress. PostgreSQL tests exercise receipt-driven closure and authorization; accepted Samsung v36/v38 and original Google delivery tests are not repeated.

## Controlled Team TEST SQL migration boundary — PENDING

**Preflight, no mutation:** Confirm FWH TEST project `vyocaujuwrivoqynvitm`, existing 129 installed migration records, no drift from `main`, `general_dispatch=false`, legacy-worker fence true, existing one permanent delivered receipt and original held permit preserved. Confirm only exact migrations 130/131 are to be deployed, and review the actual SQL/grant effect. Owner/role grant policy is denied by default; no client can INSERT/UPDATE/DELETE closure rows.

**Separate Level-3 decision:** After PR #55's exact final CI, governance and operator merge authorization, merge controlled source. Under a separately verified TEST deployment approval or existing recorded deployment authority, run the two additive migrations in sequence. Confirm source/live versions **131/131**, triggers/RPC signatures, denied anon/foreign owner, immutable run closure, and no historical cleanup-row backfill; reconcile TEST security/performance advisors. This step MUST NOT enqueue Send, access Google, adjust dispatch, touch HELD permit/session/step markers, delete originals, or replay delivered packages.

**On failure:** Stop at the failed migration/permission check. Keep dispatch OFF, held permit and existing receipts immutable; inspect installed transactional state and repair only the failing source. Do not drop protected records, reset schema history, re-run already accepted Google steps, or widen RLS.

## Separate Android Room6 in-place TEST APK release — PENDING

**First prerequisite:** PR #55 merged, controlled TEST migration parity verified, and the signed Room6 recovery/migration gate accepted in CI. The existing public `fwh-internal-v38` remains untouched until an explicit new release.

**Required trust-policy change:** Current trusted `ci/auto_publish_merged_internal_release.py` pins `room_version=5`; it must be reviewed/updated to verify **Room6** and retained `1..6.json` schema lineage in a separately reviewed Level-3 release-publisher change. Do not silently relax the safeguard or publish an APK from a feature branch.

**Release candidate:** Use the already approved internal package ID and same stable TEST signer. Next normal candidate must have **versionCode 40**; reserve **41** for evidence-preserving recovery. Update version strings in `app/build.gradle`, `ci/write_phase5_artifact_identity.py`, the release-only record and any exact-version policy checks, without changing permissions, cleanup activation, Room schema or runtime data. The future release PR must match the trusted `release/fwh-internal-v40-...` branch identity and contain unambiguous `Level 3 merge approval: APPROVED` and `Internal TEST APK publication: APPROVED` following the operator's actual decisions.

**Publish boundary:** Protect the source-only parent PR and the separate publisher PR first; verify signed v40/recovery v41 CI artifacts, SHA-256 and version. Only after individually approved, normal protected merges and exact-main Admin/Database/Android CI may the existing trusted automatic publisher create a new immutable `fwh-internal-v40` GitHub Release. Android still requires an in-place, operator-confirmed installation; **never uninstall v38, clear app data, import a fabricated cleanup journal, or re-run accepted field/Google tests**. A v40 update failure retains v38 and all local data. Do not publish v39 recovery over v40 (Android downgrade).

## Physical deletion boundary — NOT YET AUTHORIZED

The **Room6 v40 TEST APK stays cleanup-OFF**. Releasing/installing it verifies safe migration, not phone deletion. Actual cleanup activation needs its own explicit guarded TEST fixture and operator release decision after FWH TEST owner/receipt/closure parity and a disposable real-phone crash/retry demonstration. Use a newly authorized isolated synthetic fixture, **not** `TEST-P5D-SECOND-001`, the previously DELIVERED `FPP-000003`, old HELD provider identities, or any real customer originals. No general worker Send or remote concurrency activation follows from local cleanup.

**Next checkpoint:** Resolve concrete exact-head CI failures in PR #55 and update authoritative implementation record (keep under 24 KiB). Seek separately required Level-3 PR merge/deployment and later v40 publication decisions only at their real boundaries. Do not request another review/test of previously accepted Google or field work.
