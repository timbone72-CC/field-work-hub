# FWH Internal v40 — Room6 in-place Android TEST update

**Date:** November 3, 2026 (America/Chicago)
**Scope key:** `fwh-postmerge-internal-v40`
**Classification:** Level 3 — signed public internal TEST APK distribution.
**Authoritative branch:** `release/fwh-internal-v40-room6-test`.
**Source baseline / pre-publication rollback:** verified policy merge `145889ce2e4d058317095b0fa1f2f0fea0619642` (PR #59). Reverting source cannot downgrade an installed Room6 phone.

## Authorization and baseline

The operator explicitly confirmed preparing and publishing the v40 TEST Android update with automatic cleanup OFF (“yes, normally it does”) on November 3. This covers the necessary reviewed prerequisite publisher-policy integration and this version-only release merge/publication after passing required checks. Do not request the same approval again. Android installation still uses its existing user-confirmable installer.

PR #55 source is already merged. The controlled TEST handoff records SQL 130/131 installed and independently verified (131 total); no SQL push or provider replay belongs here. Public `fwh-internal-v38` remains immutable at source `f7ec3695b68e8970f1a3df1ced3ca2c7c9bfbe34`, APK SHA-256 `1d72ded691596be8dd452773e84cf0e155d3ff94cffc65d035a7880f9bd8a278`. The prerequisite [Room6 policy record](FWH_ROOM6_INTERNAL_RELEASE_POLICY_RECORD_2026-11-03.md) owns the trusted publisher update; this release must descend from its verified ordinary merge.

## Exact version-only change

- Candidate versionCode **40**, versionName `0.5-phase5-merged-v40-internal`; artifact-only recovery versionCode **41**, versionName `0.5-phase5-merged-v41-recovery-internal`.
- Preserve package `com.inandout.fieldphotoprep.team.internal`, stable TEST signer `1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe`, Room6 and all schema exports 1–6. Existing approved Room5→6 migration retains originals, pending actions and history with no fabricated cleanup journal/backfill.
- Both APKs keep **AUTOMATIC_CLEANUP_ENABLED=false**. Normal v40 retains existing field/private-photo networking; recovery v41 disables it. Recovery is never the public update asset.
- Change only `app/build.gradle`, exact version assertions/metadata in `ci/write_phase5_artifact_identity.py`, and this release record. No app feature, permission, signer, Room schema, cleanup switch, SQL, provider, Send or dispatch change.

## Verification and publication boundary

Require exact-head Android full JVM/Room/photo/update tests, signed candidate/recovery identity, schema compiler parity and artifact metadata; Database/Admin/governance checks; complete three-file diff and whitespace review. Then ordinary protected merge under the authorization above. Trusted main-only publisher requires the exact merged source, successful newest Android/Database/Admin main-push runs, release-only diff, explicit approval/version metadata, all six exact-source schema blobs, cleanup OFF, stable package/signer, candidate sync ON, APK byte count/digest and new immutable version tag.

Verify `fwh-internal-v40` targets the exact ordinary merge, contains exactly `Field-Work-Hub-Internal.apk`, and its GitHub asset digest equals the frozen passing main Android artifact. No new camera/work-order/Google test is required to publish this already implemented runtime. Public publication is a TEST update, not Phase 5/6 completion or production authorization.

## Failure containment, rollback and phone handoff

Until publication, retain v38 and fix only the affected check; no alternate unchecked publisher or replaced tag. A failed download/install must retain the old app and evidence. Never uninstall, clear app data or import a fabricated cleanup journal. After a successful Room6 install, do not downgrade to v38/Room5; use a higher corrected version or the verified v41 evidence-preserving recovery artifact if genuinely needed.

The only new physical gate is one operator-confirmed **in-place v38→v40 update** and confirmation that existing saved work/photos remain accessible. The updater verifies the fixed trusted release source, higher version, APK digest, package and signer before Android installation consent. Actual phone success is PENDING until observed. Do not repeat accepted camera, field, export, private review or Google delivery tests.

General dispatch and cleanup remain OFF. Original held identities/permit, delivered `FPP-000003`, and unwanted DRAFT `TEST-P5D-SECOND-001` remain untouched. No customer/FPP evidence or systems are changed.

**Prerequisite PASS:** PR #59 final head `50079f35` passed Android `41685895280`, Database `41685895268`, Admin `41685895394`, policy `41685895232` and governance before ordinary merge `145889ce`.

**Next:** pass exact-head checks, merge and verify the automatic public v40 asset; hand the operator the existing Account & Updates path and direct release link. Record actual source/artifact/CI results in the authoritative Phase 5/6 handoff after publication; do not advance main while its exact-head publisher is still running.
