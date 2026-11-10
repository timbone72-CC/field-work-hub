# Phase 5D — TEST migration 132 and hosted two-slot OFF staging

**Status: DRAFT PR #74 — SOURCE PREPARED; LEVEL-3 MERGE APPROVAL PENDING; NOT DEPLOYED.** No TEST database, hosted Edge, Google provider, Android, original FPP or photo operation is authorized by this note.

## Scope, ownership and rollback

- **Scope key:** `phase5d-two-slot-off-hosted-staging-20261109`. **Level 3** (trusted worker mutation modes, even though all compiled OFF).
- **Authoritative line:** `feat/phase5d-off-hosted-two-slot-staging-20261109` from governed main `744ecef6627f1d26aad10dedf57cf7ba51122e75`; do not create a competing cutover PR.
- **Approved behavior:** Whole Phase 5 plan and November 1 package-permit amendment; the previously approved PR #70 adds the frozen 1–200-photo SQL/worker scope without activation. This stage changes no authority or provider behavior beyond *removing* the previously compiled one-package TEST route.
- **Touched:** Existing trusted `client-delivery/index.ts`, existing focused Node hosted-mode test, this impact record and current Phase 5/6 handoff. No alternative worker, scheduler, credentials, DDL edit or Android changes.
- **Protected:** Legacy v55 HELD singleton/session/one-shot remote IDs, immutable delivered `FPP-000003` receipt and audit, per-package fenced owner, same-root parent serialization, company/org/role grants, private evidence, Android v42 photo retention, cleanup OFF, original FPP.
- **External state touched in this source batch:** GitHub commits and CI only; FWH TEST project `vyocaujuwrivoqynvitm` read-only parity.
- **Rollback before deployment:** Revert this narrowly scoped PR, preserving live SQL131/Edge v60 and all existing identity/evidence. **After separately authorized staging:** keep `client_delivery_package_dispatch_config.enabled=false`; stop any worker wakeups, keep both pinned routes OFF, and redeploy the exact reviewed all-OFF handler if necessary. Do not roll back additive SQL or restore a write-capable old worker merely for convenience.

## Exact safe staged artifact

Existing trusted handler and source-only two-slot code remain intact; in the deployed entrypoint:
- `enabled:false` (general delivery) and `testRecoveryEnabled:false` (original recovery).
- `pinnedTestEnabled:false` and all three previous one-package literal pins **empty**. Historical remote IDs are preserved in database/receipts; no old TEST package can be selected by the new entrypoint.
- `twoPackageTestEnabled:false` and `twoPackageTestPins:[]`; no new package is selectable, even by an authenticated worker POST.
- The independent `testPreflightEnabled` read-only probe remains environment gated as before. No payload-supplied UUID, broad queue, scheduler, automatic Send or cleanup.

Existing Node tests must prove the compiled-off settings, empty identities, no old pin, denial of both slot commands and the old single-package command, while preserving isolated synthetic testing of the strict handler contract. Full exact-head Android/Database/Admin/Governance CI is required before Level-3 merge approval.

## Live TEST verification and ordered deployment gate

**Read-only before source work (November 9):** 131 live migrations; migration `20261109221500_phase_5d_two_package_frozen_photo_scope.sql` source only; `enabled=false`, `legacy_worker_off_verified=true`, cap 2, one protected legacy permit, zero new permits, one permanent final receipt, no queued outbox; hosted `client-delivery` v60 still has the earlier one-package TEST pin. The historical v55 shutdown was accepted and is documented in [read-only cutover record](PHASE_5D_TEST_CUTOVER_READONLY_PREFLIGHT_2026-11-09.md).

**Not authorized by this branch/PR; execute only after the relevant explicit TEST deployment authorization:**

1. Re-read exact branch/main, approved PR merge and CI. Verify a clean FWH TEST target `vyocaujuwrivoqynvitm`, 131→132 is the **only** pending migration, no drift, no active delivery/cleanup, and immutable held and delivered evidence unchanged. Preserve read-only row/receipt counts.
2. Apply ONLY the already reviewed additive migration `20261109221500_phase_5d_two_package_frozen_photo_scope.sql`. Verify migration 132 installed once, bounded-photo helper private/nonexposed, previous service-only RPC grants and default OFF state unchanged; run post-DDL Supabase security/performance advisors. Failure: STOP, do not deploy worker or roll back rows.
3. Deploy the complete reviewed `client-delivery` source bundle at the approved exact merge SHA **with both pinned modes OFF and no pins**, never enable a scheduler or issue a provider step. Re-read hosted deployed entrypoint, file parity, secret-header requirement, prior one-package command denied and two-slot commands denied. Verify general delivery and original recovery remain OFF, DB dispatch OFF, no change to protected receipts/permits. Do not treat source-only mocks as hosted/provider proof.
4. **Stop at the separate fixture/provider gate.** The two new disposable TEST packages, exact destination/root, independently confirmed private receipts, provider account/root GET, approved pin-setting source PR, explicit Send and later one-step provider calls are NOT part of this staging. No replay of the accepted delivered package or original HELD incident, no phone test and no photo deletion.

**Failure containment:** Uncertain provider outcome stays with its frozen package, exact remote ID, session and journal; a common account/root/Google outage can affect both packages. During staging, the safe state is **no mutating worker at all**. On SQL/host parity, grant, mode, identity, CI or host-version mismatch, stop only this delivery rollout, leave other approved Admin/Android work operating and preserve all evidence.

**Current result:** Source changes committed; actual CI and PR-head status must be recorded after they run. Migration 132, hosted function staging, real two-package fixtures and provider proof are PENDING.
