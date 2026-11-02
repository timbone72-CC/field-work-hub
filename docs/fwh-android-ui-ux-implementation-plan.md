# Field Work Hub — Android UI/UX implementation plan

Plan ID: `fwh-android-ui-ux-implementation-plan`
Revision: **0.2 — approved scope and repository handoff, 2026-10-16**
Classification: **Level 1 documentation only**; Package A runtime at least Level 2, Package B provisionally Level 3.
Operator approval: **“Approved.” — 2026-10-16**, in the FWH UI/UX Design conversation, following review of the Android implementation plan v0.1.
Status (reconciled 2026-10-28): **Approved; Package A runtime has substantially progressed on draft PR #40, with narrowly accepted Samsung v36 navigation evidence, but complete Package A / combined Phase 5/6 release gates are not declared PASS.** Package B's separate identity/persistence/security implementation design remains unapproved. Planning approval and a single phone observation are not Level 3 PR #40 pre-merge approval or provider verification.

## Purpose and accepted interaction

Redesign only the separately installed FWH contractor Android client in the approved modern two-tone / field-first visual style. Screens are organized by task, **not by arbitrarily hiding controls**: Home has top-level destinations; Work Orders has search/refresh/assigned jobs; an opened work order shows that job's facts and appropriate work-order actions; Photos and Camera show their own relevant controls. One obvious *primary* next action may be emphasized, without removing appropriate alternate actions or requiring a prescribed photo-taking order.

The accepted code-rendered HTML prototype is visual evidence, **not production Android source** and not proof of a working Android control. Keep the current Java Android views/CameraX architecture unless separately approved.

Contractors receive authorized WOs from the Admin dashboard. **No contractor Create Work Order button** is in this package. A future dashboard-controlled contractor permission to create WOs needs separate scope and server authority.

## Current baseline and collision gate

- Repository: `timbone72-CC/field-work-hub`; original `field-photo-prep` is reference-only and must remain untouched.
- Completed work lives on `main`. **Draft PR #40** (`feat/phase-5-6-dashboard-workflow`) is the authoritative ongoing Phase 5/6 runtime line. At planning inspection its head was `7e6342d2e330a95e9c7d96e3a5ba8230466be5da`; **reinspect**, never assume it remains current.
- PR #40 modifies `MainActivity.java`, local Room state, assignment/Accept actions, photo recovery, updater and handoff controls. A new runtime line must **not** implement an overlapping `MainActivity` against stale `main`. Coordinate with the sole ongoing owner if the runtime scope is expressly reconciled in that line, **or** wait until PR #40 is integrated and create one isolated UI runtime PR against the verified integrated head. Do not rush/merge PR #40 merely to unblock appearance work.
- Historical planning prerequisite: link Package A to the appropriate approved parent phase and reconcile the overlapping Android owner. This was subsequently linked in `docs/ROADMAP.md`; existing draft PR #40 remains the sole Android implementation owner, with no competing branch, while this document records approved design/limits only. Do not treat this status correction as any new runtime or release authority.
- Source of truth for related behavior: `AGENTS.md`, `GOVERNANCE.md`, `PROJECT_PROFILE.md`, `RULE_INDEX.md`, `CHANGE_CONTROL_CONTRACT.md`, `TESTING_CONTRACT.md`, `INTEGRATION_CONTRACT.md`, `docs/PHASE_STAGING_DOCTRINE.md`, relevant roadmap/Phase 5–6 plans, and the exact integrated implementation record.

## Package A — approved, bounded presentation/navigation redesign

**No new business actions, permissions, field states, photo identities, delivery workers, cleanup rules, schemas, or remote destinations.** Keep existing action owners, handlers and data selectors.

| Screen | Proposed presentation | Existing authority/function that must remain |
|---|---|---|
| Sign In | Professional two-tone sign-in, concise errors | `MainActivity.buildContent`, `beginSignIn`, session isolation |
| Home | Clear Work Orders, Recover My Photos (if available), Account/Updates navigation | Sign Out, `PhotoRecoveryActivity`, `InternalAppUpdater`, update/install guards |
| Work Orders | Fixed header/search/refresh; independently scrolling authorized current jobs; completed/history still reachable | `renderWorkOrders`, cached assignment/refresh, server RLS and Room owner filtering |
| Selected Work Order | Address and identity, work type, WO, due, requirements, concise instructions, correct status; one emphasized next action | Existing `queueFieldAction` (ACK/START/COMPLETE), conflict/reassignment/team handoff paths |
| Photos / requirements | Relevant items and truthful captured/minimum counts, Extra photos, review/discard, Done/Back | `PhotoActivity.renderItems`; frozen snapshot, one-photo/one-item and unique Total semantics |
| Camera | Preserve existing portrait/landscape layout pending separately approved visual changes | CameraX single owner, wide/zoom, flash, torch, shutter, item picker, protected originals |
| Recovery / Updates | Appropriate contextual destination(s), easy return | Evidence export limits, update verification, permissions, recoverability |

**No dead placeholder thumbnail control:** Package A leaves out any clickable "choose photo" or fake persisted thumbnail until Package B exists. Reserve layout space only if it improves composition without pretending functionality is present. This resolves the pending staging choice conservatively; it does not drop the approved property-photo feature.

**Job selection must use the exact existing owner-scoped WO UUID/run UUID/assignment instance**, never a displayed address, list index or search result position. Returning from photo capture must not switch job/run when search, refresh or navigation changes.

