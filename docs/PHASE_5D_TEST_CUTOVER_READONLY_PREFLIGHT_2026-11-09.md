# Phase 5D — controlled TEST two-package cutover: read-only parity preflight

**Status:** READ-ONLY PREFLIGHT COMPLETE / CUTOVER BLOCKED PENDING SEPARATE LIVE AUTHORIZATION AND NEW FIXTURES. This is not a hosted/provider/phone acceptance or permission to Send.

## Change classification and limits

- **Scope key:** `phase5d-two-package-readonly-parity-20261109`.
- **Risk of this change:** Level 1, documentation-only; proposed TEST SQL/hosted runtime cutover remains separate Level 3.
- **Owner:** Documentation branch `docs/phase5d-test-readonly-preflight-20261109`, baseline main `d392446d4cdd8d3869500578b335f532c2846f36`.
- **Authority:** Approved Phase 5 parent plan, approved November 1 per-package permit amendment, and operator-approved source-only PR #70; none approves applying migration 132, deploying a new hosted worker, creating/sending TEST packages, activating dispatch or cleaning originals.
- **Rules read:** `AGENTS.md`, `GOVERNANCE.md`, `PROJECT_PROFILE.md`, `RULE_INDEX.md`, `CHANGE_CONTROL_CONTRACT.md`, `TESTING_CONTRACT.md`, `INTEGRATION_CONTRACT.md`, `docs/PHASE_STAGING_DOCTRINE.md`, current Phase 5/6 handoff, and source gate record.
- **Protected state:** original HELD legacy permit/remote identity/session, one verified delivered package/final receipt, v42 phone evidence, protected photos, role/tenant and exact package/destination identity, original FPP. All untouched.
- **External systems:** READS only from GitHub and exact FWH TEST Supabase project `vyocaujuwrivoqynvitm`. No database DDL/DML, Edge deployment, Google provider call, Android release/install, Send, scheduling, photo deletion or FPP access.
- **Rollback:** Delete/revert this documentary note, without altering TEST database, hosted functions, evidence or immutable historical archives.

## Verified live parity — November 9, 2026

1. **GitHub main and checks PASS:** PR #70 merged at `82669265`; documentation closeout PR #71 merged at `d392446d`. Main `d392446d4cdd8d3869500578b335f532c2846f36` reports Android CI `42718766093`, Database CI `42718766070`, Admin CI `42718766621` all SUCCESS. PR #70's own post-merge main `82669265` checks `42718042960`, `42718043197`, `42718043498` all SUCCESS. Latest published internal Android release is still `fwh-internal-v42`; successful publisher workflow conclusions alone are not evidence of a new release.
2. **Live TEST schema NOT upgraded:** Direct read-only SQL confirms **131** installed migrations, and `20261109221500_phase_5d_two_package_frozen_photo_scope.sql` (migration 132 in source) is absent; the new `private.service_bounded_frozen_photo_ids(jsonb)` helper is absent. Source/CI tested 132 disposable migrations; that does not constitute live migration.
3. **Live database cutover OFF:** `private.client_delivery_package_dispatch_config.enabled=false`, `max_in_flight=2`, **0** new package permits, **1** legacy permit and **1** permanent final receipt. The live `legacy_worker_off_verified=true` differs from the source-only rollout record's earlier `false` description; verify its provenance and the actual disabled legacy runner before any cutover. This flag by itself does **not** activate delivery; `enabled=false` is authoritative here.
4. **No new pinned-package fixtures yet:** Read-only package/outbox eligibility check returned **0** queued, unclaimed candidates; **0** QUEUED outbox rows among 3 package rows. Do not reuse the already delivered package or the original quarantined attempt. New package IDs, manifests, provider read proofs and destination binding remain **UNVERIFIED**.
5. **Existing service-only RPC grants retained:** For `private.service_record_pinned_package_provider_check` and `private.service_resume_pinned_package_dispatch`, `anon` and `authenticated` have no EXECUTE; `service_role` retains EXECUTE. This establishes only those current grants, not post-migration parity or a real cross-tenant provider gate.
6. **Hosted worker is still the previous version:** Supabase `client-delivery` hosted function **v60** is active. Its fetched `index.ts` has `enabled:false`, `pinnedTestEnabled:true` for the earlier one-package fixture, and **no** `twoPackageTestEnabled` / `twoPackageTestPins` settings; its hosted handler has no new two-slot commands. GitHub source contains the two-slot path compiled OFF with no pins, but **it has not been deployed**. The hosted worker retains a secret-header gate. Do not infer provider readiness from source tests.

## Narrow failure domain and next genuine gate

One package's uncertain step must preserve its exact permit, original provider IDs, durable attempt/lease and audit while independently authorized other packages can proceed; shared provider root, authentication, quota and legacy-worker overlap remain potential common failures. A rejected or incomplete cutover must leave the hosted earlier one-package configuration unchanged and general dispatch/cleanup OFF; show the precise missing prerequisite rather than retrying an uncertain package.

**Next permitted source/planning work:** reconcile the `legacy_worker_off_verified` provenance and write the exact separate controlled TEST deployment checklist. **Before any live change:** explicitly scope/authorize migration 132, reviewed hosted worker staging (still OFF), creation of TWO new independently identified disposable TEST packages, and any later provider read/proof or step. Verify no legacy runner overlap and identical current source/installed function and service grants after the migration; run post-DDL advisors. Pin verified new IDs only in a separately reviewed, gated source change; no arbitrary caller ID, unapproved provider Send, legacy recovery, customer dispatch or original cleanup.

**Disposition:** READ-ONLY PARITY PASS; two-package live eligibility and provider proof PENDING. No physical test repeated; no source/SQL/hosted/Google/mobile writes performed.
