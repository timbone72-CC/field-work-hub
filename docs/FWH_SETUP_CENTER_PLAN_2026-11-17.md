# FWH Setup & Configuration Center — proposed Phase 6 amendment

Plan ID: `FWH_SETUP_CENTER_PLAN_2026-11-17`
Revision: **1 — DRAFT FOR OPERATOR REVIEW; planning authorized, runtime not authorized.**
Product source: [Issue #51](https://github.com/timbone72-CC/field-work-hub/issues/51).
Evidence baseline: main `976d10357c4abbcf8c29479a498a061693c50ec0`, November 17, 2026 (America/Chicago).

## 1. Outcome and placement

An authorized office user can find business settings in one place, optionally follow guided setup, leave and resume, and see exactly what is missing for the selected client. Existing businesses can open any section directly. No job must be created merely to configure a client or its storage.

**Proposed placement: Phase 6G, under FWH-F06 / AC3, before the Phase 7 internal pilot.** This adds a bounded configuration experience to the existing whole Phase 6 plan; it creates no new numbered phase or release milestone. It does not require every workflow, cleanup, alert or recovery feature to be complete before construction. Its direct dependencies are the settings and authorization owners it exposes. Finish the current 6C task or record its genuine external block before selecting approved 6G work. Planning this amendment does not select it or resume deferred PR #116.

The operator asked to plan the wizard on November 17. Approval of this complete amendment would authorize its three construction tasks within the stated scope; no task-by-task design approvals. Existing Level 3 merge and applicable hosted/provider permissions remain. Until that decision, the adopted task register and AC3 definition are unchanged. Issue #51's former unscheduled status is the historical starting point, not implementation authority.

## 2. First release and boundaries

One **Setup & Configuration** destination, one indexed settings home and one optional **Guided setup** route through the same section components. These are proposed labels, not instructions claiming buttons exist today.

- Always show the business/environment and selected authorized team/client scope. Distinguish the operator's business from its client companies.
- Required sections: business time zone, field team, client company, and delivery storage. Optional sections: work/photo defaults, notifications and links to existing account/recovery controls.
- Offer All / Needs Attention / Optional filters. Each attention item says what is missing, who can fix it and opens the exact existing control or documented operator step.
- Use Back / Continue / Save / Exit setup, with existing unsaved-change protection. Continue advances navigation; only an explicit Save commits a setting.
- Existing users are never forced through the wizard. Exiting, skipping an optional section or an incomplete progress bar does not disable independently authorized work.
- The wizard never creates a WO, assigns work, reviews photos, approves/Sends a package, activates a worker, enrolls push, deletes evidence or changes a role merely by advancing.

Excluded: a new settings engine, duplicated edit forms, business signup/tenant provisioning, new roles or grants, a contractor-phone wizard, automatic Google authorization/activation, automatic verification uploads, billing, profile/logo/contact editing, contextual autofill, and changes to capture, offline sync, delivery, cleanup or FPP. Business-profile editing has not been established as an existing supported settings owner and is not invented here.

## 3. Inspected settings and ownership

This inventory is **source evidence**, not a fresh claim that every setting is deployed, enabled or accepted. Reconcile exact hosted definitions before runtime rollout. PR #119 is merged at the baseline; its record's older pre-merge/deployment wording does not independently establish hosted parity.

| Section | Existing source/authority | Required result or optional behavior | Work needed for the center |
| --- | --- | --- | --- |
| Business and time zone | `dashboard/notifications.js`; `admin_notification_settings` and the existing revisioned organization-time-zone save | Required: an explicitly saved valid IANA organization time zone; the displayed America/Chicago fallback is not evidence of a saved value | Show current organization identity read-only; reuse time-zone editor outside Alerts without enabling a notification channel |
| Field team | `dashboard/app.js`, `staffing-candidates.js`, `owner-management.js`, `staffing.js`; current assignment eligibility, invitations and seat/team authority | Required: at least one currently assignable Contractor in the selected authorized team/scope. An invitation or available seat alone is not completion | Open existing permitted people/invite controls; show Pending activation or Needs authorized manager. Do not invent a self-assignment path or require a second Admin/Supervisor |
| Client company | `dashboard/create-drafts.js`; `admin_creation_client_choices`, `admin_create_client_company` with NULL WO context, migration `20261117193000` | Required: explicitly selected, saved, active authorized client UUID/name. Empty drafts may remain incomplete | Extract the same company picker/create component for both Create & Assign and setup; no automatic company selection, WO or duplicate company |
| Delivery storage | `dashboard/folder-layout.js`; `admin_list_client_folder_destinations`, `admin_propose_client_delivery_destination`, `admin_set_client_folder_layout`; existing trusted provider-proof and activation owners | Required: the selected client's exact registered destination is proof-verified, active and has a saved supported layout; show separate last verification/current health facts | Remove selected-WO UI dependency, retaining client/org/session checks. Include inactive/unverified status through the narrow read described below. Proposal is not verification or activation |
| Work and photo defaults | `dashboard/photo-requirements.js`; `admin_save_company_photo_template`; current WO-number preference | Optional: reusable company/work-type templates, instructions and numbering preference. Custom per-job requirements remain supported | Reuse the requirement/template editor without submitting a job; label org-wide versus client-specific templates; no new global review-policy setting or forced template |
| Notifications and recovery | `dashboard/notifications.js`, existing account/invitation and recovery pages | Optional preferences and links. Push is device-specific; recovery access does not restore work authority | Direct navigation only to supported controls. No automatic browser prompt, email, role grant or assumed recovery readiness; existing 6E/6F acceptance remains separate |

**Concrete gap:** `folder-layout.js` currently checks `editWorkOrderIdInput.value`, and proposal choices are bound through the selected job. The proposal RPC itself takes a company UUID, not a WO. Setup therefore needs a reusable explicit authorized client context, not a fake job. The current verified-destination list omits unverified proposals; that list cannot prove that no proposal exists. Do not offer a new root merely because that list is empty.

## 4. Progress that has a clear meaning

Progress is **setup for the selected client and authorized team**, not an organization-wide readiness score. Show that scope next to the bar. The settings index lists each authorized client separately so one configured client cannot hide another client's missing storage. No client is silently selected and inactive/legacy clients are not silently reactivated.

There are four required areas in section 3. When all four current reads are available, percentage is `100 × confirmed complete required areas / 4`, with a matching `N of 4 required areas complete` count. With no selected client, client and storage remain incomplete. Optional sections never enter this denominator or become mandatory because the user visited them.

Each section has Complete / Needs Attention / Checking or Unavailable; Optional is a classification, not proof of completion. Needs Attention includes waiting for an authorized operator, stale conflicts and known invalidated configuration. A denied capability is not counted as complete or removed to inflate the percentage. If a required read fails or scope changes, suppress the percentage, show how many areas are confirmed and label the missing information; never retain a stale 100% claim.

Complete means the server confirmed the saved configuration and applicable durable verification. For storage, show provider verification time if available, otherwise explicitly say the time is unavailable. Historical proof is not a continuous Google access check. Display operational health separately as Last checked / Problem reported / Current access not checked; a known revoked/inactive destination removes storage completion. Opening setup performs no Google operation. Underlying approval/Send checks still decide whether an actual operation is allowed, regardless of setup percentage.

Defaults or template changes affect future copies only. Existing dispatched requirement snapshots, company binding, prepared evidence, approved package destinations, provider IDs and delivered history remain immutable under their existing owners.

## 5. User path and resume

1. Open Setup & Configuration; load only the signed-in actor's permitted facts and actions. Choose a client explicitly, or create the first client using the existing owner without creating work.
2. Open any indexed section, or start Guided setup. Navigation order is business time zone → field team → client company → storage → optional defaults → optional alerts/recovery → summary. A missing client takes the user directly to the client step; earlier settings remain reachable.
3. A saved section rereads the current server result before receiving Complete. If unchanged and already confirmed, Continue performs no save. Optional sections can be skipped.
4. Summary names remaining actions, including Waiting for trusted storage verification/activation. When complete, offer a normal link to Create & Assign; entering it does not dispatch and does not replace its own validation.

Saved settings remain in their existing server owners. Resume stores only a schema-versioned navigation cursor and selected UUIDs, keyed by environment, actor and organization in browser storage; no credentials, invitations, settings payloads, customer text or copied backend truth. Revalidate scope and derive progress anew on every resume. Cross-device cursor synchronization is excluded; saved configuration still loads on another device. If browser storage is unavailable, resume at the first incomplete required section without losing saved settings.

Unsaved input stays in the owning editor until the user saves, stays or explicitly discards, using the existing draft/navigation patterns where applicable. The cursor is not a settings draft. Sign-out/account change clears rendered data and pending responses; no previous-user selection or content may render for the next account.

## 6. Implementation boundaries and missing reads

Use small setup navigation/status components and adapters in the dashboard; keep mutation validation and persistence in existing owners. Shared editors render once for the active context, rather than independent forms with divergent rules. Do not change PR #116's deferred delivery controls.

Existing authorized reads supply organization time zone, assignable field users, client choices and verified folder layout. **One narrow authenticated setup-status read is proposed** where existing reads cannot return unverified/inactive registration and verification/invalidation facts. This is a Level 3 boundary, not a broad private-table grant:

- Server derives the organization and current Admin work authority; validates any selected team/client against current existing capabilities. No trust in a browser-supplied organization or role.
- Return only section status/reason, permitted action names, relevant opaque IDs/revisions and safe verification timestamps. No service keys, provider tokens, proof upload sessions, secret references, invitation links, photo bytes or foreign records.
- Use existing authorization predicates and internal fact owners. No materialized second readiness table, polling worker, queue or user-settable Complete flag.
- Bound client/status reads with the existing page pattern; never treat a truncated list as absence. Deny foreign IDs without revealing existence. Validate identity and revisions again for every mutation.
- If composing multiple reads, show Checking until their actor/org/client context agrees. Changed revisions cause refresh, not a mixed-state 100% result.
- Initial release supports active authorized Admin work access. Product Owner capability alone, Contractors, recovery-only identities and Supervisors do not acquire Admin settings rights. Retain their existing separate interfaces; Supervisor setup can be considered only under its accepted capability owner later.

Trusted storage preflight/proof/activation stays service-only. The center shows existing evidence and the exact operator action needed; it does not expose service RPCs to the browser. A user-entered Workspace email/root is an inactive candidate, not proof of ownership. If verification needs provider writes, prepare the exact scoped action for existing authorization; do not run it on load or Continue. Adding fully self-service provider connection is a separate material expansion, not hidden wizard work.

## 7. Failure containment and recovery

| Failure | Visible result and safe independent work | Evidence/retry boundary |
| --- | --- | --- |
| One section read fails or page is offline | Section unavailable, percentage withheld; other loaded sections and unrelated work remain usable subject to their own checks | Retain saved server configuration; retry that read after reconnect, never save a guessed default |
| Save rejected or stale | Keep entered values, explain the conflict, offer the existing reload/review choice | No Complete until confirmed current revision; no silent overwrite |
| Save response lost | Saving outcome unconfirmed; do not automatically send a second action | Reconcile through the existing owner's same action/revision or exact saved-value read; if identity is unavailable after reload, require owner reconciliation rather than new duplicate proposals/invitations |
| Sign-out, team/client switch or permissions revoked | Clear or reload affected scope; late responses ignored; existing unsaved navigation guard applies | Revalidate server authority; no prior-account local cache used as permission |
| Root already registered/inactive or provider unavailable | Show the existing registration or a scoped conflict; trusted operator may need to act | Never create another root, replace a destination UUID or activate from browser inputs |
| Optional push/recovery unavailable | Optional area explains its limitation; required setup remains independently evaluable | No automatic enrollment/email or false 6E/6F acceptance |
| Setup UI deployment fails | Existing settings entry points remain available; revert only the new UI | Preserve all saved configuration, jobs, proofs and journals; no destructive database rollback |

A provider/service outage may affect multiple clients; reflect that actual shared dependency without blocking unrelated safe reads or field evidence retention.

## 8. Proposed construction tasks

These IDs are proposals, absent from the approved active register until amendment approval. Each task includes implementation and its own missing verification; green CI alone is not completion.

| Proposed task | Dependency | Deliverable and Definition of Done |
| --- | --- | --- |
| **6G-T01 — indexed settings and truthful status** | Approved amendment; reconciled existing settings APIs, especially #119; current-task handoff under normal governance | Setup home, explicit scope, reusable settings controls independent of a WO, narrow status read, four-area progress and exact attention links. No duplicated forms or new authority; denied/unknown/stale states correct |
| **6G-T02 — optional guide and resume** | T01 components and permission/status model | Guided navigation over those same controls, optional skip, unsaved-change handling, same-browser cursor resume and account isolation; refresh derives saved truth, not remembered ticks |
| **6G-T03 — TEST publication and acceptance** | T01–T02 source, required CI and approvals; legitimate existing TEST scope | Publish compatible backend before UI if needed; verify one combined office walkthrough and changed gap/failure boundaries; leave the authorized working center available. Record remaining trusted-provider steps honestly; no forced reconfiguration or unrequested Google/WO operation |

**Selection proposal:** after current 6C completion (or a documented genuine block with no safe same-subphase construction), select approved 6G-T01 when its direct APIs are usable; T02 follows T01 and T03 closes rollout. This can precede unrelated 6D/6F/cleanup acceptance. It does not change the remaining AC1/AC2/AC3 requirements or allow the Phase 7 pilot to start early. On approval, add the three tasks under FWH-F06 / AC3 and the 6G scope to the whole Phase 6 plan in the same substantive planning adoption; retain other approved scope and accepted results.

## 9. Finite verification and completion

For implementation, add meaningful checks in the existing dashboard/database suites: real server-derived scope and denied foreign/revoked actors; accurate four-area calculation including unknown reads; no WO dependency for first-client/storage setup; optional skip and unsaved navigation; cursor isolation; stale/uncertain save reconciliation; no mutation/provider request from navigation; prior template/WO/package identities unchanged. A new authenticated read requires its real disposable PostgreSQL grants/authorization checks. Run one final required automated suite on the exact runtime head, not repeated full suites for each section.

**One combined changed-UI acceptance walkthrough:** use an existing authorized TEST business/client, inspect exact missing settings, open/edit one relevant setting if needed, leave/resume after reload, and show an optional skip plus attention navigation. Use deterministic browser fixtures for unavailable/foreign/revocation states; do not revoke working Google credentials or create new accounts just to exercise wizard labels. Actual deployment/read parity and one real operator navigation/save/resume observation remain necessary. A new real provider check is needed only if this scope actually changes that boundary; preserving service-only behavior does not reopen accepted delivery tests.

Completion means the center is deployed and available in authorized TEST, an office user can inspect/edit existing settings without a fake job, required progress is accurate for its named scope, optional guide/resume works, unknown/failed states are honest, and existing work/evidence and authorization remain intact. **100% setup is not whole-app completion, production readiness, successful delivery or permission to start a pilot.**

## 10. Planning handoff

- Scope key: `fwh-setup-center-plan-20261117`; branch: `docs/fwh-setup-center-plan-20261117`.
- Current work: Level 1, documentation only; this file and a proposed-plan pointer in `docs/ROADMAP.md`. Runtime implementation will include Level 2 UI and Level 3 status/read/shared-owner boundaries as applicable.
- Rules read: AGENTS, GOVERNANCE, PROJECT_PROFILE, RULE_INDEX, CHANGE_CONTROL, current roadmap Phase 6–8, Phase 6 plan and current Phase 5/6 implementation record; relevant source/SQL inspected. Future runtime must load its mandatory Testing/Integration/staging/shared-access rules in full.
- External changes: GitHub planning branch/PR only. No deployed settings, provider action, APK, source/runtime switch or current construction-task change.
- Overlap: PR #116 remains deferred and owns its delivery UI; this plan owns neither that UI nor the current Phase 5/6 runtime record. Reconcile current main and that record before adoption/implementation.
- Rollback: remove only this proposal and roadmap link, or revert its eventual documentation commit; baseline `976d10357c4abbcf8c29479a498a061693c50ec0`. Never revert business settings or existing receipts as a planning rollback.
- Verification: inspected settings inventory, scoped document/diff/link checks. No runtime/device/provider test performed or required for drafting.
- Next decision: operator review of this complete proposed Phase 6 amendment, particularly required sections, scope-labelled progress and operator-assisted storage verification. No runtime approval inferred from the request to plan.
