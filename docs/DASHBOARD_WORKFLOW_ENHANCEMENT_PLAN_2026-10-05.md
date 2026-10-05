# Field Work Hub — Dashboard Workflow Enhancement Plan — 2026-10-05

Status: **CONSOLIDATED PROPOSAL — DOCUMENTATION ONLY — NOT RUNTIME AUTHORIZATION**

Plan ID: `dashboard-workflow-enhancement-plan`.

## Classification and authoritative line

- Goal: consolidate the operator's dashboard, template, follow-up, photo-review, delivery and optional-alert requirements into the existing FWH roadmap.
- Current change: Level 1 documentation only. Eventual implementation: Level 2/3; assignment/run authority, review storage, notifications, delivery and persisted schemas require individual impact classification.
- Authoritative planning branch: `docs/dashboard-workflow-enhancements`; scope key `dashboard-workflow-enhancement-plan`.
- Baseline / documentation rollback: main `7644fe3e48048d2f2068638494c8ece3348e23fe` (Phase 4 published-smoke closeout, PR #37).
- Preflight: main, open PRs, repository branches, governing contracts, roadmap and Phase 4 closeout inspected. No open PR or Phase 5/6 implementation branch found. Historical branches are not superseded by this proposal.
- Rule packs: AGENTS, GOVERNANCE, PROJECT_PROFILE, RULE_INDEX, CHANGE_CONTROL, TESTING, INTEGRATION, PHASE_STAGING_DOCTRINE and relevant roadmap/Phase 4 records.
- Changed surface: this proposal only. No runtime, deployed configuration, data, permissions, photo retention or original FPP changes.
- Verification: document/contract reconciliation, source readback, no customer/contractor data or credentials. No runtime tests or new physical pass claims.
- Approval state: operator statements establish requested behavior and accepted recommendations. They do not establish approval of a complete replacement Phase 5/6 implementation plan. Existing approved roadmap remains authoritative until a consolidated amendment is approved and integrated.

## Product goal and workflow

The laptop/PC Admin dashboard should support many jobs without an endlessly expanded page. It should carry context and saved decisions from assignment through review and client delivery.

`Find address → choose/create WO → choose/adapt template → assign → contractor performs work → photos become available for review → Admin reviews → internal correction if needed → Admin approves client package → send → confirm delivery`.

Contractor Finish, receipt of photo bytes, photo approval, job/package approval and confirmed client delivery are distinct facts. No transition silently performs a later business action.

## Recommended phase placement

Keep existing phase numbers. Phase 4 remains complete. Use two existing numbered parent phases with all sections planned upfront, rather than reopening Phase 4 or adding an unrelated phase after the pilot.

| Phase / proposed section | Responsibility | Dependency |
| --- | --- | --- |
| Phase 5 — secure evidence transfer and reviewed-delivery foundation | Protected transfer, exact identity, persistent recovery, organization-private Admin-readable review storage and server-authorized final release primitives. | Preserve completed Phase 3/4 behavior. Decide review-storage/destination boundary before implementation. |
| Phase 6A — compact dashboard and job workspace | Search/filters, paged table, address/WO selection, tabs, queues, retained position, truthful status, next actions and existing conflict/cancel controls. | Server facts and Phase 5 readiness; deterministic layout work can be developed independently. |
| Phase 6B — work-type templates and follow-ups | Relevant selectable templates, editable job copies, repeat/new jobs, linked corrective runs, fresh assignment and receipt, original client WO number preserved. | Existing template snapshots/run owners; amendment for pre-client-delivery follow-up. |
| Phase 6C — photo review and correction loop | Category gallery, bulk/individual decisions, reasons, one correction request, returned-photo review. | Secure review bytes from Phase 5 and corrective-run authority from 6B. |
| Phase 6D — final client package and sending | Preview approved selection, selected destination, explicit job/package approval and Send, confirmation/failure/reconciliation. | Review from 6C; Phase 5 owns transfer/delivery identity and retry mechanics. |
| Phase 6E — optional alerts and notifications | Dashboard alerts, per-type phone/computer preferences, timings, quiet hours, deduplication, snooze and links to affected work. | Stable business events from earlier sections. Each device/channel needs its own truthful support boundary. |
| Phase 7 — internal real-world pilot | Exercise the entire updated workflow with safe jobs before live expansion. | Updated Phase 5/6 completion evidence. |
| Phase 8 — production readiness / small HNP pilot | Production notification/storage configuration, access/revocation, retention and controlled deployment. | Retain existing production gates; do not use them to postpone required Phase 5/6 protection. |

Sections organize coherent implementation batches and evidence, not repeated plan approvals. Notification mechanics are separable from layout and review and come last within the fully planned Phase 6 parent. Phase 5 must include a controlled Admin release test surface/API so its delivery protection can be proven before the richer Phase 6 UI exists.

## Compact dashboard and address/WO workspace

- Search/filter by company, address/WO number, contractor, status and due date; sortable concise rows with stable pagination (25/50 page sizes proposed).
- Keep essential columns readable: address, company, work type, client WO number, contractor, due date and operational status. Sticky headings; bounded table scrolling.
- Selecting an address opens one large workspace containing its WOs and history. Selecting a WO changes the workspace content; do not stack address, WO and template dialogs.
- Tabs: Details, Assignment, Requirements, Review, Delivery and History. Keep address/client WO identity visible.
- Show one primary next action appropriate to server-confirmed state; keep other legitimate actions reachable.
- Preserve filters, sort/page/scroll and safely saved draft/review decisions when closing or moving to the next job. Surface save failures and stale-edit conflicts; do not claim saved from browser memory alone.
- Queues/counts: Needs assignment, Awaiting acceptance where enabled, In progress, Overdue, Finished—photos pending, Awaiting review, Follow-up pending, Ready to send, Delivery problem, Completed and other Problems.
- Unsynchronized phone-only evidence is unknown to the dashboard, never assumed absent or successfully received. Display last refresh/stale connectivity truth when relevant.
- Keep historical Complete searchability and current conflict/reassignment/cancel protection. Alerts never replace the underlying job problem state.

## Work orders, templates and follow-ups

Address is a navigation grouping, not photo/WO identity. Group only within the authorized organization/company. Do not merge different properties or companies because address text happens to match; uncertain address matches require a deliberate choice. A permanent Property entity is not automatically required.

The Admin selects an existing WO or creates new work, then chooses its previously used template, another relevant work-type template, or Custom/New. Several WOs at one address may use different templates; a repeated work type may also have several selectable templates. Template relevance must not become a restrictive lock.

A template contains work description/instructions and the existing flat photo-item requirements. Every item/count/instruction remains configurable for a new dispatch. Applying a template copies values into a run snapshot; editing the job does not silently edit the reusable template. Explicit actions save a new template or update future defaults. Old snapshots/history remain intact.

Follow-up keeps the same permanent Team WO and external client WO number, but creates a new run UUID and clear contractor label/reason. Admin chooses an eligible contractor and due date, with fresh assignment receipt and zero new-run capture counters. Previous photos do not satisfy the new run's capture requirements.

Distinguish internal corrections before client delivery from client-requested corrections after a sent package. Either retains prior run history. Ordinary repeat work carrying a new client order is a new WO, not automatically a corrective run. A completed address can offer follow-up, repeat using prior template, or new work/template without forcing one choice.

A corrective run should contain only the new work/photos actually requested. It need not reapply the original full template. The final client package may include approved original and corrective-run photos; their original immutable identities and category provenance are preserved.

Templates remain editable, but dispatched offline/started run requirements cannot be silently rewritten. Existing Start freeze, revision races and protected evidence remain authoritative pending any explicit amendment. Further requested work uses a deliberate new run/revision path; no generic requirement bypass is introduced.

## Photo review and correction loop

- Group photos by captured requirement item, preserving Before/During/After distinctions. Extra photos remain separate; one photo cannot earn multiple item credits.
- Show thumbnails, full-size inspection and next/previous navigation with visible review status. Offer Approve selected and Approve all remaining, plus individual decisions.
- Review decision is separate from upload state: Pending review, Approved or Rejected. A rejected photo is excluded from release and retained under the applicable evidence/retention policy; rejection does not authorize deletion.
- Record a rejection reason when contractor action is requested. Allow Admin decision changes with history; reviewed content/version must still match the displayed photo.
- Collect problems during review, then send one checked correction request with affected items, reasons, required new photos, assignee and due date. Flagging a photo does not itself dispatch a new assignment.
- Rejecting surplus/duplicate/irrelevant evidence need not force a return visit. Admin explicitly decides whether a follow-up is necessary.
- On return, show new/replacement evidence first. Existing approvals persist only for unchanged evidence; changed selected content invalidates affected package approval.
- Keep captured counts and approved package coverage separate. Rejection never rewrites a previously accepted contractor Finish. Define coverage checks against job requirements and corrective-run requirements without double-counting a photo or using old photos to satisfy a new run's capture minimum.
- Keep final package photo selection separate from original frozen Finish manifests; review does not mutate capture identity or frozen evidence membership.

## Review storage and final client delivery

The approved roadmap currently delivers every frozen photo directly to the HNP archive, then derives Complete. The requested review-before-client-view workflow materially changes that boundary.

Phase 5 must distinguish protected inbound evidence/review availability from client release. Unreviewed or rejected photos and internal correction comments must not become visible to clients through destination-folder sharing, reports or live links.

Design and validate an organization-private staging/review destination and Admin-authorized retrieval before selecting its implementation. It can reuse a verified private company-controlled boundary if permissions prove that clients cannot see it. Do not assume that an HNP folder is private or that review is possible from metadata without uploaded bytes. Backend remains the owner of storage authorization; clients never receive reusable company secrets.

A frozen, revisioned client-package manifest records selected approved photo UUIDs across eligible runs, client-facing notes, exact authorized destination, approval and delivery outcome. Package approval and Send are separate actions. Sending uses the same identity on retry; success requires confirmed provider results and durable bookkeeping. Ambiguous outcome becomes unresolved, not a blind resend or success.

Preview exactly what the client receives. Internal visit labels/rejection comments stay internal unless intentionally included as client-facing information. A correction before first delivery produces one initial client submission under the original number; a client return creates a deliberate corrected package/revision with earlier delivery history preserved.

Destination selection should initially be limited to configured, verified destinations. Existing HNP Drive is the baseline. Additional storage providers, email/report output or automatic client-portal submission require a defined interface, authentication, permission and provider gate; they are not implied by a dropdown.

Rejected photos still require a safe resolved retention path so they do not block the original all-photos-delivered Complete rule forever. Separate durable private evidence receipt from client delivery eligibility. Define cleanup/retention before implementation; preserve originals until the governing confirmation and durable-bookkeeping conditions are met. Do not let review status alone trigger deletion or strand required evidence only on a contractor phone.

## Selectable alerts and device notifications

Each type has independent Dashboard, Phone and Computer on/off choices. Admin may choose any combination. Configure per Admin and enrolled device; notifications are optional and do not resolve issues or change job authority.

Types: finished/awaiting review; assignment awaiting acceptance; acceptance reminder after selected time; overdue job; follow-up awaiting review; upload failed/stalled; sync/assignment/cancellation conflict or app problem needing intervention; final delivery failure.

- Finished—uploads pending and Ready for review are different events.
- Receipt means durable app download, not a person's acceptance. If explicit Accept is added, give it its own server fact/action and fresh assignment-instance identity. Never label a download as Accepted.
- Acceptance timing, due-date changes, reminder timing and quiet hours use clear timezone rules. Cancel/reassign/complete invalidates obsolete reminders.
- Group/deduplicate by issue, assignment/run and event. Repeated refresh/retry does not flood devices. One alert acknowledgment is not resolution.
- Snooze affects interruption, not the underlying status. Resolution clears active alerts based on verified facts; retain needed history.
- Clicking opens the relevant authorized WO/problem. Recheck sign-in/org/role; notifications and lock-screen text should avoid unnecessary customer details.
- Permission denied, unsupported channel, offline/unregistered device, expired endpoint and revoked Admin access are visible settings/delivery conditions. Failed optional notifications do not lose the job or block safe field work.
- Distinguish local in-browser desktop alerts from background push when the dashboard is closed. Do not promise closed-browser or locked-phone delivery until the selected mechanism is verified on supported devices.

## Failure behavior and protected boundaries

Supabase owns organization/role/assignment/run, review and release authority. Existing Room/capture/sync owners retain local work and immutable evidence. UI renders and requests actions rather than becoming another identity, retry, conflict or upload owner.

Use additive schemas and narrow authorized operations. Wrong-org/role reads, photo access, template changes, reviews, follow-ups, notifications and release attempts must fail on the server. Account/role changes revoke access and old device subscriptions. Preserve offline evidence on stale edits, reassignment/cancellation and failed transfer.

Navigation cannot auto-approve, dispatch, release, delete or resolve conflicts. Failure leaves the action pending/problematic with actionable explanation; unrelated safe work can continue. Concurrent Admin changes require revision checks and preserve history. Original FPP remains untouched.

## Verification and completion boundaries for the eventual amendments

Before coding, replace/augment the complete numbered Phase 5 and Phase 6 plans, not just their next letter. Define exact storage/authorization, persistence, APIs, migrations, rollback, notification support and retained evidence policy for all included sections. Do not label this proposal as that completed implementation design.

Automated boundaries: organization/role isolation; template-copy/history invariants; follow-up/run identity and idempotency; fresh receipt versus acceptance; freeze/revision/offline races; review/bulk decisions; captured versus approved coverage; package revision/approval invalidation; private staging and release guards; retry-safe versus uncertain provider results; no false Complete; notification event deduplication/quiet hours/revocation and stale reminders; unrelated-job independence.

Combined genuine gates, selected in the complete plans:

1. Phase 5 phone/provider: disposable offline captures survive restart/interruption, exact private review bytes become Admin-readable, clients cannot access them, authorized release confirms exact selected destination without duplicates, cleanup respects retained evidence.
2. Phase 6 laptop/phone: address/WO/template → assign → completed evidence review → selective correction → fresh contractor follow-up → review returned photos → one approved client package → confirmed delivery; history and rejected/internal evidence stay correct. Prove paged navigation and retained context with representative synthetic job/photo volumes.
3. Phase 6 notification devices: selected alert reaches configured phone/computer, denied/offline/disabled cases are truthful, quiet hours/deduplication work, click opens the right authorized job, and closed-browser/locked-phone support is tested only if promised.

Build independent automated-testable work first; combine compatible real checks; do not repeat Phase 4 camera/freeze evidence merely because the layout changes. Focused checks during implementation, one final complete suite on the exact runtime head, and required Level 3 pre-merge approval remain in force.

Completion: Phase 5 establishes secure recoverable review transfer and guarded provider delivery; Phase 6 lets Admin move through the whole workflow without losing context, conflating receipt/completion/approval/delivery, exposing rejected/private material or hiding unresolved problems. Selected notifications must satisfy the explicitly supported channel gates. Update Phase 7 pilot scenarios and Phase 8 production configuration/retention checks accordingly.

## Decisions to settle in the complete Phase 5/6 amendment

1. First client-delivery destination(s): configured HNP Drive only, other selected storage, report/email output or client-system submission. Do not guess access/integration support.
2. Whether personal contractor acceptance is required before Start or is an acknowledgment/reminder feature; current durable download receipt stays separate either way.
3. Private review storage/access and retention of rejected evidence, package selection/coverage across runs, supported notification mechanism and device enrollment. These require source/provider reconciliation and concrete implementation design, not speculative product promises.

Next checkpoint: review this consolidated placement and settle the first destination and acceptance policy, then finish one consolidated whole-phase amendment before runtime changes. Preserve all accepted Phase 4 results and existing production data.
