# Field Work Hub — Phase 4 Implementation Plan — 2026-10-03

Status: **APPROVED SCOPE — V12 UI DEFECT CONFIRMED; CORRECTED V14/V15 BUILD AND CI PENDING**

Current runtime evidence and staging authority: [PHASE_4_IMPLEMENTATION_RECORD_2026-10-03.md](PHASE_4_IMPLEMENTATION_RECORD_2026-10-03.md). Original planning classification/history below remains historical.

Plan ID: `phase-4-implementation-plan`.

## Classification and authoritative line

- Goal: Admin-configured per-WO photo requirements, a quick offline photo-list/camera workflow, protected capture, incremental preparation and requirement-checked Finish.
- Current change: **Level 1**, documentation only. Eventual implementation: **Level 3**, covering server authority, Room migration, immutable photo evidence and completion synchronization.
- Authoritative planning branch: `docs/phase-4-photo-workflow-plan`; scope key `phase-4-implementation-plan`. Preflight found no open PR or existing Phase 4 implementation line. The planning PR owns its final integration result; create one runtime branch/PR only after this plan is integrated.
- Baseline / documentation rollback: main **eb894872239b1202bf346272dc60748d837dc116**, merged Phase 3 PR #32 at 2026-10-03T19:21:08Z. Retain Phase 3 accepted backend, automated and physical evidence.
- Rule packs: AGENTS, GOVERNANCE, PROJECT_PROFILE, RULE_INDEX, CHANGE_CONTROL_CONTRACT, TESTING_CONTRACT, INTEGRATION_CONTRACT, PHASE_STAGING_DOCTRINE and relevant roadmap requirement/lifecycle/Phase 3–5 sections.
- Current affected surfaces: this plan and `docs/ROADMAP.md`. External systems changed: **none**. No runtime, schema, dashboard deployment, APK, account, protected evidence or FPP changes in this planning change.
- Eventual external surfaces: existing FWH Supabase **vyocaujuwrivoqynvitm**, existing Admin dashboard and independently installed FWH internal Android app. No replacement backend or technical identity.
- Protected behavior: server-controlled organization/role/assignment authority, run and assignment-instance binding, immutable action/photo UUIDs, owner isolation, protected originals, encrypted session coordination, conflict preservation and truthful acceptance/delivery state. Original FPP remains untouched.
- Planning verification: review every affected document/block, resolve contradictory counting/checklist rules and `git diff --check`. Runtime/DB/device gates remain **PENDING**.

## Approval and amendment authority

The 2026-09-14 approved roadmap includes the whole Phase 4 camera/protection/preparation baseline. On 2026-10-03 the operator deliberately expanded its photo-requirement design: reusable defaults, per-WO custom items/counts, Admin on/off control for **every** requirement including Total, and one photo satisfying **one item only** while counting once toward Total. Kitchen/Living Room and During/other views follow the same rule.

At **2026-10-03 15:00:44 America/Chicago**, after reviewing the optional item instructions, Admin ordering and count summary, the operator said: **sounds useful. we can try it. make sure the plan matches the scope and continue**. This records approval of those discussed scope changes and continuation under the existing whole Phase 4 baseline. This document consolidates the entire phase and its necessary authority/recovery/verification details; it does not claim the operator separately reviewed its exact technical text. Routine implementation refinements inside these decisions do not create another letter-only approval. Material product/protection changes need a consolidated amendment. Separate explicit Level 3 pre-merge approval remains required for the runtime PR.

The old exclusion of named photo items and old overlapping Stage/Wide counting are **superseded** by this amendment. No vendor's feature set is imported wholesale. HNP examples are configurable operator examples, not verified company policy or hard-coded defaults. The ambiguous earlier total/closeup quantities are not guessed: Admin enters the actual values needed.

## Whole-phase scope and dependencies

