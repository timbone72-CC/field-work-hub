# Phase 5D — FWH TEST hosted v62: exact two-pin all-OFF deployment receipt

**State:** DEPLOYED AND VERIFIED, no provider mutation activated. **Date:** November 9, 2026 CST / November 10 UTC.
**Scope key:** `phase5d-v62-two-pin-all-off-test-hosted-deployment-20261110`. Execution of operator's explicit "Authorize FWH TEST all-OFF v62 deployment" following merged PR #77 source and PR #78 preflight.
**Environment:** only FWH TEST Supabase project `vyocaujuwrivoqynvitm` (Business connection), distinct from original FPP. **Changed external system:** existing hosted `client-delivery` Edge Function only. **Classification:** governed Level 3 hosted deployment under approved Phase 5D / November 1 permit design; this document-only receipt is Level 1.
**Source:** merged PR #77 `960d07ac1e82a3d36e79ad516d3a47321ad1c5ce`; [preflight and rollback](PHASE_5D_V62_ALL_OFF_HOSTED_PREFLIGHT_2026-11-10.md). PR #78 documentation handoff merged `091f315c6a102bb83a4c0955199511a79cb056c4`.

## Executed and verified

- Before deployment: four required PR #78 CI checks PASS; original PR #77 and exact-merge-main Android/Database/Admin CI PASS. Supabase read-only preflight showed 132 migrations including `20261109221500`, dispatch `enabled=false`, legacy runner retired `true`, concurrency cap 2, zero new per-package permits and queued outbox; original global permit 1 and historical DELIVERED outbox 1.
- Independently approved FWH TEST packages with frozen one-photo manifests: `TEST-P5D-SECOND-001` → `e18463b2-9afe-41b8-9700-721738839b22`, SHA-256 `c473b310c9b6af2c365847165ff2d21282fc5a8e760984ca3e7df5886d2ca3a3`; `TEST-P4-REVISION-1005-D` → `e690b8c4-708f-44c2-b6f3-4da01dc07ac4`, SHA-256 `f2cfff92e19c57e1b0ecdcb0a3490e5157ad3f46a3d3828c99b7798b920edbc6`. Both bind to active verified TEST destination `06f157eb-230c-44b5-b3d4-a7508110bfd7` and root `1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK`; no provider account/root GET in this step.
- Pre-deployment source parity: hosted v61 ACTIVE, `verify_jwt=false`; **13/14 files equal** to exact merged code. Only `client-delivery/index.ts` differed: v61 had `twoPackageTestPins:[]`, main added the two hard-coded pins with slots still OFF.
- Authorized deployment replaced only existing `client-delivery`, using the exact **14 files** from PR #77 merge and unchanged entrypoint `client-delivery/index.ts`. Preserved `verify_jwt=false` and secret-header worker authentication. Supabase returned same function ID `2c41bb2b-1c08-4690-9140-e05d714cac86`, **v62 ACTIVE**, bundle SHA-256 `a052927af497ee68c62e6ccf90235fec43ee7ea766ad722be02d77d1382d8c84`.
- Independent hosted read-back: **14/14 byte-for-byte MATCH** the immutable GitHub source. `enabled:false`, `testRecoveryEnabled:false`, `pinnedTestEnabled:false`, `twoPackageTestEnabled:false`; retired one-package pins empty; two new literal pins exact; `verify_jwt=false` unchanged. No handler, Google provider, legacy recovery or Send invocation.
- Postflight read-only SQL: same **132** migration records and canonical version `20261109221500`; dispatch OFF, legacy retirement TRUE, cap 2; **0 new package permits, 0 queued outbox, 1 historic global permit, 1 historic DELIVERED outbox**. Both packages still APPROVED with one photo each, same SHA/destination/root, zero outbox/permits, destination active and verified.

## Failure containment, rollback and next gate

No database write, migration, Edge secret/environment change, Google Drive operation, file/folder creation, Android/APK install, photo cleanup, FPP change, or alternate worker. ACTIVE means hosted, **not that any mutating delivery mode is enabled**.

**Failure containment:** Preserve exact uncertain package journal, session and IDs; independent eligible packages can progress only under per-package and shared parent/root guards. Shared root or provider authorization problems may affect both. Preserve legacy HELD permit and `FPP-000003` confirmed final receipt.

**Rollback:** Keep `private.client_delivery_package_dispatch_config.enabled=false` and all hosted mutating modes OFF; retain migration 132, approved packages, permits and original provider evidence. If needed, deploy reviewed **all-OFF-compatible v61** (bundle `eb2a7cc6b47703a3442c889936ad848f1e93aef4ba5a3fffa1824568e1e8c11d`) or a reviewed all-OFF v62 correction. **Never** restore historical v60 (active one-package pin) or reset legacy journal. No rollback needed now.

**PASS:** Controlled TEST two-pin all-OFF deployment and exact 14/14 parity; unchanged database state. **PENDING:** Separately authorized fresh Google read-only account/root/destination proof for the two pins, then independent review and authorization for any active slot/step, explicit Send, provider mutation or cleanup. Do not repeat accepted phone/one-photo Google transfer checks.

**Governance:** AGENTS.md; GOVERNANCE.md; PROJECT_PROFILE.md; RULE_INDEX.md; CHANGE_CONTROL_CONTRACT.md; TESTING_CONTRACT.md; INTEGRATION_CONTRACT.md; approved Phase 5 plan; November 1 permit amendment; docs/PHASE_STAGING_DOCTRINE.md.
