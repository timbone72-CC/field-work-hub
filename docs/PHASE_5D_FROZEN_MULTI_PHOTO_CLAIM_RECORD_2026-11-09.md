# Phase 5D — Bounded immutable multi-photo claim validation

**Status:** SOURCE-ONLY in progress; no SQL migration, hosted worker deployment, delivery activation or phone APK.  
**Scope key:** `phase5d-frozen-multi-photo-claim-20261109`.  
**Classification:** Level 3 — trusted client-delivery provider-step eligibility, although the exact trusted permit/RPC, owner and TEST-only pin remain unchanged.  
**Authoritative branch:** `feat/phase5d-frozen-multi-photo-claim-20261109`. Baseline/rollback: governed main `2158eac3908a3d5c6cdaae4ff4eb89c3f83f5980` (PR #67).  
**Plan:** Approved Phase 5 sections 5D/5E and approved November 1 per-package permit amendment; AGENTS.md, GOVERNANCE.md, PROJECT_PROFILE.md, RULE_INDEX.md, CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md, INTEGRATION_CONTRACT.md and phase staging doctrine.

## Exact changed boundary and why

The existing trusted `advanceTrustedDeliveryOneStep` can walk a frozen manifest and provider snapshot with multiple selected photos (bounded at 200). However, the package-scoped wrapper `advancePinnedTestPackageOneStep` rejects anything but **exactly one** selected photo at its initial trust gate. That prevents proving even the source-side step behavior for future normal multi-photo packages. The current server-pinned successful TEST fixture deliberately used one photo; retain that acceptance.

Under the existing per-package owner, extend only the *source validation* to accept 1–200 immutable selected photo IDs, requiring valid UUIDs and case-insensitive uniqueness. The worker **does not** accept a package, destination, root, photo identity or selected count from HTTP input; the service-only database supplies its current manifest and fencing. The same package ownership, one exact step begin/complete, immutable IDs, no duplicate remote creation and no final delivery without durable verified receipt remain mandatory.

Add isolated Node tests for (1) a two-photo frozen claim reaching one existing fenced metadata step; (2) missing, empty, malformed, duplicate (including mixed-case) and over-cap selections failing before step/provider entry; (3) a separate valid package making progress while the invalid one stays held. These are **synthetic fakes** only, not hosted or real Google evidence. No duplicate scheduling or alternate worker is added.

## Protected boundaries and explicit remaining gap

- No user-specified provider step; original occupied global permit, original reserved PHOTO-ID/session/offset/markers and previously delivered FPP-000003 are untouched.
- `client-delivery/index.ts` continues to hard-pin the same one-photo TEST package; general dispatch and legacy modes remain OFF. Automatic cleanup remains OFF. No phone, customer work, Supabase/Google ops or API credentials.
- The existing **TEST-pinned SQL expired-resume function still requires exactly one photo**. This source step does NOT claim that multi-photo provider delivery or resumed multi-photo leases are supported in the deployed backend. Any future service-only SQL/general queue expansion needs its own exact migration, RLS/permit/parent collision checks and controlled TEST provider boundary. Do not widen the current hosted pin or deploy this source as a multi-photo activation.
- Rollback: revert only this branch before any hosted change. No rollback may edit completed delivery, original held evidence or phone originals.

## Verification and approval gate

Require focused `node --test tests/functions/client-delivery-new-package-test-gate.test.mjs` and complete applicable Node/Database/Admin/Android CI on the exact source PR head. Inspect every changed block. Document actual passed/failed checks, test evidence classes and operator Level-3 pre-merge decision. **Level-3 merge approval PENDING** until explicitly received; no implicit publication, SQL push, provider Send, cleanup or APK release.

**Next:** reconcile exact-head CI and review; stop this source scope at the required Level-3 pre-merge gate. After accepted merge, the separately scoped multi-photo SQL/queue/provider work remains, not a repeat of the already accepted one-photo delivery.
