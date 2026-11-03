# FWH Room6 internal TEST release policy — November 3, 2026

**Scope key:** `fwh-room6-internal-release-policy`
**Classification:** Level 3 — trusted APK publisher policy and CI artifact identity.
**Baseline / rollback:** main `ded6b7a771208c3865780ed3cc8c0a98a16be22f`.
**Authoritative branch:** `feat/room6-internal-release-policy`. This prerequisite owns publisher checks only; the subsequent version-only release uses `release/fwh-internal-v40-room6-test`.

## Authorization and protected scope

The operator explicitly confirmed proceeding with **preparing and publishing the v40 Android TEST update with automatic cleanup OFF** on November 3, 2026: “yes, normally it does.” This confirms the preceding “authorized” response and authorizes the necessary reviewed publisher-policy integration and version-only release/publication after passing checks. Do not ask for the same release authority again. This is not cleanup activation, a production release, silent Android installation or permission to repeat accepted field/provider tests.

PR #55 is merged at `d8a949f9`. The controlled TEST SQL handoff records migrations 130/131 applied and independently verified (131 total), while public v38 uses Room5. This task does not rerun SQL or change backend/provider state. The existing package, stable TEST signer, installer confirmation, offline work and originals remain protected. Automatic cleanup stays OFF; no database, schema, capture, action, transfer, worker or permissions change.

## Exact policy change

- Keep trusted main-only workflow, ordinary protected release-PR merge, explicit Level-3/publication metadata, monotonic even version, exact-main Android/Database/Admin checks, single candidate asset and immutable tag checks.
- Pin the merged-release publisher to Room6 and v40-or-newer candidates. Require explicit `automatic_cleanup_enabled=false` and `field_sync_enabled=true`; missing flags and recovery artifacts are denied.
- Freeze the Git blob identity of each retained Room schema 1 through 6 in candidate and release metadata. Android CI checks each JSON's schema version, compiler schema parity and the existing preserved-photo Room5→6 migration. Publisher compares every blob to the exact immutable merged source before publication. Missing, extra or mismatched lineage is denied.
- Keep the older UI-only publisher and manual Room5 helper unchanged. The existing trusted merged-release workflow is the one publication owner; no feature-branch publish, extra privilege or fallback bypass.

## Failure containment and recovery

A missing check, stale main head, wrong flag/schema/source/signer/hash or publisher/network failure blocks only publication. Installed v38 and local evidence remain intact. Fix the affected policy/version source and rerun its failed boundary; never overwrite a release/tag or uninstall/clear data. Before publication, the narrow policy commit can be reverted or the existing repository switch set OFF. If v40 is already installed, retain Room6 and publish a higher fixed version; v38 is not an on-device downgrade path. Recovery v41 remains artifact-only with field/private-photo networking OFF and cleanup OFF.

## Verification and handoff

Focused offline publisher tests cover missing authority, wrong/fork/stale source, failed/newer pending CI, forbidden diff, non-monotonic tag, Room5/7, enabled/missing cleanup flag, recovery flag, incomplete lineage and wrong source blobs. These are policy tests, not real-device results. Exact-head required Android/Database/Admin/governance and publisher CI remain the merge gate. The Android suite already includes real Room migration fixtures and disposable cleanup tests; do not repeat physical Google or accepted Samsung work-order tests.

**Next:** after verified policy merge, make the separate version-only v40/v41 change plus its release record; verify its exact-head checks, merge under the authorization above, wait for exact-main CI and verify the automatic immutable `fwh-internal-v40` asset/source/digest. Only the operator-confirmed in-place phone update remains a physical boundary. Cleanup activation/deletion is excluded.

## Verified closeout — November 3, 2026

Policy PR #59 final head `50079f35` passed Android `41685895280`, Database `41685895268`, Admin `41685895394`, publisher policy `41685895232` and governance, then merged `145889ce`. The separately verified version-only PR #60 merged `4351aa6b5e140301a49145a416a28e0e3fe5f6a1`. Exact-main Android `41686850053`, Database `41686850139`, Admin `41686850094` and trusted publisher `41687157746` passed. The automatic publisher created immutable `fwh-internal-v40`, exact source and single APK digest `7a9e43ec0c4d2bf7b9a3e75089469d9ee47bbfa63d4313d1538097a132d4a9c7`; no manual fallback or workflow privilege change was used. This fulfills the earlier Next instructions. Only the in-place real-phone migration/retention acceptance is pending; cleanup remains OFF.
