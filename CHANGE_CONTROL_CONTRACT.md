# Field Photo Prep Team Change Control Contract

## Purpose

Control how Team changes are planned, implemented, tested, reviewed, merged, and rolled back. The process must match the real risk: strong enough to protect authorization, offline work, and field photos without turning every small improvement into a large project.

## Mandatory reread before runtime work

Before using this contract to authorize or classify a runtime change:

1. read `AGENTS.md` completely;
2. read the relevant phase in `docs/ROADMAP.md` completely;
3. read `TESTING_CONTRACT.md`;
4. read `INTEGRATION_CONTRACT.md` when the work touches Supabase/Auth/RLS, local persistence, offline behavior, reassignment, camera/photos, background sync, remote storage, upload, retry, or cleanup;
5. read `docs/PHASE_STAGING_DOCTRINE.md` for phase transitions, device-gate staging, or decisions about how far implementation may proceed before phone evidence.

Do not substitute memory, a chat summary, earlier-session notes, or an earlier read for these rereads.

If the relevant roadmap phase does not contain an approved implementation plan, **STOP. Planning is the work.**

## Core rule

No runtime phase begins until `docs/ROADMAP.md`, directly or through linked governing plan documents, contains an approved implementation plan for the **whole numbered parent phase**, including all lettered sections. For example, approval of a complete Phase 3 plan covers 3A, 3B and 3C; those letters are implementation sections, not independent design-approval units. The complete plan must define behavior, authority/protection, failure/recovery, dependencies, verification, actual device/provider boundaries and completion criteria across the entire phase.

One recorded parent-phase plan approval authorizes its included implementation within unchanged scope. Routine implementation choices, impact-record updates, focused bug fixes and progression through lettered sections do not require another plan approval. Additional plan approval is required for a material change to approved scope, product behavior, authority/protection, or evidence that requires changing approved design. A required test failure stops the affected path until fixed and verified; it does not automatically reopen plan approval. Level 3 pre-merge approval remains a separate requirement.

If material planning gaps are discovered after a phase has started, preserve approved decisions and accepted evidence, complete the missing remainder together, and record a consolidated amendment. Request approval only for material decisions not already authorized. Do not ask for a succession of letter-by-letter plans or rerun passed gates merely because planning documentation was corrected. An incomplete outline or a single-section approval must not be relabeled as complete parent-phase approval.

No intentional feature work is performed directly on `main`.

## Change levels

### Level 1 — low risk

Typical examples:
- documentation/comments;
- test wording that does not redefine behavior;
- noninteractive copy;
- appearance-only changes with no effect on authorization, persisted state, capture, upload, deletion, or deployment.

Required process:
- isolated branch;
- state changed surface and protected behavior;
- inspect diff;
- run only checks appropriate to that surface.

### Level 2 — normal feature or fix

Typical examples:
- ordinary dashboard/Android screens and controls;
- non-destructive status presentation;
- normal workflow additions that do not alter persisted schemas, authorization, assignment ownership, photo identity, retry identity, or destructive behavior.

Required process:
- isolated branch and PR;
- record exact user-facing problem/behavior;
- identify owning files/functions and read/write surfaces;
- identify protected behavior and rollback point;
- run focused tests during development;
- run the complete automated suite once on the exact final runtime head;
- run only affected smoke/device checks.

The user's approved request authorizes the documented Level 1/2 scope. Do not ask again unless scope changes.

### Level 3 — high risk

Typical examples:
- Supabase DDL/migrations;
- RLS/Auth/role/organization authorization changes;
- Room/local persisted schema changes or migrations;
- offline write queue/conflict/reassignment/cancellation semantics;
- photo identity/protected-original/prepared-copy changes;
- background sync/retry authority;
- remote upload/destination/reconciliation/cleanup;
- destructive actions;
- signing, production deployment, or test/production boundary changes.

