# FWH PR #40 — pre-merge functions, UI and release-impact audit

**Date:** 2026-11-02 · **Classification:** Level 1 evidence-only review · **Scope:** Approved Phase 5–6 on PR #40.  
**Baseline assessed:** source head `f393702febfb1da579028fd2514c7a06a0bfb5bd`; PR #40 OPEN/DRAFT, mergeable with no submitted reviews; exact-head Database, Admin Dashboard and Android CI all SUCCESS. This report is **supporting evidence, not a replacement** for the single authoritative `PHASE_5_6_IMPLEMENTATION_RECORD_2026-10-06.md`; the latter owns the latest state, and source/head/CI must be rechecked before merge.

## Operator authorization and scope

Operator explicitly authorized merging PR #40 **when safe** on 2026-11-02. This is conditional Level-3 merge approval, not permission to bypass approved Phase 5D acceptance, activate a provider worker, run an additional Google operation, reset a HELD legacy permit, touch FPP, or publish to customers. No merge/production/deployment/provider write performed in this audit. Preserve prior passing phone/Drive/browser evidence.

## Tested or independently supported functions — do not repeat for reassurance

| Area | Accepted evidence and precise boundary |
| --- | --- |
| Android assignment and field actions | Samsung v36 signed in; Home, Work Orders, details/requirements, Accept/Start/Finish, reconnect FIELD COMPLETE, retained local photos and disabled further capture passed on `TEST-P4-REVISION-1005-D`. A **second independent** disposable TEST job `TEST-P5D-SECOND-001` passed assignment visibility, human Accept/Start, one-photo capture/Finish, reconnect FIELD COMPLETE. |
| Private photo holding/review | Four private receipts for original Samsung field walk-through; approved and rejected decisions persisted after Admin refresh. On second job, photo `9cc46c13` had a private receipt and was explicitly APPROVED. These are private, **not** client delivery receipts. |
| Isolated real client delivery | `FPP-000003` package/outbox DELIVERED with one permanent final receipt, verified PHOTO/MANIFEST/FOLDER plans, cleared worker lease, zero unfinished steps, and preserved earlier failed-step reconciliation. **Do not resend it.** |
| Second package prepared | `TEST-P5D-SECOND-001`: approved private photo; package `DRAFT`; no Send. This is **not** second delivery/concurrency proof. |
| Admin concurrency | Two genuinely distinct Admin accounts performed stale save/Reload Job; stale edit rejected with unsaved text retained and newer committed edit preserved. |
| Tenant isolation | Authenticated other-company TEST Admin could not list/read original-company work orders; private-photo signer denied with 403 `PHOTO_ACCESS_DENIED`. Does not prove every tier/office combination. |
| Evidence recovery and export | Samsung protected-photo recovery listing, ZIP export retained originals, downloaded work order accessible offline, reconnect and search passed. Manual TEST ZIP-to-Drive SHA-256 match passed separately; no automatic delivery implications. |
| Admin exact manifest preview | On `TEST-0003-DASHBOARD`, preview and two approved original/corrective photos agreed on manifest hash, order, target and layout. DRAFT remained unsent. |
| Code and responsive UI | Exact-head Database/Admin/Android CI SUCCESS, including browser workspace checks, migration/race tests and Android unit tests/build. CI is not blanket real-device/provider or every-account acceptance. |

## Controls found in current source — capability versus real-world proof

| User surface | Source/UI audit | Real evidence classification |
| --- | --- | --- |
| Work Orders/search/select/edit | Buttons and navigation hooked through `app.js`, `job-workspace.js`; job revision/collision guards, pagination and UI tested in CI | **PASS narrow** for user-created/assigned work order, two-Admin conflict, selected search; other statuses not blanket passed |
| Contractor Accept/Start/Finish | Server and Android owners present; tested on two separate disposable jobs | **PASS narrow**, not offline Finish/reassignment device matrix |
| Requirements/camera/photo receipt | Android UI/transfer and private review code present | **PASS narrow**, no original-cleanup-after-final-delivery proof |
| Photo review/bulk controls | `private-review.js` wires preview/select/approve/reject and paging | **PASS** individual approved/rejected; **CI-only/untested** live bulk/race branches |
| Client selection/package build | `client-release.js` wires Save client assignment, Save package draft, Preview exact package, Approve package, Send approved package | **PASS narrow** client assignment and DRAFT; complete general Send flow still OFF |
| Client folder setup | `folder-layout.js` wires Load verified destinations, Save folder preference and *constructed-ID* `folder-proposal-*` controls, including Record inactive proposal. **Not a dead button**: simplistic literal-ID search missed dynamic `pe('submit')` binding | **Source/CI**, not universal live provider-root onboarding |
| History, follow-up/correction | `release-history.js`, `followup-management.js`, `correction-draft.js` own handlers | Historical run visibility verified; some correction/follow-up device/hosted paths still **unverified** |
| Notifications/push/alerts | `notifications.js` binds controls and follows its backend; browser/device support and user permission differ by platform | **CI/source only** for broad real browser/OS push/email; optional functions not globally proven |
| Roles/owner/staffing | `owner-management.js`, `staffing.js` and related components own controls | Two real Admins + office capacity onboarding **PASS narrow**; Supervisor/office-role combinations not blanket proven |
| Recovery and updater | `recovery.js` and Android update functionality present | Recovery ZIP **PASS narrow**; new-update installation across devices **unverified** |

