# FWH — trusted postmerge internal APK publisher

**2026-11-02 · Scope key:** `fwh-postmerge-auto-publisher` · **Level 3** (publicly downloadable signed internal APK authority).  
**Parent approval:** User approved automatic verified internal updates after PR #40. This expands the approved 2026-10-16 UI-only publisher policy by a guarded postmerge release-only route; not blanket authority to publish any build.  
**Authoritative branch:** `feat/verified-postmerge-internal-apk-publisher` · **main starting point:** `7570d15fe79ed7df950cd893b23e1affb00b1543`.  
**Separate Level-3 premerge approval:** PENDING until the user explicitly authorizes merging this trusted release-publisher change.  
**Separate release project:** v38 candidate in draft PR #53, version 38 and protected recovery 39. Do not merge v38 before trusted publisher is actually installed on main.

## Implemented source and boundaries

Replace the now-obsolete PR40-head-only privileged workflow predicate with trusted `workflow_run` on **successful main-push** Android/Admin/Database CI completion. Run only checked-out main publisher Python, never candidate/PR script, and serialize only eligible publisher jobs. Existing repo variable `FWH_UI_AUTO_RELEASE_ENABLED` remains kill switch.

The new `ci/auto_publish_merged_internal_release.py` declines publication unless:
- `main` still points to the exact successful trigger SHA; it has a normal two-parent merge whose second parent matches one uniquely associated merged release-only PR, same repository, `main` target and `release/fwh-internal-vNN-...` source branch;
- the PR body unambiguously records `Change level: Level 3`, `Level 3 merge approval: APPROVED`, `Internal TEST APK publication: APPROVED`, and exactly one matching even `Internal TEST APK version`;
- the difference between the merge's first parent and merged HEAD is restricted to version bump in `app/build.gradle`, the frozen APK identity writer `ci/write_phase5_artifact_identity.py`, and at most one matching release record (no provider/database/Android runtime changes, installer code, FPP, permissions, signing or Room migration);
- the newest exact **main push** Android/Admin/Database CI attempts all passed, with no pending newer attempt; existing public release is immutable and lower-version, its source an ancestor of the previous main, and next tag unused;
- the Android CI private artifact inventory contains exactly the candidate APK plus metadata; hash, source, package, tested public signer, version code and Room 5 match. Recheck mutable GitHub source/CI/prior release immediately before publication. GitHub Release creation is the only intended external write.

**Physical boundary:** Android checks for the new published release and requests human install confirmation. Do not uninstall or wipe existing v36 data/photos. One in-place update acceptance is enough; no repeat work-order/photo TEST ritual.

**Unrelated dormant features:** FWH Team TEST general package dispatch remains OFF and original held permit isolated. Two independent live provider deliveries and automatic local original cleanup remain unverified/inactive; this publisher cannot activate either. The previously DELIVERED synthetic package stays immutable and untouched.

## Evidence / Remaining Gates

- **PASS** (existing): PR #40 merged; Admin Pages root deployed, Team TEST migration 129 installed; v36 Samsung smoke, accepted protected-photo evidence; v38 on PR #53 earlier Android/Admin/Database/Governance CI success, frozen signer/package/Room and recovery identities.
- **SOURCE IMPLEMENTED:** Trusted postmerge policy, main workflow predicate, fail-closed regression tests, and explicit per-release approval fields. No public APK release or installation.
- **PENDING:** new publisher PR CI, targeted check of policy tests in the trusted workflow, separate operator Level-3 merge approval, main merge and exact main policy integration; then add version/approval fields to the v38 PR, merge with its own explicit operator approval after complete CI; observe one trusted publication/record release SHA and verify optional user-initiated install.
- **ROLLBACK:** Previous trusted publisher on `main` at `7570d15f`. Revert only workflow/policy changes if broken. Keep v36 public release and all local photos intact. Never overwrite a release or clear a provider permit as a rollback.
- **Next checkpoint:** Correct only concrete CI failures, verify exact-head tests, then request separately mandated publisher pre-merge approval. Do not auto-publish v38 while PR #53 is draft or its per-release approval is PENDING.
