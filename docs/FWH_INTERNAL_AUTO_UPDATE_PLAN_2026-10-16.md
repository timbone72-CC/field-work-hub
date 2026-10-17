# Field Work Hub Internal — Streamlined Automatic UI Test Updates

**Status:** PROPOSED, needs one-time operator approval of the public internal-test release automation. **No automation enabled, no APK published, no Android updater runtime changed by this document.**
**Date:** 2026-10-16  
**Scope key:** `fwh-internal-auto-update-ui-preview`  
**Governance:** Level 3 for changing who may publish publicly downloadable APKs and the release/trust boundary; any Android updater UI-only improvements may be Level 2 but remain part of this coordinated, explicitly reviewed release change. PR #40 is the single authoritative pending Android/Phase 5–6 runtime branch; this plan alone does not grant its merge approval or expand photo delivery.
**Goal:** During repeated FWH UI/UX design corrections, stop asking the operator to run `ci/publish_internal_update.sh <run>` and type `PUBLISH` for every completed visual-test batch. Make a new *eligible and verified* internal TEST version available to the existing app without touching user assignments, evidence, photo capture, private provider release, or FPP.

## Existing system (source-audited)

- `.github/workflows/android-ci.yml` already runs Android JVM/regression checks, assembles candidate and recovery APKs, verifies immutable signer/package/Room identity and exports exact CI artifacts.
- `ci/publish_internal_update.sh` currently requires an operator on a laptop, a successful exact Android CI run, package/Room/signature/size/hash verification and a typed `PUBLISH`, then creates a publicly downloadable GitHub Release. It never overwrites an existing version tag.
- Android `MainActivity.checkForUpdates(false)` runs at start but throttles automatic checks to **six hours**; the update button/status sit inside Account & Updates. `InternalAppUpdater` downloads and SHA-256/signature/version-verifies the exact `releases/latest` public APK. `UpdateReleasePolicy` denies preview/draft/wrong-source/multiple-asset/recovery APKs. After download, Android's installer requires human confirmation.
- Already-public/internal versions are immutable (v28 published as screenshot baseline). New screenshot-correction candidate v30 / recovery v31 still requires its own release and device test. **Do not republish v28 bytes under an existing tag**.

## Proposed workflow (one-time approval, many safe updates)

**A. Automatic candidate generation** — on each relevant Android source commit, build/test candidate as now. Use monotonically increasing even internal versionCodes, and keep the odd protected recovery next version; derive and freeze both deterministically before building so release checks and app policy agree. Not every commit deserves a public APK.

**B. Gate public UI-preview publishing** — only a build marked **ready for phone review** in the approved UI/UX implementation record/explicit PR test-release marker is eligible. A single protected GitHub Actions release job must verify:
  1. this one authorized repo, branch, internal test app/package, signer, exact commit and exact frozen Android artifact;
  2. successful Android, Database and Dashboard required gates on the same head (no pending/failing checks); HEAD has not advanced and tests weren't bypassed;
  3. no release exists for that monotonically increasing version, and no unexpected secrets, alternate signing key, Room schema migration, Auth/RLS/storage/camera/capture/upload/delivery changes, or other unapproved Level 3 surface;
  4. a single signed internal TEST candidate asset with exact size/SHA; recovery APK and other artifacts remain **private GitHub Actions artifacts**, not published;
  5. all external delivery workers, Send, cleanup or provider gates remain governed separately (a released visual APK does **not** authorize those operations).
Publish **one** latest completed UI batch, not an unfinished commit or a series of superseded builds; if several batches pass while the phone is offline, the phone can skip directly to the latest higher version. New public TEST APK download is a deliberate one-time operator-approved change in distribution policy, not an automatically merged/deployed production release.

**C. Phone discovery and installation** — on app open and when the authenticated Home/Account returns to foreground, perform a bounded update check if sufficiently long since the last check (suggest 15 minutes, plus a visible manual `Check for Update` option). Show an unmistakable nonblocking update-ready banner at Home/Account; preserve manual retry if offline. Optionally predownload once on Wi-Fi/idle with explicit per-device consent, bounded cache, exact digest+package/signature verification. **Never initiate installation, focus-steal, app restart, or update UI while CameraX/photo capture or a critical local operation is active.** Offer one clear **Install update** action only when convenient; Android may still require user confirmation and Unknown Apps permission. A canceled installation must remain canceled. Keep user data/Room/ProtectedPhoto/field queue untouched; no uninstall or clear data.

**D. Failure paths** — CI failing/pending/stale head => no release; public GitHub outage => existing app fully functional and offline; download/hash/signature/size failure => delete partial and retain old app; incomplete or uncertain install => show truthful status; lower/same versions => no replacement; camera/busy state => deferred prompt; cross-account switch => no exposure of work data. No auto retry loop with unbounded download or notifications.

**E. Controls and reversibility** — repository-level kill switch disables auto-publication without changing the app; device-side automatic download/notifications can be opted out while manual Check/Update remains functional. Keep an immutable last-known-good release. If later UI candidate regresses, fix with a **higher** version after CI; Android and Room cannot safely downgrade; do not delete confirmed local evidence. Only owners authorized for the TEST channel can change eligible build/release markers. Record source SHA, CI IDs, artifact SHA, published release tag, exact installer test and rollback in the existing record.

## Verification and rollout gates

- Synthetic GitHub Actions tests: reject failed or partial suites, out-of-date PR head, forged readiness marker, wrong source or branch, non-UI changed file, unexpected schema or signer, duplicate version, asset hash mismatch, recovery asset publication, unexpected external destinations, and concurrent release attempts.
- Android tests: 15-minute throttling, repeated launches, notification/banner dismiss/reopen, offline/outage/retry, same or lower version, corrupted APK, camera busy deferral, sign-out/account switch, same-signer in-place update, protected originals and queued work continuity.
- One genuine Samsung test after automatic preview publication: update-ready behavior visible on Home, photo capture can be completed before install, Android confirmation, in-place installation over existing internal app, saved work/photos/Room and auth state preserved. Accept operator screenshots/“Works” as reality evidence.
- No repeated provider/Drive or unrelated camera-capture tests solely for UI update mechanism; no publication or runtime implementation until this Level 3 release-policy plan is approved, and no PR #40 merge without its separate Level 3 pre-merge approval.

## Outstanding one-time product/authority decision

**Recommended:** Authorize **automatic publicly downloadable TEST APK releases only for explicitly designated, fully verified UI-review checkpoints** on the existing internal package. Do *not* auto-publish every PR commit, auto-merge code, silently install or interrupt field work. This would replace the repetitive manual laptop `PUBLISH` step. Android installer confirmation still remains necessary.

**Approval needed:** Operator confirmation of this release/distribution policy. The current user request expresses a desire for automatic updates, but does not settle whether public TEST APK publication without a separate prompt is acceptable. Until approved, existing manual publish remains in force.