| Section | Work and ownership | Dependency / evidence boundary |
| --- | --- | --- |
| 4A | Organization templates, per-run requirement snapshot/revision, Admin controls and server freeze/validation. | Focused authorization, snapshot and edit-vs-Start race proof before trusting clients. |
| 4B | Additive Room photo/Finish persistence and owner-scoped offline requirement list. | Preserve real v1/v2 state; establish capture and Finish transactions before camera integration. |
| 4C | CameraX multi-shot capture, item-bound counters and safe pre-Finish discard. | Durable reservation first; automated capture/lifecycle seams before device proof. |
| 4D | Incremental serialized preparation and startup recovery. | Never owns/deletes the protected original; develop together with 4C. |
| 4E | Frozen metadata and existing action-sync integration, server count checks, recovery APK and combined gate. | Same UUID/revision through retry; no Drive byte delivery. Final exact-head suites then one combined laptop/phone gate. |

These sections organize **one numbered parent phase**, not five design approvals or five phone tests. Build the largest safe coherent runtime batch in dependency order, with focused verification while developing. Retain one owner per boundary; extend the existing queue/session/sync rather than adding a parallel action engine.

## Admin workflow and requirement shape

At WO creation/edit before Start:

1. choose the existing flat work type / Custom-Other path;
2. choose a saved photo template or use its work-type default;
3. edit a visible flat requirement list for this WO;
4. review the minimum-photo summary, then save/assign through server-authorized actions.

Total has its own enable checkbox and minimum. Each item has a stable UUID, name, enable checkbox, minimum, optional short instruction and display order. An item may carry a stage (`BEFORE`, `DURING`, `AFTER`, or none) and a framing hint such as Wide/Closeup to guide its own capture; these are context for that item, **not secondary credit toward another item**. A named combined item such as `Before — front-left corner — wide` represents exactly one requirement.

Admin can enable/disable every item and Total independently for each WO, change counts, add a custom item and arrange the list in a suggested field-walking order. That order is optional for the inspector: any enabled item or Extra photos can be selected next, including revisiting an unfinished or completed item. It is a display aid, never a capture sequence or Finish condition. Disabled items retain their Admin configuration but do not appear as required contractor tasks or block Finish. No requirement is mandatory merely because it existed in a template. With every requirement off, photos remain available voluntarily and Finish has no photo-count minimum.

Saved templates are organization-scoped, reusable and active/archive capable. Applying a template **copies** its values into the run; later template rename/edit/archive changes future defaults only. Editing an individual WO does not silently change its template or another run. One-off Custom/Other requires no permanent template. Do not seed speculative business rules. Keep templates/list flat; no category hierarchy, inheritance, general form/report builder or conditional-rule engine.

Validate whole nonnegative counts, bounded integer arithmetic, unique item IDs, nonblank enabled-item names, unambiguous names within the list, supported stage/framing values and deterministic ordering. An enabled required item needs a positive minimum; zero/disabled means no count obligation. Save rejects malformed snapshots on the server as well as showing actionable field errors in Admin. A duplicate-name warning/error should point to the actual rows rather than inventing two distinct requirements with identical labels.

Let `S` be the sum of enabled item minimums and `T` the enabled Total minimum (zero when disabled). The minimum distinct-photo count is **max(S, T)**. If S=26 and T=30, show **26 specified photos + at least 4 additional photos**. If S=40 and T=30, show **40 specified photos; these also satisfy the total minimum of 30**. The additional photos can be more shots of any enabled item or Extra photos; no separate Extra obligation is imposed. Do not reject a redundant smaller total or silently change Admin's entered values. Counts are minimums, never capture limits.

## One-photo / one-item counting

Every photo is assigned at capture to exactly one enabled item UUID, or **Extra photos** (no requirement item). It counts once toward the current run's unique valid-photo Total and at most once toward its selected item's count. It cannot satisfy Kitchen and Living Room, During and a corner view, or any other pair of items. A Wide capture hint does not earn additional required-item credit. Extras count toward Total only.

