# Field Work Hub — Phase 5D per-package delivery permit amendment

**Date:** 2026-11-01 (America/Chicago)  
**Plan ID:** `phase5d-per-package-delivery-permits` — revision 1  
**Status:** **DESIGN APPROVED — IMPLEMENTATION AUTHORIZED ON PR #40; TEST PROVIDER GATES / LEVEL-3 PRE-MERGE APPROVAL STILL PENDING**  
**Owner:** Existing Phase 5/6 scope `dashboard-workflow-enhancement-plan`, draft PR #40, branch `feat/phase-5-6-dashboard-workflow`  
**Risk:** Level 1 documentation; proposed Level 3 database, security, provider concurrency, retry and recovery implementation. Separate explicit Level 3 pre-merge approval remains required.

**ACTIVE EXECUTION ORDER — operator-directed November 1:** The approved **new package-scoped permit → existing trusted worker integration → independently authorized NEW synthetic-photo TEST** is the first development priority. The legacy uncertain package is quarantined, not a prerequisite for independent source work or independently fenced new-package TEST. Its durable IDs, journal, session and singleton permit must remain untouched. Read live status and the exact next step in the [authoritative implementation record](PHASE_5_6_IMPLEMENTATION_RECORD_2026-10-06.md); no general Send, parallel worker, production activation or Level-3 merge without its required approval. Historical incident details below and in Appendix A are evidence, not the default development agenda.

## 1. Operator direction and problem

The operator confirmed the *present, nonpublic FWH TEST installation* contains no irreplaceable work or customer evidence: its synthetic photos and disposable TEST fixtures can be recreated or deliberately removed using an exact-scoped recorded cleanup procedure. This **does not classify FPP, future customer FWH data, or uncertain remote-operation evidence as disposable without review**. This permanent architecture must work correctly with real customer data.

The currently deployed Team TEST has **one occupied global delivery permit**, **one QUEUED/DELIVERING outbox item**, **one ready worker**, **one active destination**, and **zero final delivery receipts** (read-only 2026-11-01 snapshot). The original TEST resumable photo upload is still uncertain: reserved Google PHOTO-ID; encrypted session revision 3; saved offset 262144 / 404185 bytes; original one-shot markers; held permit. The original uncertain operation is excluded from the independent new-package path. No blind upload retry, provider identity substitution, fabricated receipt or automatic recovery is authorized.

The existing singleton `private.client_delivery_dispatch_permit`, `service_acquire_delivery_dispatch` / `service_release_delivery_dispatch` and `client-delivery/handler.mjs` block *all* later automatic packages when one permit is held. The current disposable TEST release is additionally pinned to one original two-photo package by `service_claim_exact_test_delivery` and hosted worker scope. Neither making another photo nor switching a config flag makes that path independent.

## 2. Desired product behavior / non-goals

**Outcome:** One failed/UNCERTAIN client package stops **that package** while unrelated, separately authorized packages may continue through the **same existing trusted server-mediated delivery worker**. Provide correct per-package progress, recovery attention and backpressure; avoid a business-wide stall caused by one failed photo.

**Non-goals:** No parallel untrusted/bare-Google upload API, additional independent release queue, alternative connector to evade a safety restriction, restart of the original protected upload, automatic release of its held evidence, client Send without a deliberate authorized action, silent photo deletion, FPP modifications or production activation. A fresh-photo test cannot determine the state of the original reserved Google file ID.

**Compatibility:** Retain immutable org/company/WO/run/photo/package identities, the approved manifest hash and destination revision, user/team/role authorization, explicit human Send, one-shot/preallocated remote IDs, private receipts, no-duplicate guarantees and final-delivery-gated phone cleanup. No change to Phase 6 approvals, status semantics, existing accepted physical TEST evidence or Android capture behavior.

## 3. Proposed technical design — one owner, package-scoped concurrency

