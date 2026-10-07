# Phase 5–6 dashboard workflow — implementation record

Scope key: `dashboard-workflow-enhancement-plan`. Change level: **Level 3**.
Authoritative branch: `feat/phase-5-6-dashboard-workflow`; draft PR **#40** (https://github.com/timbone72-CC/field-work-hub/pull/40).
Baseline / source rollback: main `62244e2c4c11831d4e8104821f851f19124b2616`.

## Approved scope and authority

Implement both whole parent-phase plans, revision 1, plus shared-access amendment `supervisor-access-recovery`, revision 1. PR #38 records baseline approval on 2026-10-05 at 16:32:14 America/Chicago; PR #39 records amendment approval at 17:40:18. Operator instructed coordinated implementation in dependency order with internal checkpoints on 2026-10-05 at 19:54:20 America/Chicago. This is implementation authorization, not Level 3 pre-merge approval. The latter remains PENDING.

Required rules read: AGENTS, Governance, Project Profile, Rule Index, Change Control, Testing, Integration, Phase Staging, current Phase 5/6 roadmap and linked complete plans/amendment. Preserve accepted Phase 0–4 evidence. FPP is excluded.

## Preflight and external parity

Main is the baseline above. No open PR or overlapping Phase 5/6 runtime branch was found. Retained prior feature/planning branches are historical, not competing implementations. Team backend is `vyocaujuwrivoqynvitm`; FPP backend is excluded. All 23 Team migration versions/names match repository order through `20261003211841`. Read-only live inspection found no Storage bucket, no cron/net extensions and no new Phase 5/6 functions. Existing invitation function remains the trusted invitation owner. One Admin and two Contractors exist; inventory found 14 WOs in the current Admin organization and one WO in a separate fixture organization. That separate row will remain unmapped until explicitly handled; no owner identity or legacy team mapping is inferred from this count.

No live database, Auth, storage, email, Drive, Android or hosting mutation has occurred. Public evidence records counts and technical revisions only, never account identifiers/PII or credentials. Initial inventory mistakenly queried a nonexistent profiles table; the read failed without mutation and was corrected to the existing trusted Auth metadata owner.

Supabase CLI 2.101.0 created the actual migration filename. Official changelog and RLS documentation were inspected; new schemas/tables need explicit revokes, RLS and grants. The changelog Markdown endpoint was unavailable; the HTML index was available. No relevant adapter/API replacement is needed for this SQL-only foundation.

## Dependency checkpoints

1. Common team/access authority: additive records, current-session/user checks, explicit capabilities and immutable responsible-team binding; synthetic allowed/denied proof. No guessed legacy mapping or Supervisor activation.
2. Private transfer and minimum recovery: exact accepted Finish/content receipts, recovery cutoffs/export, review and package/Send; retain existing photo/action/session owners.
3. Phase 6 workflow: bounded workspace, templates, ACK/follow-ups, bulk review and cross-run selection; same Phase 5 transfer/delivery/cleanup engine.
4. Shared controls, optional alerts/recovery email: complete permission matrix, scoped dispatch and actual configured TEST sender/device evidence.
5. Combine compatible Phase 5/6 phone/laptop/provider checks, retaining separate phase completion evidence; final exact-head automation/live parity and explicit Level 3 merge approval.

Independent approved work may proceed without letter-level approval. A setup/evidence failure stops only work depending on it.

## Checkpoint 1 implementation boundary and rollback

Affected surfaces: new SQL authorization/team foundation, controlled disposable Auth/session fixture, focused database gate, existing database CI, this record and roadmap execution notice. New capability helpers authorize current trusted identities against private membership/access records. Platform-owner capability never grants customer-work access. Supervisor work remains disabled until the complete Phase 6 gate. Legacy policies/RPCs are not cut over by this foundation-only checkpoint; do not deploy a partial authorization cutover or advertise work disablement as usable.

Before dependent deployment: verify intended Product Owner Auth UUID through the operator path, review explicit existing Admin/team/Contractor/WO mappings, establish Admin/Supervisor allowances, then implement and test compatibility guards across old RPC/table/Storage paths. Unmapped rows remain denied by new scoped helpers. No new invitations or live grants are authorized from an assumed allowance.

Source rollback is the baseline. As nothing is deployed, discard/revert this isolated candidate without affecting live work. After future deployment, pause affected new work and forward-repair additive schema while retaining team/grant/audit/photo/outbox records; never drop evidence or downgrade Room incompatibly. Record exact external state and compatible recovery artifacts before that deployment.

## Evidence and next gate

Checkpoint 1 source now contains explicit teams, private work entitlements/memberships, gated Supervisor scopes, operator-supplied capacity records, private owner capability, a responsible-team FK/protection trigger and self-only current-session capability helpers. It does not yet implement photo recovery grants, account lifecycle RPCs, audited handoff or legacy authorization cutover. Embedded PostgreSQL (PGlite 0.3.14, temporary local harness) applied all 24 migrations and passed the focused access gate. This deterministic SQL evidence is not hosted Supabase or real multi-connection evidence. Existing dashboard tests passed 19/19; diff whitespace check passed. Actual PostgreSQL 17 CI is the next proof boundary. Installing a local system PostgreSQL was unavailable in this execution environment; no local native/race PASS is claimed. No final complete-suite, deployed permission, device, private transfer, provider, recovery email or phase-completion PASS is claimed. Next gate: focused synthetic database authority tests, then exact candidate CI; owner verification and reviewed legacy mapping remain required before live permission cutover. Phase 5/6 completion and runtime merge approval remain pending.