One group can describe the precise view/stage needed; separate groups require separate photos. Existing B/D/A defaults can become separate items. Stage labels/camera framing may be shown for context, but aggregate stage/Wide summaries must never act as a second overlapping requirement engine. No automatic image-content judging or quality claim: selection/counts are enforced; the inspector and Admin remain responsible for actual coverage.

Counters count durable, valid, non-discarded captures belonging to this exact owner/WO/run and frozen snapshot. Count unique photo UUIDs, never callback attempts, derivative files or duplicate metadata submissions. A preparation failure with a valid original still counts as captured evidence. An empty/missing/unreadable original is a visible problem and cannot be reported as valid capture merely because a row exists.

## Contractor workflow

`Open downloaded run → read requirements → Start Work → photo list → tap item → Take → Take → Take → Done → choose next item → Finish Field Work`

Before Start, show the snapshot summary and short instructions. During work, show named items in Admin's suggested order with captured/needed counts and completion checkmarks. The inspector may follow that order or freely choose any item; no item requires another item to be completed before it can be selected, and no sequence check applies at Finish. Completed items may collapse/hide from the remaining list but stay reachable for extra shots/review. Keep **Extra photos** available for blind spots and useful coverage. No requirement selection after every shutter: the current item remains selected until the inspector explicitly changes it. Show the selected item/instruction and its count beside the camera. Done returns to the same run's list.

No per-photo notes, manual checklist-complete buttons, auto business-stage advance or forced upload-wait screen. Valid photos satisfy an item automatically. If all item requirements are disabled, open a straightforward camera/Extra workflow without forcing an empty checklist or stage selector. A Total-only run uses the same simple capture workflow with its total counter.

Finish shows exactly which enabled items/Total remain unmet. It never offers a contractor bypass. A required subject that cannot be photographed remains visibly unmet; contact Admin under the existing conflict/business process rather than inventing a mid-job waiver. Admin configures the requirements before Start; this amendment adds no post-Start override.

## Snapshot authority, freeze and offline races

Supabase owns templates, dispatch/run snapshots, revision and current authorization. Room owns the downloaded snapshot and local evidence. Fetch the current run's snapshot/revision with existing owner-scoped assignments; do not treat the cached placeholder JSON as an authoritative empty requirement set.

Admin edits before Start use the same WO/run serialization boundary as Start/reassignment. Use a stable snapshot revision plus expected revision on edits and field actions to reject stale writes. Server Start freezes the run snapshot; local offline Start freezes the exact downloaded snapshot/revision transactionally with START intent, before any capture. Template edits never rewrite a dispatched or locally frozen snapshot.

If Admin edits a server-ASSIGNED run while its old revision was started offline, acceptance rejects the revision mismatch as **Needs review**, preserving original actions/photos/snapshot. Refresh cannot silently adopt the new requirements or rebind old evidence. A later assignment A→B→A, cancellation, run replacement, account change or requirements edit does not authorize replay. Capture/Finish must refuse known conflict or wrong owner/run; no new capture is permitted against a merely selected stale screen. In-flight nonempty capture bytes are still preserved if authorization changes during the callback.

Legacy compatibility is explicit: existing Phase 3 runs/actions with no configured requirements retain their historical unconfigured semantics and immutable IDs/times. Already started/complete runs are not retroactively assigned requirements. New or pre-Start configured runs use the versioned protocol even if Admin disables all counts. An unknown/malformed future snapshot must visibly block affected Start/Finish, not decode as no requirements. Old APIs/old clients must not bypass configured-run count/revision guards. Require the update visibly for that path while keeping genuinely legacy pending actions safely replayable. Do not rewrite an accepted action payload or infer replay authority from a newer assignment.

## Runtime ownership and implementation boundaries