Required process:
- dedicated branch and PR;
- roadmap-approved behavior plus a detailed implementation/impact record when the roadmap is not specific enough for the exact change;
- exact rollback steps before implementation;
- realistic safe fixtures/test environment;
- focused tests and final complete automated verification;
- affected data-preservation/security/device/provider checks;
- Supabase advisors after DDL;
- explicit operator approval before merge.

When uncertain between levels, use the higher level.

## Scope and ownership

Change only what is approved, using the smallest responsible module and necessary supporting code. Preserve all unrelated and previously accepted functionality. If an unrelated functional change becomes necessary, **FULL STOP** the affected work. Explain the reason and obtain explicit operator approval before proceeding.

Protected ownership boundaries:
- Supabase/Auth/RLS: server identity and authorization;
- local persistence: durable offline device state;
- sync/reconciliation: pending actions and server convergence;
- camera: capture/lifecycle;
- photo storage/preparation: protected originals and derivatives;
- remote storage: exact remote destination/identity/outcome;
- UI: requests actions and renders state.

A helper or UI component may not silently take ownership from another boundary.

## Team/V1 separation

Team changes may inspect FPP as a reference but may not modify the V1 repository, V1 app identity, V1 storage, or V1 field data.

## Diff control

Before merge:
- inspect every changed file;
- explain every changed block for Level 2/3 work;
- remove unrelated changes;
- verify no secrets/customer data entered the public repository;
- verify the final diff still matches the approved roadmap behavior.

## Supabase/database rules

For database changes:
- DDL goes through migrations;
- every applied migration is mirrored under `supabase/migrations/`;
- migration order/live history and repository history must agree;
- RLS/grants/RPC execution permissions are explicitly tested;
- advisors are run after DDL;
- client code never receives service-role/secret credentials.

## Offline/conflict rules

Any change that can create local/server divergence must document:
- which fact is authoritative locally and remotely;
- what happens offline;
- restart recovery;
- retry/idempotency behavior;
- reassignment/cancellation races;
- conflict resolution or fail-closed behavior;
- what user-visible state appears while unresolved.

Do not resolve conflicts by silently dropping started work.

## Photo/upload rules

Any change touching photos or upload must document:
- permanent local photo identity;
- immutable WO binding;
- protected-original behavior;
- prepared derivative behavior;
- queue state transitions;
- remote identity/destination;
- uncertain outcome handling;
- duplicate prevention;
- cleanup eligibility;
- restart recovery.

A failed/ambiguous upload must never be reported as confirmed success.

## Verification matrix

Documentation-only:
- mandatory-read/diff review only.

Level 1 runtime:
- focused check if applicable;
- affected-surface smoke check.

Level 2:
- focused regression coverage;
- one final complete automated suite;
- affected workflow/device smoke check only.

Level 3:
- focused + complete regression coverage;
- safe fixtures/provider validation where applicable;
- authorization/data-preservation checks;
- affected real-device gate where software cannot prove reality;
- explicit pre-merge operator approval.

A required failure stops merge/publication/deployment.

## Rollback

Identify the prior known-good commit before merging runtime work. Prefer reverting the narrow change over stacking guesses onto a broken branch.

Rollback must not intentionally delete unconfirmed local work, queued photos, protected originals, or remote identity evidence needed to prevent duplicates.

## Relationship to the governance set

- `AGENTS.md` owns mandatory entry/reread rules.
- `docs/ROADMAP.md` owns approved phase behavior and completion gates.
- `TESTING_CONTRACT.md` owns test selection/timing/failure-stop behavior.
- `INTEGRATION_CONTRACT.md` owns cross-system authority and sync boundaries.
- `docs/PHASE_STAGING_DOCTRINE.md` owns how far a phase proceeds before real-device evidence is required.

## Maintenance rule

Working behavior is not rewritten merely because a cleaner abstraction exists. Add architecture only when the Team workflow demonstrates a need.
