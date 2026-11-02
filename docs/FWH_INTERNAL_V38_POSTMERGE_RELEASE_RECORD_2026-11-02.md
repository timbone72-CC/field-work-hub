# FWH Internal v38 — merged-code Android TEST release candidate

**Date:** 2026-11-02 (America/Chicago)  
**Scope key:** `fwh-postmerge-internal-v38`  
**Classification:** Level 3 release preparation because it can result in distribution of a signed test Android APK. **No new Android app features or provider behavior.**  
**Source baseline:** merged `main` at `7570d15fe79ed7df950cd893b23e1affb00b1543` (includes PR #40 and the immediate post-merge CI-only correction).  
**Authoritative branch:** `release/fwh-internal-v38-merged-field-test`. This document owns the *new* release task, and does not replace the previously merged Phase 5/6 implementation record.

## Why

The newest public GitHub Release is `fwh-internal-v36` (October 17, 2026). The operator already accepted an Android Samsung v36 narrow field smoke. PR #40 merged new code on November 2, but the source still advertised versionCode 36; an installed v36 cannot detect the merged-code APK as a newer version. GitHub `main` Android CI built an artifact but not a public release. The trusted UI-only publisher is strictly pinned to PR #40's now-closed source branch; **do not widen that privileged public publisher to main or to a new branch** merely to skip verification.

## Exact implementation

- Produce candidate **versionCode 38**, `versionName=0.5-phase5-merged-v38-internal`; reserved separate evidence-preserving recovery APK **versionCode 39**, `...v39-recovery-internal`.
- Preserve package `com.inandout.fieldphotoprep.team.internal`, stable internal TEST signer, `Room` schema **v5**, existing Android installation/update flow and downloaded protected-photo originals. No reinstall/uninstall/data clearing, no new permissions or changes to capture/Sync/auth/provider/Drive.
- Keep the existing `ci/write_phase5_artifact_identity.py` checks in sync, so Android CI rejects a wrong candidate/recovery version or signer.
- Candidate is **private Actions artifact only** until release authority. The existing user-confirmed `ci/publish_internal_update.sh` remains the controlled publishing method for this non-UI-only postmerge build; no automatic GitHub Release is authorized by a version bump alone.
- A TEST release is not a production launch. If published, the app can check the GitHub Release and verify version/signature/hash, but Android still requires the operator to confirm installation. Do **not** claim an APK auto-installs silently.

## Failure containment and rollback

VersionCode 38 upgrade must preserve original v36 on-device Room/local evidence and pending transfers. A failed APK download/install leaves v36 installed and should not touch saved work; app-based update verification rejects an incorrect signer, version or hash. **Never uninstall** to recover from an update error. If a candidate is bad, do not reuse/rewrite a public release/tag; correct on a new version while retaining v36 as prior stable reference. The source branch can be closed without any hosted/provider mutation.

## Deliberately separate Phase 5D activation boundaries

FWH Team TEST general dispatch remains OFF; verified `FPP-000003` delivery receipt remains immutable, and its original separate HELD legacy permit is quarantined. Two-independent-package real provider processing and delivery-gated original-photo cleanup remain **PENDING and INACTIVE**. A v38 Android install does NOT enable them or justify repeating the original delivery/accepted field test. User explicitly declined finishing disposable `TEST-P5D-SECOND-001`; leave DRAFT unsent.

## Verification and decision

1. Require exact source-head Android build, JVM/Room/photo/upgrade-path tests, candidate/recovery identities, unchanged signer, no capability enlargement, and matching CI artifact metadata. GitHub tests/record must identify PASS/PENDING honestly.
2. The existing published v36 must remain unchanged. Before publication, perform separate exact artifact/source/hash release verification under existing trusted operator control; no new public release from an unchecked CI build.
3. If the operator chooses to update the Samsung or primary Android, the physical boundary is **user-initiated in-place install** (not uninstall). Preserve and, if possible, export existing protected originals before changing installed code. One successful in-place update confirmation is enough; do not repeat work-order/camera tests as a version ritual unless the behavior changed.
4. The Android v38 publication/installation decision is separate from later package concurrency and original cleanup implementation; neither is secretly activated here.

**Current:** Source-only TEST release candidate. Pending exact-head CI, governed public publication decision, and actual user-confirmed installation. No new client-package Send, cleanup, TEST database migration or Edge worker activation.
