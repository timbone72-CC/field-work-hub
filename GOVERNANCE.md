# Field Work Hub — Project Governance

## Purpose and authority

This is the universal work-control layer for the separate Field Work Hub (FWH) project. It adapts proven FPP governance without adopting FPP's single-user architecture or modifying FPP. Feature details remain in FWH's existing contracts and approved roadmap. Use the largest coherent change that can be understood, safely reversed, and verified.

## Operating cycle

1. **Discover:** read governed main, relevant open PRs/branches, the active implementation record, and affected live-system state before taking over work.
2. **Classify:** record goal, scope key, affected surfaces, Level 1/2/3, authoritative branch, rule packs, protected behavior, external systems, rollback, and verification.
3. **Continue:** use the existing authoritative line if it already owns the scope. Do not silently restart overlapping work from main.
4. **Implement in the owner:** prefer the largest safe coherent batch; no duplicate authorization, offline, photo, queue, or remote-write path merely to avoid an existing design.
5. **Verify proportionally:** focused evidence during implementation; one final complete suite on the exact runtime head when required; smallest genuine device/provider gate.
6. **Reconcile external state:** source, approved migrations/configuration, real deployed state, and recorded physical evidence must agree.
7. **Handoff:** maintain a durable resume point with exact next checkpoint and unresolved gates.
8. **Close:** evidence, external state, cleanup decisions, roadmap, approval, and merge/deployment state must tell the same story.

## Operator interaction and autonomous execution

The **one-step rule applies only to instructions for the human operator**: give one actionable instruction at a time and await its result. It does not limit the agent to one tool call, commit, fix, check, or development action per response. Within approved scope, complete the largest safe coherent batch without repeatedly requesting “Next” or treating a chat reply as an approval gate. Stop only for genuine blockers, missing required decisions/approvals, changed scope, or necessary human/device/provider evidence. Preserve explicit Level-3 pre-merge approval and independently required activation/remote-write authorization. Report the actual completed work and remaining gate.

## Completion-first construction direction

