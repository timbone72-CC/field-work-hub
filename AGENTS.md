# Field Work Hub — Agent Entry Point

Field Work Hub (FWH) is the separate multi-user contractor dispatch, offline fieldwork and protected-photo-delivery project. Its canonical repository is `timbone72-CC/field-work-hub`; `field-photo-prep-team` is the historical slug. The working original single-user Field Photo Prep (FPP) is **read-only reference material**, never an FWH modification or experiment surface.

## First read — every FWH work session

1. Read this AGENTS.md in full.
2. Read GOVERNANCE.md for one authoritative implementation line, preflight, external parity, durable handoff and closeout.
3. Read PROJECT_PROFILE.md to establish the real FWH systems, source of truth, customer/privacy protections and **hard FPP separation**.
4. Use RULE_INDEX.md to load only the additional detailed contracts relevant to the touched surfaces. Read any mandatory rereads required by those existing contracts. Never substitute a chat summary or previous-session notes for these reads.

Before starting/resuming runtime or phase work, inspect current main, open relevant PRs/branches, the active impact/build-state record and the approved relevant phase of docs/ROADMAP.md. No unapproved phase implementation; if the plan lacks behavior, failure handling, protected boundaries, verification and a completion gate, **stop and finish the plan**.

**Whole-phase approval unit:** a phase means the numbered parent (for example, Phase 3), including every lettered section (3A, 3B, 3C). Before its runtime work starts, plan the entire parent phase, its failure behavior, dependencies, verification and genuine device/provider gates. One recorded plan approval authorizes implementation of all included sections within unchanged scope. A letter, branch, PR, session boundary or completed phone test does not create another design-approval gate. If material planning gaps are found during an existing phase, preserve accepted work/evidence and complete the missing remainder together; do not restart planning one letter at a time. CHANGE_CONTROL_CONTRACT.md and docs/PHASE_STAGING_DOCTRINE.md define amendments and evidence gates.

Before runtime changes, also read CHANGE_CONTROL_CONTRACT.md and TESTING_CONTRACT.md. Read INTEGRATION_CONTRACT.md for Supabase/Auth/RLS, Room/offline work, reassignment, photos, background sync, provider storage, uploads, cleanup or another integration boundary. Read docs/PHASE_STAGING_DOCTRINE.md and the current/next phase for phase transitions or genuine physical/provider gates. Documentation-only work must read the affected document and applicable governance/change rules.

## Required work classification

Record goal, scope key, affected surfaces, Level 1/2/3, authoritative line, relevant packs, protected behavior, external systems, rollback and exact verification boundary. Reclassify if scope expands. Never start a competing overlapping implementation line; continue or explicitly supersede the existing line.

Keep one owner for server authority, Android local evidence, field workflow, camera, remote identity, retry and cleanup. Preserve protected originals and offline evidence, immutable photo/work-order/run and remote destination binding, least-privilege contractor access, and fail-closed uncertain remote outcomes. Do not copy FPP's local SAF folder workflow into Team's server-mediated company Drive architecture.

Do not change the original FPP repository, Android app/package, Supabase, Drive folders, production data or permissions as part of FWH work. Never commit service secrets, contractor/customer PII, field photos, production signing material or auth refresh tokens to this public repository.

## Current FWH TEST-only evidence classification — operator confirmation 2026-10-27

The operator has confirmed that the **current Field Work Hub installation is not public, has no customer work, and its current FWH files/photos are disposable TEST data**. This describes the present FWH TEST environment, not the separate original Field Photo Prep app and not a permanent promise about future real work.

For an explicitly isolated, identity-verified disposable FWH TEST fixture, loss or deliberately approved cleanup of the *fake photo bytes* is an acceptable test outcome. This does **not** automatically make every database record, Google ID, encrypted session, dispatch permit, or one-shot attempt marker safe to reset: while an uncertain remote outcome is being investigated, preserve the identity/journal evidence needed to classify it truthfully. Ordinary TEST cleanup may follow an exact-scoped recorded procedure instead of treating every disposable image as irreplaceable customer evidence.

Do not silently infer that FPP or later live FWH data are disposable; reclassify protection before production or customer intake. Current explicit platform deployment safety restrictions cannot be bypassed by relabeling work as TEST. Retain the single governed PR/branch and required Level-3 gates.

## Verification and stop

Build the largest safe coherent batch inside approved scope; use focused verification during development, one final complete suite on the exact runtime head when required, and the smallest real-device/provider check that software cannot prove. A failed test, unverified authorization, external-state contradiction, unproven photo destination, unresolved ambiguity or unapproved expansion stops the affected path. Passing physical observations need not be repeated for reassurance.

**Level 3 requires explicit operator approval before merge.** A PR label, automation status or earlier design approval is not proof of that decision. Keep a durable handoff record for active Level 2/3 scopes; report real pass/block/fail status and the exact next gate.
