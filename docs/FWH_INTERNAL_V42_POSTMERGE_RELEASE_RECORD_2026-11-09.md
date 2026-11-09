# FWH Internal v42 — read-only readiness update via existing app updater

**Date:** November 9, 2026 (America/Chicago)  
**Scope key:** `fwh-postmerge-internal-v42-readiness-test`  
**Classification:** Level 3 — trusted public internal TEST APK release and bounded readiness activation  
**Authoritative release branch:** `release/fwh-internal-v42-readiness-test`  
**Baseline / pre-merge rollback:** merged PR #64 main `49d5beafb24c721539d12c83515cf1893f197bfb`.  
**Prior public release:** immutable `fwh-internal-v40` with APK SHA-256 `7a9e43ec0c4d2bf7b9a3e75089469d9ee47bbfa63d4313d1538097a132d4a9c7`.

## Authority and why this release is needed

The operator explicitly authorized on November 9: **"i authorize making v42 available to all FWH TEST installations through the existing in-app updater"**, after the limitation that the updater reads only public `releases/latest`, not staged GitHub Actions artifacts, was explained. The operator also previously authorized a controlled in-place v42 TEST installation on the primary phone; that physical installation has not yet been confirmed. This authorization covers this version-only TEST channel transition and no destructive cleanup or production rollout. GitHub's trusted publication, exact-source CI and physical Android installer remain mandatory.

The source-only v42 opt-in candidate was prepared/CI-verified and PR #64 was merged. Its original standalone artifact SHA-256 `b7cfc2b7884c48ab466e824122987c7e2152f5c7fd42d1fb17469ca1d8d2311f` from exact main `49d5beaf` is **not** silently reused as the publisher's release hash: the normal-channel release rebuilds from a new version-only release merge and must independently freeze and verify the resulting APK bytes. No blind upload or bypass of the existing `release-only` trusted publisher is allowed.

## Exact release-only change

- Make the already implemented read-only TEST mode the standard internal **v42** candidate so the installed v40 app's existing `Account & Updates → Check for Update` can discover it through `fwh-internal-v42`; preserve optional explicit `-PfwhReadinessTest=true` CI parity.
- Version **42**: package `com.inandout.fieldphotoprep.team.internal`; same test signer `1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe`; Room **6**; `FIELD_SYNC_ENABLED=true`, `CLEANUP_READINESS_POLLING_ENABLED=true`, `AUTOMATIC_CLEANUP_ENABLED=false`. The exact FWH TEST project URL is asserted at build time.
- Paired artifact-only version **43** recovery: same package, signer and Room6; field sync, readiness polling, and automatic cleanup all **OFF**. Do not publish recovery to the updater channel, uninstall the installed app, clear its storage or downgrade Room6. After installing recovery, any resumed version must be **v44 or higher**.
- Limit this release PR to `app/build.gradle`, `ci/write_phase5_artifact_identity.py`, and this release record: no production release, Android feature refactor, database migration, backend/Google operations, protected photo access, general dispatch, provider Send, or deletion.
- Both package/release metadata records carry verified candidate/recovery readiness booleans. Keep existing app updater's required single `Field-Work-Hub-Internal.apk` asset and exact published digest/certificate/version checks.

## Verification and publication gate

The three required exact-PR-head Android / Database / Admin / governance checks must pass, including all Android unit tests, v42 candidate and v43 recovery byte/signer/version/Room6/flag verification. Check the entire three-file diff for source-only release scope and no unapproved permission/authority changes. Normal two-parent protected PR merge is required; no manual release, overwrite, force-push, or bypass of the trusted main publisher.

After merge, the trusted main-only publisher must independently require exact-main Android/Database/Admin CI PASS, release-specific PR authorization fields, contiguous ancestry from v40, single generated signed v42 APK, manifest and SHA-256 parity, all Room1–6 source schema blobs, field sync ON and cleanup OFF, and only then publish the immutable `fwh-internal-v42` release. If any gate fails or the publisher reports SKIP, there is **no release**, and v40 remains latest; reconcile the exact failure rather than instructing the phone to install.

## Failure containment / device handoff

Publication exposes a **TEST APK** to all FWH installations that use this standard internal updater, but Android still requires the user to confirm installing it. The release does **not** remotely activate a database switch or automatically delete photos. Readiness polling is bounded, network-constrained, current original-owner only; manual TEST button `Check photo readiness (TEST — read-only)` can return zero examined/HELD without being a failure; never invent receipt eligibility or trigger cleanup.

Once the immutable release is independently verified, ask the operator on the primary Android phone to open **Account & Updates → Check for Update → Update App**, confirm Android's in-place install, then check that saved jobs/photos remain and use the read-only TEST check once. Keep v43 protected recovery on the laptop. Do not repeat prior accepted camera/offline/provider/Google Send tests. Installation remains PENDING until actual operator evidence.

**Current status:** release-only branch preparation; no public v42 release or phone installation claimed. Record exact PR/head/check IDs, release target/digest and operator observations only after they happen.