1. **Package permit model:** Introduce a private, server-only durable permit keyed by immutable `package_id`, with immutable org/destination identity, unique request/worker token, lease generation/fencing metadata, acquisition time and state. A unique key allows only **one mutating owner per package**, while permitting different packages concurrently. Use the existing ledger/Edge worker owner; refactor the existing permit adapter, not a parallel worker.
2. **Atomic acquire and fenced release:** An authorized service-role transaction checks package eligibility, exact approved manifest/destination, and absence of another holder for the same package. The owner token/generation is checked on EVERY lease, journal mutation, remote step and release. Never use an expiring lock alone to authorize a takeover: network uncertainty requires exact-ID/provider reconciliation before the original package resumes. Missing confirmation always fails closed.
3. **Shared parent-folder safety:** Packages can share company, root and geographic parent folders. Serialize reservation/create/reconciliation **per stable parent-map identity**, across packages, with database uniqueness/atomic ownership and deterministic lock ordering. Reuse already verified parent IDs. Two packages must not allocate duplicate parent folders, overwrite appProperties, or create conflicting children. No globally duplicated parent logic.
4. **Bounded scheduling:** One existing trusted backend scheduler/queue owner. Start the isolated TEST rollout at **at most two in-flight packages total**, with per-package single-flight, bounded backoff and Google rate-limit handling. This is a capacity limit, not an alternative bypass of original held state. Ensure company/org fairness so a stuck or busy package cannot monopolize the queue; no broad dequeue that accidentally claims a different package.
5. **Error/recovery states:** A package may be QUEUED, in progress, FAILED_RETRY_SAFE, UNCERTAIN/HELD, verified DELIVERED or explicitly cancelled as allowed by existing business rules. Only independently verified file ID + parent + bytes/hash + durable final receipt qualifies as client DELIVERED. A crashed/uncertain package retains its own permit, session, offset, IDs and audit history; another package may proceed without modifying those records.
6. **Visibility and access:** Read-only Admin troubleshooting shows package-local Held/Needs reconciliation and unaffected other-package progress, without leaking remote IDs, session URLs, tokens or data across orgs. All mutation remains trusted service-only; RLS and grants remain restrictive. No public worker route or browser-controlled permit release.
7. **Legacy original:** Preserve the occupied singleton row, original outbox/journal, encrypted session, reserved remote IDs and support case references as a **quarantined legacy evidence record** until an authorized same-ID disposition. The new scheduler must never re-acquire/release or resume the legacy package. A one-time verified cutover must prove no legacy runner can still issue provider writes; simply leaving the old permit behind is not sufficient to claim isolation. No original provider diagnostic is invoked by this migration.

## 4. Implementation sequence (future — not approved by writing this plan)

**A. Design decision:** Review and explicitly approve this *material Phase 5D design amendment*. Integrate its approved clauses into the complete parent Phase 5 plan and active PR #40 authority; do not assume October 5 approval automatically extends to a changed concurrency architecture.

**B. Source/SQL inventory:** Identify every acquire/release/claim, queue scheduler, parent-map and error/recovery caller on PR #40; verify exact migrations and deployed Team TEST state. Inventory original held identities privately (no credentials or customer IDs in public GitHub). Identify the currently active worker configuration and any scheduler before changing it.

**C. Additive migration:** Add private package-permit schema, tightly restricted RPCs, indexes/constraints and compatibility reads; record owner token/fence, package/parent arbitration and audit fields. No destructive migration, old-row deletion, inferred completed receipts or blanket permit reset. Stage worker with delivery still OFF while schema/claims are verified.

**D. One worker refactor:** Update only existing client-delivery ledger, worker/handler and service RPC owners to use the new package-permit contract. Enforce a single exact-package claim before acquiring a package permit, verify frozen identities throughout, and ensure every parent write is serialized on the shared parent-map owner. Do not activate a second queue, hidden worker or fallback broad claim.

**E. Non-provider verification:** Run focused SQL/Node failure/concurrency/role tests, then existing exact-head CI once as required. Test duplicate wakeups (same package), separate packages, same parent across packages, cross-org denied access, stale lease, worker crash, lost SQL/HTTP acknowledgment, rate limits, partial chunks, duplicate Google IDs, 403/404/409/429/503 and database restart. Prove an UNCERTAIN package stays frozen while another independent package can progress in simulated deterministic tests.

**F. Isolated provider gate:** Only after the approved rollout, confirmed no dual-runner overlap and an authorized TEST destination, stage **one new synthetic package/photo** with entirely new IDs; if this passes, perform only the minimal second-package/provider-concurrency observation needed for this new architecture. Record exact durable remote ID, parent, expected bytes/hash and actual receipt. Stop on ambiguous/denied results. Do **not** repeat the already accepted manual Google transfer. New success does not clear the legacy provider uncertainty.

**G. Controlled activation:** Enable bounded TEST processing first. Production/general-client scheduling remains OFF until all applicable Phase 5 gate evidence, authorized operator release and separate Level 3 pre-merge approval. No scheduler or client Send cutover by documentation alone.

## 5. Disposable TEST fixture policy and original incident

The current synthetic FWH photos are replaceable. If an old synthetic fixture obstructs development, its **bytes** may be disposed of using a separately recorded, identity-scoped, approved TEST cleanup after confirming the fixture has no real customer content. But never erase or relabel the original ambiguous provider journal merely to claim the upload succeeded or that the previous safety block no longer applies. Preserve a redacted evidence snapshot and reconcile remote file identity before any action that could cause duplicate delivery. If secure isolation is not demonstrable, halt that provider operation while continuing independent source tests.

The current global permit is not an inherent permanent product requirement, but it is an active protection on the existing legacy TEST attempt. **Redesigning a future permit model does not retroactively authorize redoing a restricted diagnostic or retrying the old upload.**

## 6. Rollback and full-stop conditions

