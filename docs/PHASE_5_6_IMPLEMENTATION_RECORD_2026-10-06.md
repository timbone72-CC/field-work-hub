# Phase 5–6 dashboard workflow — implementation record

Scope key: `dashboard-workflow-enhancement-plan`. Overall change classification: **Level 3**.
**This is the single authoritative CURRENT Phase 5/6 implementation/handoff record.** Its entire previous text has been frozen without modification in the historical archives indexed below. Read current facts here before acting on older dated “next”, “pending” or “PASS” statements in archived entries. Reconcile this summary with current GitHub, required deployed TEST facts and approved phase plans rather than assuming that a recorded snapshot is live truth. Applicable governance/contracts remain authoritative.

## November 17 — require a client before new dispatch; 6C remains selected

**6C-T01 ACTIVE / FWH-F06 / AC3.** During the actual bulk-review walkthrough on existing TEST-P4-PHOTOS-1003, previews and checkbox selection worked, but correction setup exposed the job's missing client company. Read-only TEST confirms client_company_id NULL, eight received pending photos and no bulk action receipt. Do not claim bulk approval PASS or repeat camera/phone/provider checks. Operator directed that work must not reach this stage without a company. This is the current user-directed blocker fix, not a priority switch or reopening accepted 6A/6B evidence.