**Usability finding:** The current Admin delivery surface has several *separate* gates—select photos, save DRAFT, preview exact manifest, approve, explicitly Send—and sits inside a longer Delivery tab. The operator had difficulty finding the Save package draft action. The source UI supports it and the operator ultimately saved a DRAFT. This is a **workflow-friction finding**, not evidence of a dead button or a new photo/phone test requirement. Normal one-action Send automation has not been implemented or accepted.

## Merge consequences verified in source

1. The PR's `.github/workflows/pages.yml` runs on a `main` push touching `dashboard/**` or Pages workflow: **merging PR #40 publishes the new Admin dashboard at the normal Pages root**, replacing the previous root. This is a real operational UI cutover. The TEST `/phase56-review/` path is intentionally not the final published root.
2. Android CI builds and uploads a verified candidate artifact; a PR merge alone **does not install** an APK on a contractor device. The trusted internal UI TEST auto-publisher on `main` only accepts specifically marked eligible *PR-branch* head runs, not a general `main` merge. Avoid assuming an APK deploy.
3. GitHub merge **does not apply Supabase migrations** or deploy the Edge worker. Previously deployed TEST state and source/hosted parity still require reconciliation.
4. The live TEST `private.client_delivery_package_dispatch_config.enabled` is **false** while one `client_delivery_runtime.worker_ready` row remains true. `admin_package_state.can_send` and `admin_queue_package` check worker readiness and manifest, **not** the general dispatch flag. As a result an authorized Admin may be able to queue a valid approved package while the general processor remains OFF. This was compatible with the earlier *separately controlled pinned one-package TEST* delivery, but a queued request does **not** promise unattended processing. **Do not add a blanket `enabled=true` requirement without accounting for the approved isolated TEST exception.** Do not claim general client delivery ready for everyday use.

## Real pre-merge decisions, not invented retests

- **Gate A — package independence:** The approved 2026-11-01 per-package amendment requires two independent eligible synthetic packages to make progress without conflicting ownership/shared-parent writes and narrowly observed real provider behavior. CI covered database/worker simulations. First isolated actual delivery passed, but **second package remains DRAFT** and its independent provider observation is **PENDING**. No repeated capture/Google upload of the first package.
- **Gate B — final-delivery cleanup:** Automatic removal of original Android evidence only after a durable applicable final client delivery is **not physically proved**. No implicit deletion, changed identity or manual bypass permitted.
- **Gate C — publishing UI:** Before the protected `main`/Pages cutover, assess whether known TEST-only/disabled features are clearly distinguishable from working buttons and whether the old root can be restored from the known prior `main` revision. Do not treat every optional device notification as blocking if appropriately unavailable and disclosed.
- **Gate D — release parity:** Recheck exact final head CI, deployed schema/Edge parity, automatic Pages impact, and scope diff; preserve immutable HELD original state. Conditional merge authorization is already granted.

**Current audit disposition: NOT YET SAFE TO MERGE.** This is a bounded, evidence-based decision, not a declaration that prior delivery failed or an instruction to repeat accepted phone tests. Keep PR #40 draft until required Gate A/B and actual public-UI cutover risks are resolved or responsibly re-scoped under existing governance. The safe independent work may continue.

**Rollback:** For a failed normal Pages root publish, restore the previous `main` dashboard from the verified pre-merge base through a governed revert/rollback and verify the served root; do not downgrade Android Room/photo state or roll back protected TEST SQL identities, mutate FPP, or retry the held legacy provider operation as part of a UI rollback.