- Server: extend existing run `requirement_snapshot` authority, org-scoped templates, narrow Admin mutation/read APIs, current assignment projection and existing Start/Complete acceptance. Validate same-org active Admin/Contractor authorization, snapshot revision and count evidence inside locked operations. Keep privileged helpers private with narrow public wrappers, explicit grants/RLS and fixed search paths. Reconcile all existing mutation entry points so none bypasses freeze/count rules.
- Dashboard: extend `dashboard/app.js`, `dashboard/index.html` and owning styles/components, preserving current create/edit/assign/reassign/session/auto-refresh behavior. Template controls use server authority; no client broad grants or local-only saved rules.
- Room: extend `TeamDatabase`, existing cached snapshot/DAO/store and action records with an additive **v2→v3** migration, plus the existing v1→v2 path. Add one photo owner for durable original/derivative metadata, item binding, captured time, state and Finish-set membership. No destructive fallback, duplicate identity store or photo-byte database blobs.
- Camera: one CameraX owner requests permission, binds lifecycle and captures to a pre-reserved app-private original. UI requests capture and renders durable results; it does not invent UUIDs after the write.
- Preparation: one serialized local owner creates/recreates deterministic derivatives after durable capture. Existing worker/session owner handles authorized network metadata/action work; no WorkManager solely for preparation without actual evidence.
- Synchronization: extend `ActionSyncCoordinator`, `SessionCoordinator`, current scheduler/API and DAO guards. Add only frozen metadata synchronization needed to validate Finish; no company Drive credentials, remote-byte upload or provider hierarchy in Phase 4.

Exact SQL function signatures/file splits are implementation choices within these boundaries and must be recorded before any DDL. Create migration drafts with the current CLI; reconcile deployed migration versions to their exact mirrored files. Read current official CameraX/Room/Supabase guidance at implementation time. Do not modify FPP to transfer proven camera behavior.

## Capture transaction and controls

Before each shutter:

1. verify local authenticated owner/org, exact downloaded WO/run/assignment instance, locally started/frozen revision, selected item membership and no known conflict;
2. generate permanent photo UUID and reserve a unique app-private protected-original path;
3. persist a `CAPTURING` record containing those bindings, item UUID or Extra, selected context and truthful capture time;
4. only then allow CameraX to write; prevent a second shutter while this capture transaction is unfinished.

A successful nonempty readable image becomes durable `WAITING`. An abnormal callback with nonempty bytes is preserved and reconciled; validate before counting, never discard it merely because the callback failed. Empty/missing unused reservations are safe to reconcile as failed/empty; no false counter increment. Another shot uses another UUID/path. Screen rotation/navigation/account changes cannot redirect the pending callback.

Preserve the planned dominant preview, large shutter, multi-shot session, system insets, Flash Auto/On/Off, separate Torch default Off, pinch/fine zoom, normal 1× rear framing and usable orientation. Additional lens shortcuts require proven capability. Wide-designated items use the widest reliable supported rear path; supported normal framing is the documented fallback where ultra-wide is unavailable. Do not claim visual composition quality or a dedicated ultra-wide lens from a UI label. Permission denial/camera unavailable shows a recoverable explanation and retains existing evidence; no photo counts change.

## Files, preparation, restart and storage failure

Original paths and WO/run/photo/user binding are permanent; template/address/reassignment/reopen never redirects them. Protected originals are immutable until the later delivery/cleanup phase proves eligibility. Prepared copies are separate, deterministic by photo UUID, recreatable and not independent captures.

After WAITING, prepare incrementally during field work using a serialized in-process queue: maximum 2048 px long edge, JPEG 85, no upscaling and usable orientation. Write a temporary derivative then publish a complete valid result; scheduling/codec/storage failure preserves original and WAITING, with a visible recoverable problem. Camera remains usable while earlier preparation proceeds. Startup requeues eligible missing/incomplete derivatives; do not wait until Finish to process a large job.

On restart: reconcile CAPTURING nonempty bytes without dropping them; remove only empty unused reservations; retain valid WAITING originals; flag missing/empty/unreadable originals; reconstruct item/Total counters and Finish membership from Room. Account A evidence is locked/invisible to B and still present on return. Work-list reconciliation treats every unconfirmed photo as protected evidence, even if no network action is pending; no eviction of photo-bearing rows.

