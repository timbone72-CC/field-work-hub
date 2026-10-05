# Field Work Hub — Dashboard Workflow Enhancement Plan — 2026-10-05

Status: **APPROVED COMBINED PRODUCT PROPOSAL + COMPLETE PHASE 5/6 PLANS — DOCUMENTATION ONLY — NOT IMPLEMENTED**

Plan ID: `dashboard-workflow-enhancement-plan`.

## Classification and authoritative line

- Goal: combine the October 3 private-holding/review/selectable-storage proposal with the October 5 dashboard, template, follow-up, photo-review, acknowledgment, delivery and optional-alert requirements, with explicit Phase 5/6 boundaries.
- Current change: Level 1 documentation only. Eventual implementation: Level 2/3; assignment/run authority, review storage, notifications, delivery and persisted schemas require individual impact classification.
- Authoritative planning branch: `docs/dashboard-workflow-enhancements`; scope key `dashboard-workflow-enhancement-plan`.
- Baseline / documentation rollback: main `7644fe3e48048d2f2068638494c8ece3348e23fe` (Phase 4 published-smoke closeout, PR #37).
- Preflight: main, open PRs, repository branches, governing contracts, roadmap and Phase 4 closeout inspected. No open PR or Phase 5/6 implementation branch found. Historical branches are not superseded by this proposal.
- Rule packs: AGENTS, GOVERNANCE, PROJECT_PROFILE, RULE_INDEX, CHANGE_CONTROL, TESTING, INTEGRATION, PHASE_STAGING_DOCTRINE and relevant roadmap/Phase 4 records.
- Changed surfaces: this proposal, complete Phase 5/6 implementation amendments and the applied roadmap amendment register, integration/testing contracts, project profile and storage-rule routing. No runtime, deployed configuration, data, permissions, photo retention or original FPP changes.
- Verification: document/contract reconciliation, source readback, no customer/contractor data or credentials. No runtime tests or new physical pass claims.
- Approval state: operator approved both complete numbered Phase 5/6 amendments and their merge on **2026-10-05 at 16:32:14 America/Chicago (21:32:14 UTC)**, stating “i approve phase 5 and 6 amendments to be merged”. Reviewed plan revision 1 at `d4dc223f6c3d6df416ae0441a9c2565d8eaee87c`; approval and governing replacements are integrated through PR #38. One approval covers 5A–5E and 6A–6E within unchanged scope; runtime completion and Level 3 pre-merge approval remain separate.

## Reconciliation of the earlier proposal

The October 3 conversation at approximately 18:17 America/Chicago proposed: phone photos enter a secure holding area, dashboard displays them by WO, Admin reviews, Admin chooses Send to storage, company-default destination is changeable by Admin, Review required is an Admin-controlled per-WO toggle, and phone originals remain protected until confirmed final delivery. That conversation did not establish replacement phase numbering or completed implementation-plan approval.

The October 5 proposal extends that same workflow with a compact address/WO workspace, flexible work-type templates, same-client-WO corrective runs, individual/bulk photo decisions, client package preview, explicit Accept acknowledgment and selectable dashboard/phone/computer alerts. This document is the single combined product proposal on the existing authoritative planning branch; no competing plan is created.

Resolved here: carry forward the review toggle, make private receipt insufficient for phone-original cleanup, and give Phase 5 a usable minimum review-and-send workflow. Phase 6 extends that workflow rather than retrofitting its security boundary. The operator approved the completed Phase 5/6 designs and their concrete defaults on 2026-10-05. Their governing replacements are applied to the roadmap/contracts; provider/device evidence remains a future implementation gate.

## Product goal and workflow

The laptop/PC Admin dashboard should support many jobs without an endlessly expanded page. It should carry context and saved decisions from assignment through review and client delivery.

`Select company/address → choose/create WO → choose/adapt template → assign → contractor taps Accept to acknowledge → contractor starts/performs work → photos enter private holding area → Admin reviews when required → internal correction if needed → Admin approves client package → send to configured destination → confirm delivery`.

Assignment download receipt, contractor acknowledgment, Start, contractor Finish, receipt of photo bytes, photo approval, job/package approval and confirmed client delivery are distinct facts. No transition silently performs a later business action.

## Operator decisions — 2026-10-05

The operator clarified at 15:51:45 America/Chicago:

- FWH is a universal multi-company workflow, not an HNP-only product. Companies, work types, templates and authorized delivery destinations are configurable; HNP is one possible client configuration.
- A contractor tapping **Accept** is the acknowledgment. Accept is separate from durable download receipt and **Start Work**; it does not automatically start work, finish work, approve evidence or send anything to a client. No extra acceptance confirmation screen or new Start prerequisite is requested.

These product decisions are included in the subsequently approved whole-phase plans. Plan approval is not evidence of runtime completion or approval to merge a future Level 3 runtime PR.

## Phase placement and complete implementation amendments

Detailed plans: [Phase 5 — private review and controlled delivery](PHASE_5_IMPLEMENTATION_PLAN_2026-10-05.md) and [Phase 6 — Admin workflow and optional alerts](PHASE_6_IMPLEMENTATION_PLAN_2026-10-05.md). Each covers all of its lettered sections, authority, APIs, additive migrations, failure/recovery, rollback, automated evidence and genuine device/provider completion boundaries.

Keep existing phase numbers. Phase 4 remains complete. Use two existing numbered parent phases with all sections planned upfront, rather than reopening Phase 4 or adding an unrelated phase after the pilot.

| Phase / proposed section | Responsibility | Dependency |
| --- | --- | --- |
| Phase 5 — private holding, minimum Admin review and controlled delivery | Protected transfer/recovery, organization-private Admin-readable photos, per-WO Review required, basic photo decisions, package approval/preview, company-default destination override, explicit Send and confirmed final delivery/cleanup protection. | Preserve Phase 3/4 behavior. Complete the whole storage/review/release plan and provider boundaries first; no automatic client exposure. |
| Phase 6A — compact dashboard and job workspace | Search/filters, paged table, address/WO selection, tabs, queues, retained position, truthful status, next actions and existing conflict/cancel controls. | Server facts and Phase 5 readiness; deterministic layout work can be developed independently. |
| Phase 6B — work-type templates and follow-ups | Configurable companies/work types/templates, editable job copies, repeat/new jobs, linked corrective runs, fresh assignment receipt and explicit Accept acknowledgment, original client WO number preserved. | Existing template snapshots/run owners; amendment for pre-client-delivery follow-up. |
| Phase 6C — efficient photo review and correction loop | Extend Phase 5 decisions with category gallery, bulk approval, one correction request, returned-photo-first review and integrated follow-up navigation. | Secure review bytes from Phase 5 and corrective-run authority from 6B. |
| Phase 6D — integrated final client package and sending | Extend Phase 5 preview/approval/Send with selection across corrective runs, polished job-window navigation and delivery history; use the same guarded delivery/reconciliation owner. | Review from 6C; Phase 5 owns transfer/delivery identity and retry mechanics. |
| Phase 6E — optional alerts and notifications | Dashboard alerts, per-type phone/computer preferences, timings, quiet hours, deduplication, snooze and links to affected work. | Stable business events from earlier sections. Each device/channel needs its own truthful support boundary. |
| Phase 7 — internal real-world pilot | Exercise the entire updated workflow with safe jobs before live expansion. | Updated Phase 5/6 completion evidence. |
| Phase 8 — production readiness / small configured-company pilot | Production company/destination/notification configuration, access/revocation, retention and controlled deployment. HNP may be a pilot configuration, not product-wide identity. | Retain existing production gates; do not use them to postpone required Phase 5/6 protection. |

Sections organize coherent implementation batches and evidence, not repeated plan approvals. Notification mechanics come last within the fully planned Phase 6 parent.

### Phase 5 minimum usable workflow

Plan all sections upfront: 5A configurable company destination/private-holding authorization; 5B protected recoverable photo transfer; 5C minimum Admin WO photo viewer, Review required setting and individual include/approve/reject decisions; 5D immutable package preview/approval, company-default destination override and explicit Send/confirmation; 5E retention, cleanup/recovery and one combined device/provider gate. These are implementation sections of one numbered phase.

Phase 5 must finish with a usable Admin review-and-send path, not only a backend/API fixture. Use the current dashboard's existing WO surface for this minimum UI; Phase 6 reorganizes and improves the experience through its compact workspace, efficient review, integrated follow-ups and alerts. Keep one shared review/package/delivery owner and authorization model. Do not build two engines or temporarily publish unreviewed photos while waiting for Phase 6.

## Compact dashboard and address/WO workspace

- Search/filter by company, address/WO number, contractor, status and due date; sortable concise rows with stable pagination (25/50 page sizes proposed).
- Keep essential columns readable: address, company, work type, client WO number, contractor, due date and operational status. Sticky headings; bounded table scrolling.
- Selecting an address opens one large workspace containing its WOs and history. Selecting a WO changes the workspace content; do not stack address, WO and template dialogs.
- Tabs: Details, Assignment, Requirements, Review, Delivery and History. Keep address/client WO identity visible.
- Show one primary next action appropriate to server-confirmed state; keep other legitimate actions reachable.
- Preserve filters, sort/page/scroll and safely saved draft/review decisions when closing or moving to the next job. Surface save failures and stale-edit conflicts; do not claim saved from browser memory alone.
- Queues/counts: Needs assignment, Awaiting acknowledgment, In progress, Overdue, Finished—photos pending, Awaiting review, Follow-up pending, Ready to send, Delivery problem, Completed and other Problems. Reminder/notification preferences remain optional; assignment acknowledgment is a separate fact.
- Unsynchronized phone-only evidence is unknown to the dashboard, never assumed absent or successfully received. Display last refresh/stale connectivity truth when relevant.
- Keep historical Complete searchability and current conflict/reassignment/cancel protection. Alerts never replace the underlying job problem state.

## Work orders, templates and follow-ups

Client company is a configurable business context within the Admin's authorized organization, not a substitute for the organization/tenant security boundary. Work types, template choices/defaults and authorized delivery settings must support different client companies without hard-coded HNP names, requirements, folder roots or credentials. Template applicability may include organization-wide options as well as company-specific defaults; keep a flat list and per-job editability.

Address is a navigation grouping, not photo/WO identity. Group only within the authorized organization/company. Do not merge different properties or companies because address text happens to match; uncertain address matches require a deliberate choice. A permanent Property entity is not automatically required.

The Admin selects an existing WO or creates new work, then chooses its previously used template, another relevant work-type template, or Custom/New. Several WOs at one address may use different templates; a repeated work type may also have several selectable templates. Template relevance must not become a restrictive lock.

A template contains work description/instructions and the existing flat photo-item requirements. Every item/count/instruction remains configurable for a new dispatch. Applying a template copies values into a run snapshot; editing the job does not silently edit the reusable template. Explicit actions save a new template or update future defaults. Old snapshots/history remain intact.

Follow-up keeps the same permanent Team WO and external client WO number, but creates a new run UUID and clear contractor label/reason. Admin chooses an eligible contractor and due date, with fresh assignment receipt, fresh contractor acknowledgment and zero new-run capture counters. Previous photos do not satisfy the new run's capture requirements.

Distinguish internal corrections before client delivery from client-requested corrections after a sent package. Either retains prior run history. Ordinary repeat work carrying a new client order is a new WO, not automatically a corrective run. A completed address can offer follow-up, repeat using prior template, or new work/template without forcing one choice.

A corrective run should contain only the new work/photos actually requested. It need not reapply the original full template. The final client package may include approved original and corrective-run photos; their original immutable identities and category provenance are preserved.

Templates remain editable, but dispatched offline/started run requirements cannot be silently rewritten. Existing Start freeze, revision races and protected evidence remain authoritative pending any explicit amendment. Further requested work uses a deliberate new run/revision path; no generic requirement bypass is introduced.

## Contractor Accept acknowledgment

The contractor sees **Accept** on a new assignment; one tap durably records acknowledgment for that exact authenticated contractor and assignment/run instance. **Start Work** remains a separate existing action. Do not add a new durable field state merely to display Accepted; retain the acknowledged timestamp alongside download receipt and the existing run state.

Show Admin facts distinctly: Assigned, Downloaded/received, Acknowledged (contractor-facing Accepted), and Started. Durable download alone never produces an Accepted label. Reassignment, redispatch or a follow-up requires a fresh acknowledgment; a previous contractor/run acknowledgment is history only.

Offline acknowledgment persists in the existing owner-scoped local/action system before the app says it is saved, survives restart and synchronizes idempotently. The phone distinguishes pending sync from server-confirmed acknowledgment. Admin cannot know an unsynchronized tap; show only server-confirmed facts and relevant freshness. Stale or no-longer-authorized acknowledgments preserve evidence and surface the existing conflict boundary rather than accepting the wrong assignment.

Acceptance reminders may use the acknowledgment fact and configurable elapsed time. They remain optional, stop when resolved/reassigned/cancelled, and never claim that the human has not acknowledged solely because the phone is offline. This proposal does not introduce a mandatory Accept-before-Start block.

## Per-work-order Review required

Restore the October 3 Admin-controlled on/off setting. Approved default is **On** for new WOs. Save an explicit per-WO value; template/company defaults may suggest it but never silently change existing work. Record an Admin change with its reason/history and revision. The setting is unrelated to contractor photo-count enforcement or phone camera requirements.

- **On:** photos selected for the client package must have valid Admin approval; pending or rejected photos cannot be released. Individual and bulk approval are available as their respective phase UI is implemented.
- **Off:** individual photo-by-photo approval is optional. Admin may select eligible received photos without marking them individually Approved; label the package **Individual photo review not required**. Already rejected photos stay excluded unless Admin deliberately changes their decision. No false approval timestamp or claim is created.
- Both modes still require authorized Admin package approval and an explicit **Send** action. Turning review off never sends automatically, bypasses required capture/coverage, reveals private staging, erases a rejection, resolves a conflict or permits uncertain/missing evidence.
- Changing the setting invalidates any affected unsent package approval. An in-flight/sent manifest remains immutable; use a controlled new revision after reconciliation rather than altering a delivery already underway.

This defines the off path narrowly without adding a second automatic-delivery mode. The approved Phase 5 plan specifies revision races and package eligibility; implementation must verify them consistently.

## Photo review and correction loop

- Group photos by captured requirement item, preserving Before/During/After distinctions. Extra photos remain separate; one photo cannot earn multiple item credits.
- Show thumbnails, full-size inspection and next/previous navigation with visible review status. Offer Approve selected and Approve all remaining, plus individual decisions.
- Review decision is separate from upload state: Pending review, Approved or Rejected. Review-required Off permits explicitly selected pending-review photos without inventing approval. A rejected photo is excluded from release and retained under the applicable evidence/retention policy; rejection does not authorize deletion.
- Record a rejection reason when contractor action is requested. Allow Admin decision changes with history; reviewed content/version must still match the displayed photo.
- Collect problems during review, then send one checked correction request with affected items, reasons, required new photos, assignee and due date. Flagging a photo does not itself dispatch a new assignment.
- Rejecting surplus/duplicate/irrelevant evidence need not force a return visit. Admin explicitly decides whether a follow-up is necessary.
- On return, show new/replacement evidence first. Existing approvals persist only for unchanged evidence; changed selected content invalidates affected package approval.
- Keep captured counts and approved package coverage separate. Rejection never rewrites a previously accepted contractor Finish. The Phase 6 plan defines explicit release-item mappings and coverage against final job goals plus selected new-run correction minima, without double-counting a photo or using old photos to satisfy a new run's capture minimum.
- Keep final package photo selection separate from original frozen Finish manifests; review does not mutate capture identity or frozen evidence membership.

## Review storage and final client delivery

The earlier roadmap delivered every frozen photo directly to the HNP archive, then derived Complete. The approved amendment replaces that path with private holding, Admin review/package approval and explicit client release.

Phase 5 must distinguish protected inbound evidence/review availability from client release. Photos in private staging never become client-visible automatically. Pending-review photos cannot be released when Review required is On. With Review required Off, Admin may explicitly approve and send a package containing eligible selected photos not individually reviewed. Rejected photos and internal correction comments remain excluded unless deliberately changed or intentionally included as authorized client-facing notes.

Use a private Supabase holding bucket in the existing FWH environment, with immutable org/WO/run/photo paths, narrowly authorized resumable contractor upload and short-lived Admin read access. Backend verification of actual prepared JPEG bytes creates the review receipt; metadata alone cannot. Holding is separate from final company storage and has no public/client access or automatic client release. The whole-phase plan defines exact authorization, private retained evidence and recovery. Provisioning and real access tests are future runtime gates, not already-completed work. Clients never receive reusable company secrets.

A frozen, revisioned client-package manifest records selected eligible photo UUIDs across eligible runs, applicable review-required setting and review decisions, client-facing notes, exact authorized destination, package approval and delivery outcome. Required individual approvals must match the exact selected photos/revisions; Review required Off is recorded explicitly rather than falsifying those approvals. Package approval and Send are separate actions. Sending uses the same identity on retry; success requires confirmed provider results and durable bookkeeping. Ambiguous outcome becomes unresolved, not a blind resend or success.

Preview exactly what the client receives. Internal visit labels/rejection comments stay internal unless intentionally included as client-facing information. A correction before first delivery produces one initial client submission under the original number; a client return creates a deliberate corrected package/revision with earlier delivery history preserved.

Destination selection is company-configurable and limited to supported, verified destinations. Each company has a configured default; Admin may choose another authorized supported destination for the WO/package before approval and Send. Google Drive is the first supported final provider because it already appears in the roadmap; its authorized account/root/folder settings belong to the selected organization/client-company configuration rather than a global HNP constant. Delivered package folders stay stable across later contractor changes. Other providers remain separately scoped integrations. HNP can be one configured company; the same core workflow must accommodate other companies and destinations without an HNP-specific build.

Keep work-order/run/review/package logic independent of provider details through the single existing delivery owner and a narrow provider-facing boundary. Bind each package/attempt to its exact authorized configured destination; changing a company default must not redirect an in-flight retry. Template labels, external WO numbers and address matches never authorize cross-company delivery or shared access.

Universal design does not imply that every storage provider or client portal is already integrated. Each additional provider, email/report output or client-system submission needs a concrete supported delivery method, authorization and provider gate. Do not invent a generic integration framework or promise unsupported delivery choices. The roadmap/contract clauses are amended in PR #38. Actual provider configuration and source/live parity are verified during the governed runtime gates.

### Phone-original protection and retained rejected evidence

Carry forward the October 3 rule explicitly: **phone originals remain protected until the applicable final client package is confirmed delivered and local/server bookkeeping is durably recorded**. Private staging receipt, field completion, review approval, package approval, pressing Send, a notification or an ambiguous provider result is insufficient for automatic cleanup. Originals remain recoverable through interruption/restart and internal follow-up review; storage pressure never authorizes early deletion.

A package may exclude rejected or unselected photos. Such photos are not falsely marked delivered to the client. Before their phone bytes can become cleanup-eligible after final package confirmation, verify durable private retention of their evidence/identity under the approved rejected-evidence policy. Preserve rejection/selection/history and remote identity. If those conditions are unresolved, retain bytes and surface the problem; no indefinite blind retry or destructive workaround. The whole-phase policy retains all verified prepared JPEG evidence and identity/history privately with automatic holding purge disabled through the internal pilot. Phone originals on rejected-only, cancelled, never-sent or conflicted work without delivered closure remain protected and visible as held evidence; no hidden force-delete or fake-delivery path is introduced. Production retention/export/deletion requires the existing Phase 8 gate.

The detailed plan defines per-photo private retention and per-package client-delivery eligibility separately so excluded surplus photos do not permanently block the old all-photos-client-delivered Complete rule. Completion must reflect the current authorized work, package coverage/approval, confirmed final delivery and absence of unresolved protected conflicts. These are explicit amendments to the original roadmap/cleanup rules, not already-implemented behavior.

## Selectable alerts and device notifications

Each type has independent Dashboard, Phone and Computer on/off choices. Admin may choose any combination. Configure per Admin and enrolled device; notifications are optional and do not resolve issues or change job authority.

Types: finished/awaiting review; assignment awaiting acceptance; acceptance reminder after selected time; overdue job; follow-up awaiting review; upload failed/stalled; sync/assignment/cancellation conflict or app problem needing intervention; final delivery failure.

- Finished—uploads pending and Ready for review are different events.
- Receipt means durable app download. Tapping Accept is the human acknowledgment, recorded separately for the exact current assignment. Never label a download as Accepted or send an acceptance reminder after server-confirmed acknowledgment.
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

The linked Phase 5 and Phase 6 amendments supply the complete numbered-phase designs, including exact storage/authorization, persistence, APIs, migrations, rollback, notification support and retained evidence policy. Parent-phase approval is recorded and explicit roadmap/contract replacements are applied through PR #38. This product proposal explains the workflow; the linked approved plans govern its detailed implementation.

Automated boundaries: organization/role isolation; template-copy/history invariants; follow-up/run identity and idempotency; fresh receipt versus Accept acknowledgment, offline acknowledgment recovery/idempotency and stale-assignment rejection; configured-company/destination separation; freeze/revision/offline races; review/bulk decisions; captured versus approved coverage; package revision/approval invalidation; private staging and release guards; Review required On/Off eligibility, rejection persistence, no automatic send and setting-change approval invalidation; staging receipt cannot authorize original cleanup; excluded-photo private retention; retry-safe versus uncertain provider results; no false Complete; notification event deduplication/quiet hours/revocation and stale reminders; unrelated-job independence.

Combined genuine gates, selected in the complete plans:

1. Phase 5 laptop/phone/provider: disposable offline captures survive restart/interruption; exact private review bytes become Admin-readable while clients cannot access them; demonstrate Review required On and Off without automatic sending or false photo approval; override a configured company destination before Send; authorized release confirms the exact selected destination without duplicates; verify phone originals survive private staging/review and become cleanup-eligible only after confirmed final delivery plus durable bookkeeping/private retention.
2. Phase 6 laptop/phone: configured company/address/WO/template → assign → contractor Accept acknowledgment distinct from Start → completed evidence review → selective correction → fresh contractor follow-up → review returned photos → one approved client package → confirmed delivery; history and rejected/internal evidence stay correct. Prove paged navigation and retained context with representative synthetic job/photo volumes.
3. Phase 6 notification devices: selected alert reaches configured phone/computer, denied/offline/disabled cases are truthful, quiet hours/deduplication work, click opens the right authorized job, and closed-browser/locked-phone support is tested only if promised.

Build independent automated-testable work first; combine compatible real checks; do not repeat Phase 4 camera/freeze evidence merely because the layout changes. Focused checks during implementation, one final complete suite on the exact runtime head, and required Level 3 pre-merge approval remain in force.

Completion: Phase 5 establishes secure recoverable private holding, a usable minimum Admin review/setting/package approval/Send workflow, confirmed configured-destination delivery and final-delivery-gated original protection; Phase 6 lets Admin move through the whole workflow without losing context, conflating receipt/completion/approval/delivery, exposing rejected/private material or hiding unresolved problems. Selected notifications must satisfy the explicitly supported channel gates. Update Phase 7 pilot scenarios and Phase 8 production configuration/retention checks accordingly.

## Resolved implementation choices and next checkpoint

| Topic | Concrete combined decision | Governing detail |
| --- | --- | --- |
| Private review | Private Supabase holding, actual byte verification, exact owner/Finish authority, short-lived Admin access; no client exposure. | Phase 5 sections 2–5 |
| Final destination | Configurable same-company Google Drive account/root, default/override, frozen package destination, stable WO/package folders and duplicate-safe IDs. | Phase 5 sections 2, 3 and 7 |
| Review toggle | New WO default On; Off permits selected non-rejected pending photos without false individual approval. Both require package approval and explicit Send. | Phase 5 sections 6–7 |
| Retention and cleanup | Prepared evidence remains private with no automatic pilot purge. Originals stay until final delivery, durable bookkeeping and applicable retention/closure; never-sent/cancelled evidence is held. | Phase 5 section 8 |
| Follow-ups and coverage | Same client WO/WO UUID, new run/assignment, zero new capture counts; internal correction before first delivery, client return after it; explicit release-item mappings. | Phase 6 sections 3–5 |
| Accept | One durable tap, separate from download/Start; existing action owner handles offline idempotent exact-instance acknowledgment. No mandatory Start gate. | Phase 6 section 3 |
| Phone/computer alerts | Optional Web Push to enrolled supported Android Chrome and desktop Chrome/Edge, generic private payload, per-type/channel settings, timing/quiet hours and truthful delivery limits. | Phase 6 section 6 |
| Phase attachment | Keep 4 complete; one complete plan for each of 5 and 6, updated 7 pilot and 8 production configuration/retention gates. | Both phase plans and roadmap register |

The user-requested product direction is preserved. Concrete defaults, retention behavior, first supported provider and notification mechanism are approved and recorded rather than left as unfinished implementation choices. Current storage/provider/device inspection and future physical evidence are distinguished explicitly.

Next checkpoint after the authorized planning merge: begin Phase 5 implementation preparation under its complete approved plan, with one authoritative runtime line and impact/recovery record. Proceed through its included sections within unchanged scope; do not ask again for letter-level plan approval or repeat accepted Phase 4 gates. This documentation merge does not itself implement or publish the new workflow.
