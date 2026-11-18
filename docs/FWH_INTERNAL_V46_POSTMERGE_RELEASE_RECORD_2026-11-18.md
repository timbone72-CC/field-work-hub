# FWH Internal v46 — correct stale Offline status after verified sync (TEST updater)

**Date:** November 18, 2026 (America/Chicago)  
**Scope key:** `fwh-postmerge-internal-v46-status-fix`  
**Classification:** Level 3 — governed public INTERNAL TEST signed APK version promotion  
**Authoritative branch:** `release/fwh-internal-v46-stale-offline-banner`  
**Baseline / rollback:** PR #126 merged as `903352228ce72152134cfb9ef5d907492e061540` (source-only UI status correction), following v44 merge `b39b76d944130c2c5fbcb7095f2f16873444b655`.  
**Previous published immutable update:** `fwh-internal-v44`, target `b39b76d944130c2c5fbcb7095f2f16873444b655`, signed APK SHA-256 `a937dba83a0185c6fec6c56268724a8064739a5e86476773aaabbd41a651599e`.

## Purpose, protection and exact release scope

The operator directed continuation of unfinished Phase 6D and a fix for the **Offline** banner observed after a background ACK was confirmed by the office. PR #126 fixed this non-destructive Android UI presentation on main. The installed public v44 cannot contain later source-only fixes, so this Level-3 release-only PR prepares a newer signed INTERNAL TEST APK through the **already established in-app automatic updater**, not via an unapproved APK sideload.

- **Normal signed TEST candidate**: versionCode **46**, versionName `0.5-phase6-status-v46-test-internal`, unchanged package `com.inandout.fieldphotoprep.team.internal`, unchanged public TEST signer `1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe`, unchanged **Room6** history/schemas and exact TEST backend `vyocaujuwrivoqynvitm`. Field sync and previously approved cleanup-readiness polling stay ON, **automatic destructive cleanup stays OFF**.
- **Artifact-only recovery**: versionCode **47**, versionName `0.5-phase6-status-v47-recovery-internal`; identical package/Room/signer, but field sync/private-photo networking/readiness polling/automatic cleanup OFF. Never publish recovery on the normal updater. Installed v47 could only be superseded by a higher normal version, so do not install casually.
- Explicit `-PfwhReadinessTest=true` still builds historical **v42/v43** CI readiness fixtures without altering the updater candidate, signer or protected behavior. Historical tests are credited rather than abandoned.
- Exactly three release-only paths: `app/build.gradle`, `ci/write_phase5_artifact_identity.py`, this release record. PR #126 already merged the Android UI/tests; no Java runtime edits are part of this PR.
- No SQL/migration/RLS/worker Send, provider Drive creation, original-photo deletion/cleanup activation, FPP or production change. Existing real v44 Start Work auto-ACK/offline/reopen/reconnect office-receipt test is **PASS and retained**; do not repeat it.

## Required protected gates

1. Review exactly the three release-only files, version progression v44→v46 (paired v47), signer/package/Room6/readiness and cleanup invariants, and prior v44 immutable tag/asset/hash.
2. Obtain one explicit **operator Level-3 approval to merge this v46 release PR and publish a public INTERNAL TEST v46 update** through the existing in-app updater. Until that exact instruction, keep PR body `Level 3 merge approval: PENDING`, `Internal TEST APK publication: PENDING`, PR draft; no merge or release regardless of green CI.
3. Require exact-final-head PR Android (full JVM + focused tests, signed frozen candidate/recovery identity, historic readiness fixtures), Database, Dashboard and Governance PASS.
4. After approval, use a normal **two-parent merge** into main, not squash/rebase. The preexisting trusted publisher must verify exact post-merge main's latest Android/Database/Dashboard successful push runs, the immutable prior v44 baseline/ancestry, exactly the release-only three-file diff, version, matching signed single APK/digest, Room and cleanup safety, then create exactly one public `fwh-internal-v46` signed asset. A green workflow that logged **SKIP** is not a publication.
5. After independent verification of `fwh-internal-v46` release tag, SHA-256 and source SHA, operator installs from existing Account & Updates → Check for Update / Update App; no uninstall/data-clearing/downgrade. Android installation is a separate human action.
6. **Only new physical boundary after installation:** inspect header when a *new office-confirmed background receipt* follows a failed foreground list refresh; confirm it no longer falsely asserts current Offline state. Prior Start/ACK/restart/phone/camera/Drive/provider observations remain accepted. No new disposable WO required solely for this display; avoid manufacturing network or provider activity for a UI-only fix.

## Evidence and next Phase 6D handoff

**PASS carried forward:** v44 public release verified and phone installed. The one genuinely new v44 Start Work automatic-ACK, restart and reconnect test was accepted; read-only FWH TEST pinned one durable ACK and exactly one START for the verified fixture. PR #126 at `90335222` corrected stale top-bar copy/updates without changing network/Room/worker authority, with full Android/Database/Dashboard/Governance SUCCESS before merge.

**PENDING:** exact-head v46/v47 CI evidence; version-specific Level-3 operator merge/publication authorization; protected normal merge; exact-main push CI and trusted public asset verification; actual in-place Android v46 installation and one narrow changed-banner observation. A prepared candidate, pending PR and CI artifact are **not** a public updater release.

**Unchanged active Phase 6D:** `6D-T01` on existing `TEST-P4-PHOTOS-1003`; original visit complete with eight preserved received photos, second correction run started/accepted but has **zero** new replacement Front photos. One Front capture and Finish/private receipt, reviewed seven-original-plus-replacement combined package, explicit manifest approval/Send and **verified** both-run closure remain new. Source UI status preparation must not start another correction, force package Send, purge the original, or retest already accepted provider/field scenarios.

**Stop/rollback:** Any wrong backend, changed signer/package/Room, active cleanup, unsigned/failing image, mismatched CI, changed main, missing explicit approval, or unverifiable public release stops publication while immutable v44 remains available. Do not downgrade an installed Android Room database; use a verified higher-version correction/recovery only under its own gates.