Low storage never triggers deletion of unresolved photos to make room. An unreservable/unwritable capture fails visibly without being counted; derivative failure cannot delete the original. Define a controllable low-space fault seam for automation; do not fill the operator's real device with unsafe junk to test it. If real storage behavior contradicts automation, preserve evidence and target that boundary.

## Safe pre-Finish discard and Finish transaction

Explicit single-photo review/discard with confirmation is permitted only for eligible local, unfrozen, unsubmitted captures before Finish. Validate owner/run/state and selection first; no broad discard gallery or batch-delete feature. Use a durable discard intent/state so a crash between marking and deleting cannot resurrect counts or falsely claim deletion; resume that exact eligible operation on restart. Exclude it from counts once discard is committed, and keep failures truthful. Discard never touches Drive, other runs, in-flight capture or frozen evidence.

When requirements are met, one Room transaction freezes the eligible photo UUID set and counts against the snapshot revision and stores immutable COMPLETE intent. Persist a stable Finish-set identifier/digest so retries cannot substitute different photos. Race shutter/discard/Finish in one owner: Finish cannot include half-captured bytes or delete a newly frozen photo. After local Finish, block ordinary add/discard/relabel for the frozen set. The contractor can leave the screen; local field completion is pending server acceptance, not delivery.

No photo reclassification/reuse across items is included. Wrong-item captures can be explicitly discarded before Finish and retaken. Count/preparation problems appear with the owning item/photo; counters alone never hide a broken original.

## Metadata and completion synchronization in Phase 4

Do not mirror every in-progress shutter to Supabase. The local frozen Finish set is synchronized by the existing durable coordinator when authenticated connectivity permits:

1. accept/replay the exact START under existing identity/revision guards;
2. register the frozen photo metadata/set under the same phone photo UUIDs, WO/run/user/item/snapshot/Finish-set identities;
3. accept the exact COMPLETE only after server metadata validates all enabled item/Total requirements;
4. leave bytes protected locally as **delivery pending** for Phase 5.

Registration and Finish retries are idempotent; same UUID with a different payload is a conflict, never an overwrite. Metadata validates the current authorized owner/org/assignment/run, item membership, revision and frozen-set digest; server counts distinct valid registered photo IDs, not client-supplied counters. Metadata proves reported capture, **not delivered bytes or AI-verified composition**. Block direct-table/legacy API bypass of configured-run completion and metadata mutation after freeze. No byte delivery or cleanup is enabled here.

Network loss before/after metadata acknowledgement preserves the exact set for retry. Auth refresh failure remains retryable where appropriate; revocation/wrong owner/reassignment/cancellation/revision mismatch yields visible protected conflict rather than an endless submission loop. Session generations/claim guards prevent late network results from crossing accounts. A failed run must not corrupt another run's safe work. Backend metadata/COMPLETE support is Phase 4 work because server count validation is needed now; Phase 5 adds byte delivery after those facts are accepted, not another completion engine.

## Recovery before any installation

Documentation rollback is a narrow revert to the baseline; no external rollback is needed for this PR. Before runtime DDL, record exact migration/API changes, preservation hashes, narrow forward repair/disable steps and safe fixture disposal. Retain additive tables, snapshots, action ledger and photo metadata; no destructive schema/data rollback.

Before the Room-v3 candidate is offered, build and retain a higher-version recovery APK with the same FWH package/stable test signer and v3 reading/migrations. Recovery disables new capture and action/metadata scheduling/submission but preserves and exposes protected local evidence read-only. Verify it can open v1/v2/v3 safely with photos/actions intact. Baseline's v4 candidate/v5 recovery are **not** a safe downgrade after v3. Reserve a monotonic candidate/recovery pair above existing installed/staged codes (at least 6/7; verify actual device state), and record SHA, package, signer, version, Room version and file hashes for both.

Never uninstall, Clear data, downgrade to Room v2 or install an incompatible old recovery to resolve a failure. Keep the Phase 3 artifacts/evidence as history. Pause affected work through the verified recovery if needed; repair forward without deleting originals/conflict evidence. An unproven recovery blocks installation, not independent source/test work.

