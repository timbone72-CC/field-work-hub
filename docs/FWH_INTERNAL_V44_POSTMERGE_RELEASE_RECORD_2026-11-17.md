# FWH Internal v44 — Start Work also accepts assignment (TEST updater)

**Date:** November 17, 2026 (America/Chicago)  
**Scope key:** `fwh-postmerge-internal-v44-start-work-accept`  
**Classification:** Level 3 — source-only version promotion, governed public INTERNAL TEST release  
**Authoritative branch:** `release/fwh-internal-v44-start-work-accept`  
**Baseline / rollback before release:** PR #123 merged into main at `7e92bd2ea5ebe7f2c734a1522de1d3e28ba45bc8`.  
**Previous immutable public update:** `fwh-internal-v42`, published November 9, 2026 from `ac75cd068176ce4752dd53bcc98154bccadfca11`, SHA-256 `b7cfc2b7884c48ab466e824122987c7e2152f5c7fd42d1fb17469ca1d8d2311f`.

## Business purpose and scope

Operator November 17 requested: **"Prepare the updated FWH TEST Android APK for installation. we are using auto update"** after expressly approving and merging PR #123. PR #123 changes a *new deliberate Start Work tap* to commit exact-instance ACK then START in one Room transaction; explicit Accept still works before Start; no historical START backfill. The installed app does not gain this behavior merely because #123 was merged. This release prepares a compatible newer APK through the already approved, standard in-app update channel.

The request authorizes **preparation**, not a fabricated completed publication or installation. Keep the version-specific Level 3 merge and public-APK publication approval **PENDING** until the operator explicitly approves both for this release PR. The standing publisher mechanism is already approved; do not redesign it or ask to approve it again.

## Exact version-only change

- Ordinary signed TEST candidate **versionCode 44**, `0.5-phase6-start-accept-v44-test-internal`, package `com.inandout.fieldphotoprep.team.internal`, stable TEST signer `1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe`, and unchanged **Room6** schema/history.
- Paired **v45 recovery**, artifact only and **never public on the updater**: same package/signer/Room6, with field synchronization and readiness polling OFF. Automatic cleanup OFF on both versions. The recovery version cannot be downgraded; any ordinary update after recovery must exceed v45.
- Normal v44 retains `FIELD_SYNC_ENABLED=true`, `CLEANUP_READINESS_POLLING_ENABLED=true` against exact authorized FWH TEST `vyocaujuwrivoqynvitm`, and `AUTOMATIC_CLEANUP_ENABLED=false`. No SQL, Google Drive Send, worker activation, photo deletion, FPP, new permissions, provider or production changes.
- The existing CI explicitly invokes `-PfwhReadinessTest=true` to recheck the **historical v42/v43** opt-in readiness fixtures. Preserve those unchanged checks with a conditional version selection; ordinary unflagged signed builds publish only **v44/v45**. The trusted publisher version/Room/signature/hash and immutable release contracts are untouched.
- Release-only changed paths: `app/build.gradle`, `ci/write_phase5_artifact_identity.py`, and this record. Runtime behavior was already approved, implemented and merged in #123; this PR changes no application Java/Android source.

## Mandatory gates and fail-closed publication

1. Review the exact three-file release-only diff and PR metadata; require Android focused/complete JVM, candidate/recovery identity, Room6 schema, package/signer, the retained explicit readiness CI, Dashboard, Database and Governance PASS on the final PR head.
2. Obtain **explicit operator approval** to merge this Level 3 **v44** release PR and publish the public INTERNAL TEST v44 APK for existing updater users. Record `Level 3 merge approval: APPROVED` and `Internal TEST APK publication: APPROVED` only after that decision; no source or PR label implies approval.
3. Use **ordinary two-parent merge** of the exact authorized release branch into main (not squash or rebase). The existing trusted main-only publisher requires newest exact-merge Android / Database / Dashboard push CI success, valid release branch/metadata, version-only diff, prior v42 release ancestry, unchanged Room1–6 schema hashes, stable signer/package, sync ON, cleanup OFF, a single APK and SHA-256, and an unused immutable `fwh-internal-v44` tag.
4. If a gate fails or the trusted publisher reports SKIP, retain public v42 as latest, preserve TEST data, and diagnose only the exact failed gate; do **not** sideload an unverified APK or bypass the publisher.
5. After independently verifying the immutable release tag, source, digest and single `Field-Work-Hub-Internal.apk` asset, hand off the existing `Account & Updates` in-app update flow. Android requires the operator's installation confirmation. Do not uninstall, clear app data, or downgrade Room.

## Evidence and next boundary

**PASS carried forward:** PR #123 source head `a9310a1a` had Android/Database/Dashboard/Governance PASS and was merged as `7e92bd2e`; existing v42 public APK and TEST auto-update mechanism were already established. Reuse earlier accepted phone/offline/Drive evidence. The old v42-version CI artifact from #123 is **not** a new public APK.

**PENDING:** release-only final-head CI, exact v44/v45 APK SHA-256 and identity, operator version-specific merge/publication approval, protected ordinary merge, trusted main CI and public asset verification, actual Android in-place v44 installation, and one **NEW** focused device observation: on a previously untouched eligible TEST assignment, deliberately Start Work offline, close/reopen, reconnect and confirm accepted acknowledgment without a second Accept tap, preserving any previously queued evidence. Do not use the already-started replacement run as proof of a first-time Start. Do not repeat accepted field-camera/provider tests.

**Scope isolation:** phase **6D-T01 / FWH-F06 / FWH-AC3** remains the selected construction task, including ongoing combined original/replacement photo coverage and multi-run closure; publication does not complete that business outcome. The existing TEST follow-up run remains untouched. PR #116 deferred and #121 proposed setup-plan are outside this release. No automatic installation is claimed.
