# Field Photo Prep Team Phase Staging Doctrine

Status: **GOVERNED PROJECT OPERATING RULE**

## Mandatory reread before using this doctrine

Before making a phase-transition decision, deciding how far to implement before the next phone test, staging a physical-device gate, or resuming work after device evidence:

1. read `AGENTS.md` completely;
2. read the relevant current and next phase in `docs/ROADMAP.md` completely;
3. read `CHANGE_CONTROL_CONTRACT.md`;
4. read `TESTING_CONTRACT.md`;
5. read `INTEGRATION_CONTRACT.md` when the phase touches Supabase/Auth/RLS, Room/offline state, reassignment, camera/photos, background sync, remote storage, upload, retry, or cleanup;
6. read the exact device-gate plan for that phase if one exists.

Do not replace these rereads with memory, a chat summary, previous-session notes, or an earlier read.

If the next phase is not fully planned in `docs/ROADMAP.md`, **STOP. Planning is the next task.**

## Purpose

Team is developed in large, evidence-based stages through working operation. Safe staging prepares an approved feature for deployment and activation; it is an intermediate condition, not the completion target. The operational finish line and authorization boundaries in GOVERNANCE.md govern closeout.

Default pattern:

`plan the full operational outcome → build and verify → stage safely → obtain any still-missing required authorization → deploy and activate in the authorized environment → verify only the affected unproven behavior → leave the accepted feature enabled`

Place necessary device/provider gates at their actual dependency boundary within that sequence. Reuse accepted evidence; a phone gate, deployment step or temporary OFF setting does not create another approval or retest stage. If the approved target is working operation, continue through activation and acceptance unless a specific blocker or operator decision prevents it.

## Numbered parent phase and one plan approval

A **phase** is the numbered parent in the roadmap, such as Phase 3. Its lettered sections, such as 3A/3B/3C, divide implementation and evidence inside that phase. They are not separate design-approval units.

Before starting any section, complete the entire parent-phase plan with behavior, protected boundaries, failure/recovery, verification and completion criteria for every included section. Identify dependencies and each genuine phone/laptop/provider gate upfront, explaining what automation cannot prove and what subsequent work depends on it. Do not approve only the next letter and defer planning the remaining letters until later.

Record one parent-phase plan approval and proceed through its included sections within unchanged scope. An impact record or technical implementation note may refine approved behavior without requiring another design approval. A lettered-section, branch/PR, session boundary or passed phone gate is not a reason to request permission again. Separate explicit Level 3 pre-merge approval remains mandatory.

Multiple real-device/provider gates are permitted where actual evidence dependencies require them. Build all independent work that can safely be proven first, combine compatible checks, and pause only dependent work at the documented boundary. A newly discovered real boundary must have a recorded reason; it does not by itself create another design-approval gate.

For a phase already underway, retain approved decisions, completed work and accepted evidence. If material planning gaps exist, finish the missing remainder together in one consolidated amendment; seek approval only for material decisions not already authorized. Do not restart completed sections, infer whole-phase approval from a partial approval, or repeat passed gates to satisfy a new document format.

## Straight-line development rule

Within an approved phase:

- settled product decisions stay settled unless evidence contradicts them;
- use the largest safe testable implementation chunk practical;
- use focused automated tests while developing;
- use one final complete automated suite on the final runtime head;
- do not repeatedly ask for authorization already granted by the approved scope;
- do not stop for a phone check when the next safe work does not depend on phone evidence;
- do not invent real-device, Android lifecycle, camera, network, background-work, Supabase, or remote-storage behavior that only a reality gate can prove;
- do not continue past a boundary where the next design decision materially depends on unverified reality.

## Phase-plan gate

Before runtime implementation begins for the numbered parent phase, the roadmap or its linked governing plan documents must define the following across **all** lettered sections:

- user-visible workflow;
- authority boundaries;
- offline/restart behavior where applicable;
- conflict/reassignment/cancellation behavior where applicable;
- protected identity/data rules;
- failure behavior;
- implementation boundaries and dependencies between sections;
- automated verification;
- each physical-device/laptop/provider gate where needed, its evidence purpose and the subsequent work it gates;
- completion criteria.

If any material item is missing, complete the entire missing parent-phase scope before dependent implementation. Obtain approval for material decisions not already authorized; routine refinement of approved behavior does not create a new plan-approval gate.

## What may be decided inside an approved phase

Narrow implementation details may be decided without reopening product planning when they:

- stay inside documented behavior;
- do not expand scope;
- do not weaken authorization, offline preservation, photo protection, identity, duplicate prevention, or uncertainty handling;
- are covered by the planned test boundary;
- do not introduce a new unproven device/provider assumption.

Examples: helper shape, local naming, a narrow test seam, or harmless internal refactoring required by the approved implementation.

## What requires stopping/replanning

Stop the affected path when:

- a real device/provider/backend result contradicts a roadmap assumption;
- continuing requires guessing about Android, connectivity, CameraX, background execution, Supabase authorization, or remote storage;
- scope must expand;
- a new Level 3 behavior appears outside the approved plan;
- a required focused/final test fails;
- protected local work/photos could be lost, misattributed, or silently overwritten;
- an upload/result becomes ambiguous and the next action would be a blind retry.

The stop is targeted. Independent work may continue only when it does not depend on the failed assumption and cannot hide or worsen the problem. A failure is fixed and reverified within approved scope when possible. Reopen design approval only when resolving it requires a material change to approved scope, behavior, authority/protection or design. Record that change as one parent-phase amendment, rather than restarting letter-by-letter approvals.

## Staging standard at a genuine device boundary

Before a device gate, record:

1. exact branch and runtime SHA;
2. exact final automated-tested head;
3. final CI result and artifact identity where applicable;
4. current implementation/impact record;
5. roadmap status;
6. rollback point;
7. the smallest straight-line device test plan;
8. PASS/BLOCKED/FAIL criteria;
9. explicit stop conditions;
10. which observations will be accepted as durable evidence for the next phase.

Do not create a large audit ritual when the phase added little risk. Verification must remain proportional.

## After a device gate

- record the result once;
- do not rerun it merely for reassurance;
- if PASS, continue the authorized rollout through activation and acceptance; leave the accepted feature enabled in its authorized environment;
- if BLOCKED, preserve the tested runtime and record the specific failed check, dependency, missing authorization or operator decision, exact next action and resume condition;
- if FAIL, fix the specific failed assumption/behavior before continuing the dependent path;
- update the roadmap if the evidence changes the planned behavior or next boundary.

## FPP inheritance

This doctrine intentionally carries forward the successful FPP development pattern: build to evidence, stop only where reality is required, and keep the repository instructions strong enough that future agents cannot silently skip the plan.

## Governing principle

**Plan before coding. Carry approved work through deployed, enabled and verified operation. Stop only the affected path at a real failure, unmet dependency, required authorization or necessary reality boundary.**