Search is only over the current contractor-authorized local list, case-insensitively by address and WO number; it adds no new access or server query. Handle 0, 1 and many jobs; duplicate address rows; current vs completed; scroll restoration; empty state; keyboard, rotation, landscape, large fonts and TalkBack. Fixed controls may not cover content.

### Context and action truth

- `ASSIGNED`: Start Work is available under existing authorization. New **Accept** (where implemented) is an optional, separate acknowledgment; it is **not** a Start prerequisite.
- `ACK` saved locally: show *Accepted — pending sync*, distinct from confirmed office acknowledgment.
- `IN_PROGRESS` / local START queued: Photos/Continue Photos is prominent; existing Finish remains appropriately reachable. Enabled items can be captured in **any order**, with Extra always available.
- Requirements met: Finish Field Work remains the existing guarded action; unmet counts produce the exact existing dialog with **Open Photos**, not a bypass.
- Pending local COMPLETE / accepted FIELD_COMPLETE: distinguish local saved, server accepted, private photo receipt, package approval and actual client delivery. No fake success or cleanup.
- Pending contractor reassignment and office-team move: show both matching **Approve** and **Decline** options, retain offline/pending restrictions, preserve current work and photos.
- Known conflict/account or permission change: retain visible blocker, recovery route and evidence; never silently clear or reassign action/photo state.

A visually primary button is **not** authorization. UI only renders owner-held state and invokes existing validated actions.

## Package B — approved user experience, protected runtime design pending

Each authenticated contractor may choose an optional *property profile photo* when they open an authorized property. It is **personal to that contractor**; a different contractor's choice is independent. The selected photo is reused across that contractor's authorized current/future work orders at the **same verified property**, regardless of job type or run, and is shown at the top of the opened job (not on every Work Orders list row). The contractor may replace/remove their selection. Routine job-photo download/delivery/eligible cleanup must not remove the profile copy or modify any job-photo evidence.

The property photo is a separate, small derivative, not an original/frozen capture reassignment, capture-count credit, delivery package item or client-access permission.

Before Package B runtime implementation, a separately approved Level 3-capable design must resolve:

1. **Stable organization/company/property identity.** Existing address text is mutable and WO UUID is job identity, not property identity. Exact same-property grouping must be explicit and safe across corrections; ambiguous same addresses or different client companies must not auto-merge.
2. **Personal ownership and access.** Derivative keyed to authenticated user + verified property, scoped to actual approved access; one contractor never sees another's selection by default. Sign-out, account switch, revoked/changed access and recovery must remain safe.
3. **Persistence and lifecycle.** Explicit choose/change/remove; offline same-device restart, job completion and eligible job-photo cleanup; no hidden bulk deletion, accidental evidence cleanup or silently retained cross-organization access.
4. **Backup promise.** Local-only retention does **not** mean recovery after uninstall/new phone. If account-linked restoration is desired, design and approve narrow server storage/access and privacy rules first; do not use client Drive delivery folders or unrestricted private photo review storage.
5. **Additive migration, rollback, device/security gates** if Room/Supabase identity, retention, cleanup or access boundaries change. No production delivery/authorization mutation as a side effect.

## Package A verification and stop conditions

- Verify sign-in/sign-out, role and account separation, offline cached work and restart.
- Search 0/1/many, duplicate address and company rows; filter active/completed correctly, with no false deletion; rotate/font-scale/keyboard/scroll.
- Select WO A vs B and navigate camera/back while preserving exact WO/run; refresh and pending sync do not rebind photos.
- Preserve distinct ACK, START and COMPLETE, offline queue/replay, pending vs confirmed displays, clear Finish-blocked dialog/Open Photos.
- Preserve requirement item and Total counts, any-order capture, Extra photos, pre-Finish photo review/discard and freeze behavior.
- Preserve existing CameraX controls, orientation, permission recovery, photo reservation/original protection, multishot/Done.
- Preserve reassignment/office-team Approve/Decline, conflicts, recovery export, Update App and Sign Out.
- Focused tests during development; **one** complete final Android/related contract suite at the exact runtime head; smallest affected genuine device smoke test. Do not repeat already-accepted unrelated provider/photo evidence solely for visual reassurance.
- Compare each original control/handler against the new navigation and prove reachability. **Missing controls fail review.**
- Any necessary unrelated modification triggers the existing **FULL STOP** clause and separate operator approval. No implementation of Package B by accident.

## Next implementation gate / handoff

**Complete:** operator approved the visual and Package A/Package B separation; this documentation record commits it to source control independently of PR #40. No Android application code, APK, Room schema, deployed environment, runtime permissions, user data or FPP changed.

**Current handoff (2026-10-28):** The ownership/parent-roadmap linkage is complete: Package A presentation/navigation work proceeds only on the existing authoritative PR #40. Installed Samsung v36 was accepted for fixed-safe-clearance Recovery Back and temporary system-navigation swipe/reveal; movement-triggered bottom-button shifting was explicitly removed. Preserve that precise physical acceptance, use the single Phase 5/6 implementation record for exact CI/rollback and remaining reachability/keyboard/rotation/accessibility gates, and do not restart the earlier UI implementation line. Package B remains a proposed Level-3-capable storage/identity design, not approved runtime or a prerequisite to complete the already approved Phase 5/6 workflow. This is documentation-only; no Android/Room/Drive/FPP change or Level-3 PR merge approval.