## Automated verification across the whole phase

Focused during development, then one complete final suite on the exact runtime head:

- template org/role/grant/RLS boundaries; direct bypass denied; snapshot copy/edit/archive isolation; malformed/unknown shape rejected; item IDs/counts/order/instructions and every on/off combination;
- one-item-only plus unique Total/Extra math, including S<T, S=T, S>T and all-off; same visual content never earns automatic second-item credit;
- optional suggested order: capture later items first, switch away from unfinished items and revisit items without sequence locks, changed minima or lost progress; Finish validates counts, not walking order;
- Admin edit/Start serialization, cached revision race and new-vs-legacy action compatibility; configured runs cannot use old APIs to bypass requirements;
- real Room v1→v2→v3 and v2→v3 migrations preserving pending/accepted/conflict actions, owners/times/receipts and cached snapshots; new photo/recovery round trips;
- CAPTURING precedes write, unique UUID/path each shutter, stale lifecycle/account callback cannot rebind, successful/abnormal/empty callback handling and no false counts;
- original hash unchanged by preparation; dimensions/no-upscale/JPEG/orientation, serialized work, partial-file recovery and injected low-space/codec failure;
- confirmed discard intent/restart, correct counter decrement, Finish/capture/discard race, frozen-set immutability and unmet Finish explanation;
- exact metadata/Finish-set identity, replay/payload collision, transport/restart resume, no replacement server UUID, current revision/assignment authorization and server distinct-count checks;
- cache/account isolation, photo-bearing eviction guard, sign-out/revocation/reassignment/A→B→A preservation and existing Phase 3 queue/background regressions;
- dashboard create/edit/reassign/session/auto-refresh regressions, no secrets/PII in clients/public artifacts, complete Android/Admin/database/governance CI.

Use controlled rolled-back SQL fixtures and disposable multi-connection races where locking matters; verify deployed migration ordering/source/grants/RLS/advisors and unchanged unrelated business data before claiming the backend ready. No live customer photos/accounts as fixtures. Mocks prove logic only, not CameraX/device/provider reality.

## One combined Admin laptop / Android physical gate

Stage only after focused and complete exact-head automation, hosted authorization/parity/advisors and both artifact identities/recovery pass. Record candidate SHA/hash/signer/version, roadmap/implementation record, rollback and exact PASS/BLOCKED/FAIL criteria. The gate proves real Admin-to-cached snapshot flow and actual CameraX/offline/restart behavior; no Drive gate belongs to this phase. Use the exact tested dashboard served on laptop loopback as recorded in the implementation record. GitHub Pages publishes from protected main after approved integration; the pre-merge gate does not require changing that protection or adding preview infrastructure. Actual local Admin login remains required evidence.

1. On the laptop, create a disposable named-item WO from a reusable template; customize counts/on-off/instructions/order. Verify the preview math and a second all-off or Total-only run without changing the template's other snapshots.
2. On Android, refresh/download both; confirm requirements match before Start. Turn Airplane mode on **and Wi-Fi off**, then Start the named run offline.
3. Tap one item; take several shots without reselection. Exercise supported flash/torch/zoom/Wide/orientation and a second item. Choose an item out of the suggested order and return to an unfinished item. Verify unrestricted selection, preserved progress, distinct-item credit, Total, instructions and Extra photos.
4. Safely discard one eligible bad test photo; verify counts. Attempt Finish while one item remains unmet and confirm the exact explanation.
5. Force stop/reopen while still offline; verify original files, prepared copies, item bindings and counts. Take enough photos to satisfy requirements, Finish offline and restart again; verify frozen evidence/COMPLETE membership and no ordinary discard/add.
6. Sign Out/switch to the existing second account; verify old photos are inaccessible. Return to original account; verify preserved evidence. On the simple second run, confirm no unnecessary item/stage selection; Finish follows only enabled requirements.
7. Restore connectivity after normal reopening. Verify original UUIDs/revision/set reach server once, server accepts counts/Finish, and refresh/retry does not duplicate. Bytes remain delivery pending; never report uploaded/fully Complete.
8. Use a fresh small disposable photo-bearing run for one controlled pre-Start Admin-edit vs offline-Start race or authorized reassignment race. Verify Needs review with original snapshot/photo/action evidence intact and no acceptance/rebinding. Reuse existing accounts, not new onboarding.