- **Before deployment:** Revert this documentation proposal only; no runtime state changes.
- **After staged migration:** Disable/stop all new worker and scheduler invocations; preserve all new per-package journals, preallocated Google IDs, encrypted upload sessions, existing receipts and the old singleton. Roll back source to a compatible fail-closed version; do not blindly run an old worker against new active packages or drop permit tables. Reconcile any in-flight operation by exact identity before continuation.
- **Full stop:** Unknown old worker still active; package/parent identity collision; invalid owner/fence; ambiguous provider response; duplicate create risk; unexpected real data; new restriction; role leak; failed required test; or unapproved material scope change.
- **No false completion:** Cleanup, DELIVERED, client receipt, work order COMPLETE and merge are unavailable until their original business and verification gates genuinely pass.

## 7. Verification and acceptance criteria

The design is ready for review when it specifies the SQL atomic boundary, shared-parent serialization, fairness/concurrency cap, strict old-worker cutover and irreversible-state rollback. **Implementation is accepted only when**:
- Two eligible independent synthetic packages make progress without either holding the other's package permit.
- Two workers cannot own the same package; two concurrent packages cannot duplicate the same shared parent.
- An uncertain package never retries with a replacement remote ID and never blocks unrelated packages; its own state stays Held.
- Valid/invalid org, destination, worker tokens and revoked access pass/deny exactly as approved.
- A crash, restart, late reply, timed-out release or unknown Google state cannot mark DELIVERED or authorize cleanup.
- All changed SQL/RLS/RPC and source CI checks pass on the actual implementation head; post-DDL advisors reviewed.
- Narrow *new* physical TEST provider evidence is recorded once, without mislabeling manual transfer as automatic delivery.
- One current authoritative PR/record, accurate deployed parity, explicit Level 3 merge approval and documented safe rollback are present.

## 8. Decision and exact next step

**Decision recorded 2026-11-01, 07:28 America/Chicago (CST):** The operator explicitly replied **“Plan approved”** to revision 1 of this complete permanent per-package-permit amendment, including initial TEST concurrency cap two, package-scoped failure isolation, shared-parent fencing, and quarantined original evidence. This is material Phase 5 design approval and authorizes governed source implementation on **existing PR #40**. It is **not** provider-test authorization to retry the blocked October 26 operation, a release of the original HELD permit, production activation, or the separate Level-3 pre-merge approval. Next: integrate approved design into Phase 5 parent plan, inventory exact SQL/service callers, implement additive fail-closed schema and focused tests, then stage source-worker integration under the documented boundaries.

## Appendix A — prior fresh-photo proposal and read-only preflight, preserved verbatim

### Fresh-photo alternative diagnostic proposal — 2026-11-01 (PLANNED, NOT RUN)

**Goal:** As a separate investigation, try one *new disposable FWH Team TEST photo* through an independently authorized automatic-delivery path. If it fails, record its exact failure to investigate a possible shared defect; if it succeeds, investigate original-session-specific causes. Either result is **not proof** of the original reserved Google PHOTO-ID state, final delivery, or why ChatGPT restricted the October 26 diagnostic. This documents operator intent, not authorization to retry a restricted operation or activate delivery.

**First gate (read-only preflight):** From existing evidence/source, determine whether the original **HELD global dispatch permit** prevents a separate test, and whether a genuinely independent, permitted TEST-only path exists. Plan distinct synthetic WO/run/photo/package UUIDs, remote file ID, destination, session, permit and retry identity. Do not route around safety controls using another connector/account, bypass a global permit, or disturb original held evidence. If authorization/isolation cannot be proven, **STOP**; no new provider call.

**Only if the independent path is authorized:** Use one labeled synthetic noncustomer photo and verified TEST-only destination. Record initial state, expected size/hash; run one bounded approved test, capturing precise worker/provider statuses and actual remote ID/bytes/hash/receipt. Stop on any denial, ambiguity or uncertain ownership; no blind retries. Preserve the original PHOTO-ID, encrypted session, **262144/404185 offset**, original one-shot markers and HELD permit untouched. No customer Send, cleanup, original upload/resume, blocked diagnostic reproduction, production or FPP mutation.

**Outcome/next handoff:** Compare failure *category*, not remote file identity, with original case. Preserve prior manual Google TEST transfer PASS (do not repeat); original automatic Phase 5D remains **BLOCKED/UNVERIFIED** until its own remote identity is resolved by permitted evidence. Record the actual new-photo result and next gate here; obey Phase 5/6 governance and Level-3 approval for any runtime/authority change. No new phase or parallel PR.

**This change:** Level-1 documentation only on authoritative draft PR #40; zero runtime/provider/SQL/phone/release changes. Rollback: revert this note. Verify one-file diff/readback; stay below the 21 KiB archival threshold / 24 KiB hard limit.

**2026-11-01 read-only preflight — BLOCKED:** Live Team TEST counts: 1 global permit, 1 queued/delivering outbox, 1 ready worker, 1 active destination, **0 final receipts**. Source enforces a singleton permit and pins TEST delivery to the original package. New-photo automatic delivery is not independent; **STOP**. No provider/worker action or record reset.
