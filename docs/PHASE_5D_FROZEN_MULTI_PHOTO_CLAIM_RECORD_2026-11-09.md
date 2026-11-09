# Phase 5D — Bounded immutable multi-photo claim validation

**Status:** SOURCE-ONLY MERGED via PR #68 at `21f546b055531ac7021f19dc9da12ba6df794813`; no SQL migration, hosted worker deployment, delivery activation or phone APK.  
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

**Approved November 9:** Operator explicitly authorized merging PR #68 as the verified, source-only change. Exact PR head `f8728cd2c61debb78c81a0ce8fc57b7fef493c9e`, Governance `42709857865` PASS, Admin/Node (including added isolated tests) `42708924175` PASS, Database `42708924051` PASS, Android `42708924211` PASS. Complete six-file PR diff reviewed. PR marked ready and merged by protected SHA-locked two-parent merge at `21f546b055531ac7021f19dc9da12ba6df794813`. Post-merge exact-main checks: Database `42709917353` PASS, Admin `42709917835` PASS, Android `42709917334` PASS. Trusted publisher latest `42710278366` SKIPPED; published app remains v42. No implicit publication, SQL push, provider Send, cleanup or APK release.

**Next:** Reconcile exact-main CI statuses and keep this limited source work closed. The separately scoped multi-photo SQL/queue/provider implementation and real two-package acceptance remain PENDING. Do not repeat the already accepted single-package delivery or v42 phone checks.