Keep evidence on a safe synthetic subject with no customer/contractor PII. Group easy operator steps while using exact visible labels. Do not rerun Phase 3's entire accepted gate. Actual CameraX control support and original/derivative survival cannot be inferred from CI. Permission-denied, invalid configuration and low-storage failures are automated unless an observed device contradiction needs a targeted real check. Recovery installation is available if needed; do not upgrade the operator into recovery solely for reassurance.

PASS: configured and simple/all-off behavior works, repeated capture remains quick offline, counts/discard/Finish are correct, files/identity/freeze survive restart/account changes, server registration/Finish is authorized/idempotent and one conflict preserves evidence. BLOCKED: missing device/backend capability, unverified artifact/recovery or external prerequisite; preserve candidate and name the missing condition. FAIL: loss/misattribution, double credit, bypass, broken controls, false status or wrong-run acceptance; stop the affected path, repair and retest the affected evidence before completion.

## Completion and durable handoff

Phase 4 completes only when the whole approved behavior, focused/final exact-head automation, deployed migration/grant/advisor parity, verified recovery, combined physical gate, explicit Level 3 merge approval and runtime integration agree. Keep photos **WAITING / delivery pending** for Phase 5; no claim of remote delivery/cleanup. Phase 5 consumes the same UUID/item/revision/frozen-set facts and adds company-authorized bytes/destination/retry, preserving this counting rule. Future Phase 6 derives Total/item counts from server-known facts, never phone-only guesses.

Current status: **backend and Admin/database automation PASS; local Admin login/template/custom/all-off creation and copy isolation PASS; the latest phone screenshot confirms the v12 camera UI was unchanged, and source inspection confirms v12 did not contain the promised selector/instruction correction; corrected v14/v15 CI and artifact verification, phone retest, remaining combined phone gate, explicit Level 3 merge approval, runtime integration and main publication PENDING**. Do not treat v12/v13 as the camera correction. New source uses a full-width top item picker and removes instruction rendering from the camera view. Candidate v14 and read-only recovery v15 retain the stable package/signer and Room v3. Next checkpoint: finish exact-head CI and artifact identity verification, then update the installed app to v14 without clearing data; verify the full-width picker in portrait/landscape, no item instruction over the preview, and Flash/Torch behavior. Preserve app data; do not install recovery unless a blocker requires it. No new letter-level plan approval; stop only for material new decisions, failed evidence, the genuine device boundary or separate explicit Level 3 pre-merge approval.

## Operator clarification — optional walking order — 2026-10-03 15:15 America/Chicago

At **2026-10-03 15:15:52 America/Chicago**, the operator specified that walking order must be optional for the inspector. Admin's saved order remains a suggested display order; the inspector can choose any eligible item or Extra, switch between unfinished items and revisit completed items. Required counts and one-item photo binding remain enforced; walking sequence never blocks capture or Finish. This narrows the agreed ordering aid without adding a route engine, extra setting or new requirement.

PR #33 integrated the whole-phase plan at main **f82d4d6a84d1300a9d763b88dfe2b457a9f9e55c**. This documentation-only clarification uses branch `docs/phase-4-flexible-photo-order`, scope key `phase-4-optional-photo-order`, with that main as rollback. Preflight found no open PR or Phase 4 runtime line. Changed surfaces are this plan and the roadmap; external systems changed: none. Rule packs and protected boundaries above still apply. Verification is affected-document/diff review and required repository checks; this follow-up PR owns its verified integration result. Runtime/backend/APK/device gates remain pending under the same whole-phase approval.
