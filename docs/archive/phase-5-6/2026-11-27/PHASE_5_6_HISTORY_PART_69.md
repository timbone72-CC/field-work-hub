**Post-Codex correction pass — construction continued on PR #137.** The selective
rewrite now includes untouched-follow-up cancellation and replacement, so their
existing correction business functions use the shared scoped office authority.
The Supervisor CAS endpoint has an explicit Supervisor role check, accepts
legacy null requirement revisions, retains the historical same-assignment Admin
exception while requiring active same-team Contractors for new assignments, and
the requirements wrapper retains its legacy authority lock before the shared
scope check. The disposable database gate now covers CAS replay/stale behavior,
legacy null revisions, inactive/foreign-team assignees and the Supervisor-only
boundary; source parity covers the retained wrapper lock and follow-up rewrites.
No hosted migration-history repair, deployment, activation, merge, device test
or provider test was performed. Exact-head CI at `5395652afab47a374195b4bbc5616d2877cc1f92`
is PASS: Governance 2808, Database 4979, Dashboard 5254 and Android 5269.
Explicit Level 3 merge authorization remains outstanding.

**Level 3 / FINISH; branch `feat/fwh-6f-t01-shared-office-workflow`; baseline/rollback `7e60a83c11a5ed794c087143fe1a476d0ff808da`.** Approved shared-access amendment and current 6F-T01 definition govern. Read-only TEST: two organizations with Supervisor work readiness false, zero Supervisor grants, 142 migrations. Existing scoped work page/detail/schedule/assignment, team predicate, exact review signer and package authority remain owners. The permanent source construction now adds one selective `private.shared_office_work_org()` boundary, an action-bound `public.office_supervisor_update_work_order_v4`, and scoped `public.office_supervisor_assignable_users`; it rewrites only the canonical draft/create/template/correction owners and their required Phase 4 engines. Staffing, invitation, owner-grant, escalation and legacy nonrevision Admin paths remain separate and revoked/restricted. The dashboard selects these Supervisor endpoints while retaining the existing Admin endpoints for Admins; creation continues through the existing draft/create owner. A disposable database gate covers scoped client choices/assignable users, same-team draft creation and rejection of an out-of-scope Contractor; the browser fixture and source assertions cover endpoint routing. All 31 dashboard tests, JavaScript syntax checks and diff checks pass locally. Exact-head CI at `d5142b18fe5ad5bf971d2682b641ae6492d05ae9` is PASS: Database 4971, Dashboard 5246, Android 5261. The migration-history discrepancy remains explicitly unresolved pending a real migration-capable checkout: repository and TEST-only versions are not mapped or repaired by assumption, and no hosted migration/activation has occurred. Hosted TEST deployment/activation, explicit Level 3 merge authorization and actual authorized Supervisor workflow remain outstanding. No device, provider, photo, production, activation or release change; previously accepted device/provider evidence is not repeated.