**One primary subphase, one selected construction task.** The existing [ROADMAP construction register](docs/ROADMAP.md#completion-first-v1-construction-register--current-execution-direction-november-11-2026) identifies the active unfinished task and exact business Definition of Done. Work should close its implementation and applicable acceptance before starting the next feature. Do not interpret a merged PR, green CI, or a written status change as functional completion. When only a genuine external/device/provider boundary blocks that task, preserve accepted evidence, continue the next eligible build task **within the same subphase**, and return when the block clears. Work in a different subphase only if no safe task in the primary subphase can advance; record the blocker and return condition in the existing handoff. Existing incident/safety, scope approval and Level-3 merge protections remain unchanged. The existing governance check verifies a PR's task identity against the current trusted roadmap; it cannot verify provider or device truth. No new approval or retest stage is created.

## One authoritative implementation line

Only one branch/PR may be authoritative for materially overlapping scope. Before creating a new line, inspect all open PRs, relevant branches and the last durable build-state record.

If replacing a line, explicitly record the reason, what tested or untested work carries forward, the replacement branch/PR, and the old line's disposition. Do not close a branch solely to make GitHub's duplicate-scope check pass. Independent changes may proceed concurrently only when their ownership and touched surfaces do not conflict.

## Source of truth and external-state parity

- Completed code, contracts and approved roadmap: governed FWH main.
- In-progress changes: main **plus** the single authoritative PR/branch, its impact/build-state record and any legitimate live state already changed for that scope.
- Supabase schema, migrations, RLS, grants, Auth callbacks and Edge Functions: reconcile deployed Team state against the exact authoritative line; never infer from main alone while a Level-3 change is pending.
- Team Android packages/signers, hosting and CI configuration: record environment, revision and rollback when modified.
- Company-controlled HNP Drive objects/photos are operational data, not Git-controlled configuration; verify provider truth at the appropriate roadmap gate without manufacturing live work.
- If a persistent external configuration cannot be stored in source, record its non-secret value/class, purpose, environment, verification and rollback in the active record.

Material contradictions stop the affected implementation until reconciled. Never create a substitute backend or rename a technical identity because current main lacks an in-progress change.

## Protected scope and project separation

FWH is the multi-user, offline-capable work-order system; FPP is the separate working single-user photo product. FPP may be read as a proven reference only. FWH work must not mutate FPP's repository, app, package, authentication, storage, permissions, production files or field data.

Preserve FWH's server-controlled organization/role/assignment authority, protected offline evidence, immutable work-order/run/photo identities, fail-closed uncertain remote outcomes and exact server-mediated delivery. No governance/branding task silently changes them.

## FWH Failure Containment and Recovery Standard

**Permanent, cross-phase rule — operator approved 2026-11-01:** A failure in one operation, work order, delivery package, contractor account, device or external integration must **not unnecessarily interrupt independently safe operations**. Preserve durable work and evidence, prevent duplicate or conflicting actions, show truthful affected status and a concrete recovery path, and restore progress without silently reassigning authority or data. When continuing risks integrity, security, authorization or uncertain remote writes, stop **the smallest provably isolatable failure domain**, not the whole system by default.

Every new or changed runtime boundary must identify (1) the failure domain and any truly shared dependency; (2) which unrelated actions can safely continue; (3) durable state and evidence retained before failure; (4) known-safe retry versus identity-bound reconciliation or human intervention; (5) user/Admin-visible problem and next action; and (6) recovery, rollback and narrowly scoped verification. A shared service outage can genuinely affect multiple operations: never invent independent availability, bypass revoked access, replace a remote identity, or claim success to keep the interface moving.

**Enforcement:** `INTEGRATION_CONTRACT.md` specifies cross-system failure behavior; `TESTING_CONTRACT.md` requires proportionate failure and recovery evidence; `docs/ROADMAP.md` incorporates the standard into existing Phase 5–8 release criteria. The authoritative scope record tracks actual PASS/PENDING/BLOCKED evidence. This is **not a new phase**, automatic approval, separate testing campaign, or permission to repeat accepted physical tests. A required failure blocks that affected gate and applicable merge/release, but unrelated approved development may continue safely.

## Classification, approvals and batching

The existing CHANGE_CONTROL_CONTRACT.md defines Level 1/2/3 and approvals. If uncertain, classify upward; scope expansion requires reassessment. Level 3 always requires **explicit operator pre-merge approval**. Design approval and a PR field marked APPROVED are not independent proof of that operator decision.

The **numbered parent phase** is the design-approval unit. Its plan must cover every lettered section before implementation begins. A single recorded parent-phase approval authorizes the included implementation across all change levels within unchanged scope; Level 3 still requires separate explicit approval before each runtime merge. Lettered sections organize implementation and evidence, not repeated design approvals.

Do not repeatedly request permission for unchanged approved work because a lettered section, branch/PR, work session or device gate ends. Build through the largest safe verifiable batch and stop only at real decisions, contradicted physical/provider evidence, required failures, unapproved scope or the Level-3 merge gate.

Record the parent-phase plan/revision, approval evidence and planned dependency/evidence boundaries in the active record. Detailed impact records and implementation notes may refine already-approved behavior without becoming new approval gates. A partial-section approval authorizes only its recorded scope; do not infer approval of unspecified remaining sections. When an existing phase has material gaps, preserve approved decisions and passing evidence, finish the missing remainder as one consolidated amendment, and request approval only for material decisions not already authorized. Do not retroactively invalidate completed work or repeat accepted tests merely to comply with the clarified planning format.

## Durable handoff and closeout

For each active Level 2/3 scope, keep one authoritative impact/build-state record with baseline and rollback SHA, branch/PR and current head, implemented scope, external state touched, passed and incomplete evidence, blocked risks, next exact gate, and operator approval/merge status.

A scope is not complete until implementation, required automated and real evidence, live configuration parity, consciously retained or cleaned disposable fixtures, roadmap/current status and merge state agree. Do not relabel pending work as complete because the code compiled.

## GitHub's limited enforcement

GitHub can check mandatory PR metadata, exact branch name, duplicate declared scope keys, obvious sensitive-path minimum levels, and CI status. With repository-admin protection, it can also require PRs/checks, block force pushes/deletions and require resolved discussions. It cannot establish correct rule-pack selection, verify physical evidence or authenticate an operator approval where automation shares an identity. These remain human/contract responsibilities. A workflow file is not branch protection: verify admin-side settings before claiming hard enforcement.

## Precedence

When documents materially disagree, stop the affected path and reconcile:
1. GOVERNANCE.md for universal work-control procedure;
2. PROJECT_PROFILE.md for FWH architecture and project boundary;
3. CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md and INTEGRATION_CONTRACT.md for their respective detailed rules;
4. approved docs/ROADMAP.md plus scope-specific design/impact record for permitted behavior and phase boundaries;
5. current scope build-state/handoff for observed status, never for overriding contracts.

AGENTS.md is the short entry point and RULE_INDEX.md selects the relevant packs. Lower layers may add detail, not silently override higher authority.