**One authoritative runtime line:** `fix/fwh-required-client-company-20261117`, scope `fwh-required-client-company-20261117`, **Level 3 / FINISH / 6C-T01**, base/rollback `95c76aa6d86bae2b799f31d4fd008e7464e41dd4`. Approved whole Phase 5/6 plans (PR #38, shared-access #39) plus operator's November 17 company-before-progress direction. Packs: AGENTS/Governance/Profile/Rule Index, Change/Testing/Integration, staging doctrine and affected Phase 5/6 plans. This branch becomes the sole CURRENT implementation-record owner while PR #116 stays deferred; that branch must reconcile this record on resume, not overwrite it. Its full prior record is preserved verbatim in [part 62](archive/phase-5-6/2026-11-17/PHASE_5_6_HISTORY_PART_62.md), with its earlier checkpoints in [part 61](archive/phase-5-6/2026-11-16/PHASE_5_6_HISTORY_PART_61.md). Shared index/create-panel edits are independent of PR #116's Delivery controls; reconcile cache keys when resuming it.

**Behavior/owners:** Create & Assign requires an explicitly chosen currently active same-organization client. The existing draft payload retains clientCompanyId through save/resume; old/incomplete drafts can remain company-less. A narrow Admin-only client-choice RPC uses the current creation authority, exposes names/UUIDs only and never selects a company automatically. Add client company reuses the existing normalized-name owner with NULL work-order context under this same creation authority, allowing first-client setup before any job; it creates no provider destination or dispatch. Existing exact saved-revision creation locks company eligibility and calls the existing create and audited first-binding owners in one transaction. Company validation/binding failure rolls back the entire new WO/run/assignment and retains its draft; a successful same-revision retry returns the same immutable receipt. Old company-less create RPCs become owner/service-only so normal office clients cannot bypass the rule. The company binding remains immutable after assignment. Creation failure affects only that entry; unrelated reads/field work continue.

Existing unbound legacy WOs/photos are retained; opening the workspace displays missing-company setup guidance, and the existing guarded Delivery assignment process remains owner. No guessed/backfilled company, changed requirements, reset/reassignment, mass block on offline field evidence, alternate transfer/Send owner, provider write, cleanup, APK or FPP change. Unknown creation outcomes retain the exact revision and forbid a different duplicate; failed/stale/account-switched client lists cannot enable dispatch. Client choice also scopes template suggestions without rewriting saved capture requirements.

**Verification boundary:** focused adapter/draft/account/failure checks; real disposable PostgreSQL missing/foreign/inactive client denial, atomic bind/consume/replay and legacy-entry ACL; existing old-work suites explicitly use CI-only historical fixture builders rather than a now-retired office API. Fixture builders exist only in local_test_actors.sql, never a hosted migration. Actual browser checks use mocked current client choices and one exact creation receipt. Final exact-head full CI required before explicit Level 3 merge approval. No hosted migration, actual new WO/client assignment or deploy performed. On authorization, deploy migration `20261117193000` to FWH TEST before publishing the compatible UI, verify installed definitions/grants/advisors, then one changed Create-form/company smoke; reuse all accepted camera/offline/review/provider evidence. Source baseline remains the rollback reference, but keep the server requirement if rolling UI back: creation stays unavailable on incompatible old UI until a compatible repair; never re-enable company-less dispatch or drop data to recover.

**Current evidence:** focused Node adapter/create/account/first-client checks PASS. Initial runtime b5718b36 CI PASS (241 dashboard, 483 functions, 8 provider, actual browser, database, Android and governance); final first-client/native-required-form addition still requires exact-head CI. Next gate: exact-head CI, then operator Level 3 merge/TEST-rollout approval. No claimed activation before actual deployment.

## November 16 acceptance carried forward — no repeat

PR #117 merged at f089db1: actual corrected package's Send event started in 1.8 seconds and reached a matching permanent final receipt in 23.7 seconds, five verified steps/HTTP 200s, one attempt; old expired package isolated. 5D-T03 COMPLETE, dispatch/event wake remain ON, two-permit cap retained. 5D-T02 manifest-only/T04 and 5E multi-run/cleanup remain open; run-2-only closure is not multi-run proof.

PR #118 merged at 95c76aa: 6B-T01 COMPLETE. #115 correction confirmation is deployed/accepted; D's real same-WO client return created fresh run 2/assignment/receipt/Accept, one new Front, accepted Finish/private receipt/Admin approval and corrected DELIVERED package, preserving earlier run/four photos/decisions/delivery. B's offline Accepted · pending sync survived complete close/reopen, then became office-confirmed on reconnect: run 654b0212-cd63-43a8-b89a-69be9c64f0a9 / assignment 244a48e2-7c69-483b-b168-faa2171a8b1c, event 2026-11-17T01:49:47.369035Z, receipt 01:52:30.124259Z, existing IN_PROGRESS/Start unchanged. Do not repeat this accepted check. Job C's retained local conflict remains isolated: phone Front minimum 1 versus server 2; exact local cause/evidence unknown, with no reset/clear/reinstall or requirement mutation performed.

PR #116 stays operator-deferred at 545e750879e28696fbd0d3e9357557ec7172bb83 / tree 41475ee79441d27e86b2effa677664b03fc9b3db. Package summary/Approve & send now/Approve for later/live status source is NOT on main/Pages. Exact runtime CI was PASS: 254 dashboard, 483 functions, 8 provider harness and real mocked desktop/mobile; later metadata-triggered governance also PASS (43999413008). Prior GitHub policy-window blocker has cleared; user hold remains. Resume only when directed, reconcile current main/record/cache hunk changes, then verify changed UI only. No repeated delivery fixture/Send is authorized by this record.

## November 15 acceptance carried forward — no repeat

PR #114 navigation fix merged at `2fa607c7`; exact final-head Android/database/dashboard/governance, 231 dashboard tests and actual mocked browser runs PASS. Pages 43800815090 PASS; live index/navigation/app matched main. Operator then explicitly confirmed **The page automatically switches to Create & Assign and shows the prepared draft**. This closes automatic reveal once. Prior completed-run snapshot reuse already observed Front 1 required, other items optional, total OFF/minimum 1; repeat draft Save/refresh/resume preserved those requirements and blank assignee. Do not repeat copy/navigation/restoration.

PR #112 template cancellation fix is merged/published with exact-head/main CI and live parity PASS. Accepted template slice: operator edited copied Front 2→3 (7 specified + 1 additional/minimum 8), saved separate nondefault organization-wide **FWH 6B COPY TEST** with description **Disposable TEST copy** and instructions **FWH 6B COPY INSTRUCTIONS**, then confirmed those instructions copied into the main work draft. Read-only TEST verified original P4 SMALL TEST remained Front 2/default; new copy Front 3/total 8. Duplicate old-name denial was resolved by a unique name; deliberate TEST copy and drafts retained. Native cancellation paths are credited to CI, not inferred from screenshots.

6A-T02 COMPLETE: accepted #109 existing-job and #110 unfinished new-work save/refresh/manual resume; TEST migration 141 verified before approved merge, Pages/main CI PASS; controlled exact create/replay rolled back. #107 queues and historical account/phone/private-receipt/Drive acceptance remain credited; missing organization timezone still limits overdue. Keep existing 5D/5E return conditions and ON dispatch/event-wake state; no manufactured delivery fixture or cleanup authority. Full superseded source and acceptance notes are [verbatim in part 60](archive/phase-5-6/2026-11-16/PHASE_5_6_HISTORY_PART_60.md).

## Superseded November 15 construction pointers

Completed source handoffs are preserved verbatim in [part 63](archive/phase-5-6/2026-11-17/PHASE_5_6_HISTORY_PART_63.md); current direction is 6C above.

## Superseded November 10–15 snapshots

Prior scheduler/cutover/delivery snapshots are preserved verbatim in [history part 54](archive/phase-5-6/2026-11-15/PHASE_5_6_HISTORY_PART_54.md). The current construction register and evidence below supersede their dated instructions.

## Superseded deployment and source handoffs

Earlier November 9–10 deployment/source snapshots are preserved [verbatim in history part 53](archive/phase-5-6/2026-11-12/PHASE_5_6_HISTORY_PART_53.md). Current November 12 facts above supersede their dated pending instructions.

### 2026-11-02 merged code and post-merge CI handoff

PR #40 merged at `e7def349`; its accepted main Pages/Android/Database results and the stale post-merge Dashboard CI assertion diagnosis are preserved verbatim in [history part 48](archive/phase-5-6/2026-11-02/PHASE_5_6_HISTORY_PART_48.md). Later PR #55 exact-main CI PASS and the current 131-migration TEST facts above supersede that dated 129-migration snapshot. Do not rerun accepted tests or infer a new APK/Send authorization. UI rollback remains governed and must preserve installed TEST SQL and protected evidence.

### 2026-11-02 Samsung v36 and office TEST field walk-through — accepted narrow operator evidence

**PASS (observed; do not repeat):** Operator installed FWH Internal v36 on Samsung and verified signed-in Home, Work Orders, work-order details, photo-requirement screen and navigation. On disposable test WO `TEST-P4-REVISION-1005-D` (Run 1 `7b93c0da-1a68-48e8-b3cd-53537873f076`), contractor Accept and Start worked; camera opened after Start, photo capture increased category/total counts, and Finish was saved locally. After online Refresh the contractor saw FIELD COMPLETE; the independent signed-in TEST Admin preview also showed FIELD COMPLETE and **4 photos / 4 verified private receipts**, with recorded Start/Finish and read-only permanent run history. Completed photos remained visible locally and further capture was disabled. Operator verified private Admin photo preview, one APPROVED decision persisted after browser refresh, and one REJECTED decision required a reason and also persisted (**1 approved, 1 rejected, 2 pending**). History showed **no correction obligations and no client package/delivery receipts**: reviewing/rejecting did not itself trigger a correction or Send.

**Additional narrow Samsung PASS:** Read-only protected-photo recovery listing; ZIP copy exported to Downloads and photo contents verified, originals reported retained; WO-number and address searches; downloaded WO accessible offline in airplane mode; reconnect and assignments Refresh successful; Account & Updates reported “Field Work Hub Internal is up to date” without installing an update; navigation Back from photo review to work-order details. Do not repeat these same-state smoke tests or require another install merely to restage evidence.

**Not proven by this walk-through:** Cross-job photo isolation was **not** physically exercised (UUID owner/run source and automated tests remain the applicable evidence); no second contractor/company isolation, reassignment/cancel, offline Start/Finish replay, notification push, recovery email, automatic update installation, whole camera/device matrix, original cleanup, or approved/Send/client-delivered package for this test WO was exercised. Separate isolated `FPP-000003` provider delivery PASS remains its independent boundary. Samsung v36 operational smoke PASS does **not** confer Phase 5/6 completion, production/Phase 7 launch, or Level-3 PR merge approval. Prioritize genuine security/provider/release gates; avoid invented repetitive phone checks.

**2026-10-19 real foreign-company Admin isolation — PASS:** Signed-in other-company TEST Admin could not see original-company WOs in exact/scoped reads; private-photo signer returned **403 `PHOTO_ACCESS_DENIED`** (Auth/sign-out logged, sign-out 204). This *specific* real browser denial is accepted; do not repeat. Other role/team/provider isolation scenarios remain unproven.

**2026-10-22 exact TEST package preview — narrow PASS:** For `TEST-0003-DASHBOARD`, Admin reviewed two APPROVED photos (original/corrective run); server preview agreed on manifest SHA-256, photo order, destination and layout. Package remained **DRAFT** with no Send or final receipt. Preserve this accepted preview evidence; do not confuse it with Google delivery.

### Previously verified Phase 6 evidence

**2026-10-31 Phase 6A real two-Admin browser conflict/recovery — PASS:** TEST WO `FPP-000003`: Product Owner saved `TEST TWO ADMINS - OWNER SAVED FIRST`; independent signed-in Incognito Admin's stale save was blocked with unsaved text retained. Operator clicked **Reload Job**, discarded only the stale TEST edit, and screenshot confirmed the owner's committed marker, not the stale marker; independent SQL readback agrees. Previously accepted same-account/two-session conflict test also PASS; do not repeat. This covers distinct-account browser conflict/recovery, not entire Phase 6.

**2026-10-31 Phase 6F TEST onboarding — VERIFIED:** Product Owner office controls user-confirmed after original missing allowance repaired by `ci/reconcile_phase6f_initial_office_allowance_test.sql`. Owner set **2 Admin / 0 Supervisor**; staff-invite switch enabled with allowlisted TEST callback, second Admin setup activated (invitation `CONSUMED`). Database confirms 2 distinct active Admins in the same office team. Other organizations, FPP and held photo delivery unchanged. Superseded details: [part 34](archive/phase-5-6/2026-10-31/PHASE_5_6_HISTORY_PART_34.md).

### Superseded source/completion snapshot

The earlier ownership/completion table is preserved verbatim in [part 63](archive/phase-5-6/2026-11-17/PHASE_5_6_HISTORY_PART_63.md). Current November 16–17 acceptance and remaining gates above supersede it.

### Deployed source and protected provider state (distinct evidence boundaries)

- Original frozen TEST delivery: **one HELD global dispatch permit**, original expired delivery attempt, encrypted `UPLOADING` session revision 3, persisted upload offset **262144 / 404185**, original one-shot identities and markers held, **zero verified PHOTO plans and zero final delivery receipts**. The saved offset is not independent proof of Google media bytes.
- Original saved-session diagnostic: `HELD_TEST_SESSION_UNAVAILABLE_404`, which is **not proof** that the original preallocated Drive file ID is nonexistent, accessible or safe to retry.
- Previously accepted real Drive evidence: the separate fourth disposable synthetic TEST Google upload completed exact remote ID/size/SHA-256 verification. That narrower provider result does **not** prove FWH protected-package end-to-end delivery.
- **Disposable current FWH TEST environment:** The operator confirmed October 27 that current FWH contains no customer work and fake photo bytes can be lost in controlled isolated TEST experiments. This does not automatically authorize resetting original held journal/ID, encrypted session, one-shot markers or permit; these are needed for truthful reconciliation. The original FPP app and any later customer work are excluded.

### New independent TEST evidence and legacy reference

The earlier separate manual TEST JPEG transfer remains a distinct accepted proof. The later controlled FWH automatic one-photo TEST package is now **DELIVERED**, supported by permanent receipt and read-only live Team database evidence above. Neither result proves general production delivery, broad provider recovery or Android field acceptance. Preserve the unrelated original held incident and consult its archived details only when in scope.

### Record size and archival discipline

The authoritative record has a **24 KiB (24,576 UTF-8 bytes) hard CI limit**. Per operator approval October 31, start archiving at **21 KiB (21,504 bytes)** and target **17–18 KiB** afterward. Preserve every superseded dated note verbatim in the numbered immutable archive, linked below; do not repeat accepted evidence or add approval gates just for archiving. Follow the original record integrity, rule, and exact-head verification requirements. The former detailed discipline note is archived verbatim in part 32.

### November 10 — FWH-F04 source branch (OFF)

`feat/fwh-f04-queue-worker-20261110`: trusted next-queued-package selection, one fenced step/wake, scheduler template only. Source/CI pending; SQL, worker, cron, Google, cleanup, FPP unchanged live. Level 3 premerge and TEST activation remain separate. Reuse accepted evidence; don't replay HELD.

## Frozen, losslessly preserved implementation history

[Numbered immutable history index (parts 01–60)](archive/phase-5-6/HISTORY_INDEX.md). Historical notes there are evidence archives, not the current status or a second implementation record.

**Precedence:** Latest independently supported evidence for the same precise boundary controls current status; do not upgrade SOURCE-ONLY or simulated checks to hosted, real Google, signed-in or device PASS. Archive creation changes no runtime, SQL, Auth, tests, CI, hosting, Google Drive, held permit/session/photos, FPP or governing documents.