## Checkpoint 1 native SQL evidence — 2026-10-06

Tested runtime head: `b4bbf80d64e16066866604747176e6a7d6e760a4`; Git tree `58d3ada9f02e51b1835a3f5cd6bc3fe1efbdaf71` matches the local reviewed tree. Native PostgreSQL 17 CI run **37397169251** PASS: all 24 candidate migrations, controlled Phase 3A/3/4 and new Phase 5 capability/session gates, plus existing real two-connection mutation races. Admin CI **37397169108** and governance **37397169040** PASS. Android CI **37397168969** PASS: existing focused/complete JVM tests, candidate/recovery builds, schema and package/signer identity checks. All required checks passed for this checkpoint runtime head; whole-phase device/provider gates remain pending. This source-only candidate is not deployed and is not the final combined runtime.

Next required setup review: bind the intended existing verified FWH Admin identity as Product Owner through the trusted operator procedure; explicitly map that Admin organization's 14 WOs and two Contractors to its initial team. Do not map the separate test-organization WO into that team. Actual account/organization UUIDs remain private; the operator must confirm the account/mapping before live changes. No additional plan approval is required. Capacity values, full legacy RPC/table policy cutover, recovery/transfer/release and all Phase 6 work remain pending on this same line.

## Confirmed initial setup and checkpoint 1 continuation — 2026-10-07

Operator answered **“1 yes 2 yes”** to binding the existing verified FWH Admin identity as Product Owner and mapping that Admin organization's 14 existing WOs and two Contractors to its initial team. This resolves the setup confirmation above; do not request it again. It does not grant runtime merge approval or decide future Admin/Supervisor capacity. Read-only verification confirms the same verified Admin, two active accepted Contractors and 14 WOs; the separate fixture organization remains excluded. No live change has occurred.

One legacy WO is assigned to the same-org Admin instead of a Contractor. Preserve its identity, assignment and run facts during team mapping. This is a compatibility exception to handle before live cutover, not permission to silently reassign/delete it or promote the Admin to Contractor. New team ownership must not depend on that old assignment. Public evidence intentionally omits personal account/organization/WO UUIDs and email.

The additive `20261007164241_phase_5_initial_access_bootstrap.sql` migration supplies a private service/operator-only one-time bootstrap and immutable audit ledger. No public RPC or client execution grant; the migration seeds no real identity. The operator supplies immutable owner/Admin/team/org UUIDs, environment, reason, exact Contractor UUID set and reviewed current WO snapshot. The function verifies current Auth/accepted-Contractor facts, rejects multi-Admin/changed/foreign/incomplete inventory and refuses to replace existing authority. Fixed-order table locks freeze inventory during the atomic setup, with a five-second contention timeout. Existing work facts stay intact apart from the explicit initial responsible-team binding and normal updated-at bookkeeping. Owner entitlement and Admin work membership remain separate. No allowances, Supervisor activation, Auth role changes, reassignment, receipt, delivery or cleanup are inferred.

An action UUID binds its exact canonical manifest and historical result. Identical retries return that result without remapping jobs or restoring subsequently revoked access; changed-payload reuse fails. A second bootstrap action is denied. This initial-only procedure cannot add a later organization, replace an owner, release suspension or substitute for governed account lifecycle/handoff operations.

Focused evidence: all 25 candidate migrations and both Phase 5 SQL gates PASS in temporary embedded PostgreSQL; 19/19 existing dashboard tests PASS; Python race script compiles and diff whitespace check passes. Native PostgreSQL 17 CI must prove competing bootstrap, same-action retry and post-review WO/Auth changes with actual connection lock waits. Local embedded tests do not claim concurrency, hosted permission, device/provider or whole-phase completion. Synthetic legacy Admin-assignment setup is confined to the rollback-only controlled test; no live guard is disabled.

### Operator activation procedure and next dependency

1. Finish and test common current-access guards across legacy RPC/direct-table paths, exact photo recovery cutoffs and pre-cutoff accepted transfer continuation before enabling work disablement or Supervisor work. Inspect the preserved Admin-assigned legacy WO explicitly in compatibility tests; it remains mapped to its office team and gains no Contractor work authority.
2. Verify exact candidate/live migration order and correct Team environment again. Apply additive migrations through the governed migration owner; run security/performance advisors. Do not apply only this checkpoint to claim live isolation or recovery readiness.
3. In a private operator session, verify the already-confirmed immutable identities, choose a new team/action UUID and a non-sensitive team label, read `private.initial_team_work_snapshot(org_uuid)` plus current Auth Contractor UUIDs, and review the 14-WO/two-Contractor inventory. Pass that exact snapshot to `private.bootstrap_initial_team_access`; stale inventory requires reread/review, not relaxed checks. Keep real manifest values out of Git/PR/public logs. An unresolved outcome retries the same action/manifest, never a new bootstrap identity.
4. Read back one owner capability, the Admin membership, two roster memberships, all 14 explicit responsible-team bindings, Supervisor OFF and untouched separate fixture. Preserve original work/run/photo/assignment/provider facts. Record non-secret counts, exact source/runtime revisions, advisor results and tested grants. Future office allowance values need an explicit decision before new office invitations; existing Contractor caps/reservations remain unchanged.

Checkpoint remains source-only on PR #40. Next implementation work is legacy authority compatibility and exact recovery/private-transfer foundations on this same approved line; capacity/provider configuration and integrated phone/laptop/email/push evidence remain genuine later gates. Phases 5 and 6 are IN PROGRESS, not complete. Runtime merge approval remains PENDING.
