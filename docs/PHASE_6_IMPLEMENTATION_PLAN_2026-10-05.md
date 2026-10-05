# Field Work Hub — Phase 6 implementation amendment — 2026-10-05

Status: **APPROVED WHOLE-PHASE PLAN / PLANNED — NOT IMPLEMENTED / NO RUNTIME CHANGES**.

Operator approval: **2026-10-05 at 16:32:14 America/Chicago (21:32:14 UTC)**. The operator explicitly stated: “i approve phase 5 and 6 amendments to be merged”. Approval covers revision 1 of both complete numbered parent-phase plans reviewed at `d4dc223f6c3d6df416ae0441a9c2565d8eaee87c`, including 5A–5E and 6A–6E, and merge of their documentation amendments through [PR #38](https://github.com/timbone72-CC/field-work-hub/pull/38). This successor records approval and applies the already-defined governing replacements; it does not change the technical design or claim implementation/provider/device PASS. Level 3 runtime pre-merge approval remains separate.

Plan ID: `phase-6-admin-workflow`; revision 1. Sections 6A–6F are one whole numbered parent phase under the baseline plus the approved shared-access amendment. Read with the [combined product proposal](DASHBOARD_WORKFLOW_ENHANCEMENT_PLAN_2026-10-05.md), [Phase 5 plan](PHASE_5_IMPLEMENTATION_PLAN_2026-10-05.md) and [roadmap amendment register](ROADMAP.md#approved-consolidated-phase-56-amendment--2026-10-05).

## Approved shared-access amendment — 2026-10-05

[SUPERVISOR_ACCESS_RECOVERY_AMENDMENT_2026-10-05.md](SUPERVISOR_ACCESS_RECOVERY_AMENDMENT_2026-10-05.md), plan ID `supervisor-access-recovery`, revision 1, was approved **2026-10-05 at 17:40:18 America/Chicago (22:40:18 UTC)** by “review approved”, reviewing `af056da36c5ecbcfac16cb8e1c0b8ce3832754fd` in [PR #39](https://github.com/timbone72-CC/field-work-hub/pull/39). This adds the later material Supervisor/team/recovery scope; the earlier revision-1 approval above remains its separate baseline. Current whole-phase authority is baseline revision 1 plus this approved amendment revision 1. Its section 13 governing replacements are applied in this documentation integration. Runtime remains PLANNED.

Phase 6 includes **6F — Shared access and recovery controls**, integrated with capability/team checks throughout 6A–6E. Active scoped Supervisors use the same assignment/template/correction/review/package/Send owners. Notifications, enrollment, preferences, event lists, worker dispatch and click revalidate active Admin/Supervisor role and current team scope; recovery-only accounts receive no new work alerts. Existing per-user/channel settings and generic payload protection remain.

Read Admin references below as the authorized office workflow where the tier matrix permits delegation; stored actor UUIDs identify the real Admin or Supervisor. The approved tier matrix, exact photo recovery boundaries, owner-only grants, migration/rollback, section 11 verification and Phase 7/8 attachments are part of this whole parent phase. No broad non-Contractor-as-Admin shortcut or shared login is allowed.

## 1. Scope, protected boundaries and dependencies

Deliver a compact Admin workflow from selecting an address through assigning, reviewing, correcting, sending and monitoring jobs, with flexible templates, one-tap contractor acknowledgment and optional device alerts. Use Phase 5's private holding, review decisions, package manifest, provider worker, receipt and cleanup owner; do not create another release engine.

Planning branch: `docs/dashboard-workflow-enhancements`; scope key: `dashboard-workflow-enhancement-plan`. Baseline: main `7644fe3e48048d2f2068638494c8ece3348e23fe`. This revision is Level 1 documentation. Runtime includes Level 2 UI and Level 3 schema/assignment/offline acknowledgment/push authority. One recorded parent-phase approval covers all included sections; explicit Level 3 pre-merge approval is still required. No FPP, package/signer, camera or general field-state redesign. Contractor seat limits remain; the approved shared-access amendment adds owner-controlled Admin/Supervisor allowances and scoped lifecycle authority.

| Section | Build dependency | Boundary before dependent completion |
| --- | --- | --- |
| 6A compact workspace | Existing dashboard/server owners; Phase 5 projections | Stable facts, draft revisions and pagination prove truthful display. Layout can be built independently with synthetic facts. |
| 6B templates, follow-ups, Accept | Existing Phase 4 snapshots; Phase 5 company/private protection | Completed Phase 5 release/protection semantics; real fresh-assignment/offline acknowledgment gate. |
| 6C efficient review/corrections | Phase 5 receipt/review API, 6B corrective-run authority | Exact new-photo decisions and revision-safe correction dispatch. |
| 6D multi-run client package | Phase 5 delivery engine and 6B/6C | Cross-run release coverage and one immutable delivery; no new provider path. |
| 6E optional alerts | Stable verified business facts/events from 5 and 6A–6D; current team/tier/access predicates | Actual supported phone/computer enrollment, permission, scoped revocation and delivery evidence. |
| 6F shared access/recovery | Phase 5 team/access/grant foundations; integrate with 6A–6E and existing Auth/invitation owners | Verified owner binding, all tier/account/handoff boundaries, same-device export and actual TEST recovery-email gate. |

All six sections are planned through this baseline and the approved linked amendment before coding. Independent layout/settings/event-rule work can proceed without repeatedly stopping for letter-level approval. Storage/provider protection cannot be replaced by a notification or postponed to the pilot.

## 2. 6A — Compact dashboard and one job workspace

Use a server-paged table with page sizes 25 and 50, sticky headings, a bounded scroll area and concise columns: address, company, work type, client WO number, assignee, due date and operational status. Search/filter company, address/WO, contractor, status and due date. Sort on explicit whitelisted server fields with UUID tie-breaker. Default order emphasizes unresolved problems, due date and stable identity. Do not download every WO/photo and paginate in JavaScript.

The server list operation returns bounded rows, matching total/counts, current revision and stable cursor. Filters/sort are parameterized, org-scoped and validated; exact counts/queues come from the same predicates as rows. Build needed indexes from the measured query shape, not a speculative search system. Data refresh may move a changed row between queues; keep the selected WO open by UUID and show that it no longer matches the current filter. Never open a different row because its old table position was reused.

Selecting an address opens one large workspace with a compact list of that address's authorized WOs. Selecting a WO changes that workspace; avoid stacked WO/template/photo dialogs. Tabs: **Details, Assignment, Requirements, Review, Delivery, History**. Keep company/address/client WO identity and current run visible. Provide Next/Previous job within the chosen result set, with an explicit end-of-results state. On a narrow phone screen the same workspace becomes a full-page view; no fixed desktop-only pane that requires sideways scrolling.

Address is navigation context. Group within org/company using a conservative normalized address key, retain original text and list explicit WO UUIDs. Do not automatically merge fuzzy matches, different units or clients. An uncertain match is a suggestion requiring deliberate selection. No permanent Property entity solely for layout, and no address text as authorization or photo identity.

Persist non-sensitive filter/sort/page preferences per Admin/org; keep address search text in memory/session rather than a public URL or lock-screen payload. Store server-backed job/package/review drafts by UUID and revision. Closing or switching saves changes before navigation; on save failure offer retry, remain, or explicit discard of unsaved edits. Browser memory cannot be labeled Saved. Auto-refresh updates list facts while preserving focused inputs and unsaved values; stale revisions display Compare/reload rather than silently overwriting them. Sign Out clears visible data, draft access and account-scoped UI state; another account never inherits prior job content.

Use semantic tables/buttons, keyboard opening/tab navigation, labeled controls, focus return and Escape only when safe to close. Thumbnail loading is bounded/lazy; no all-photo DOM for the organization. Start with synthetic acceptance volumes of 1,000 WOs, 50 WOs at one address and 500 photos on one WO to verify bounded fetch/render behavior, not a fabricated production performance promise.

### Truthful status and primary next action

| Server fact | Display / primary action |
| --- | --- |
| Unassigned dispatch | Needs assignment / Assign |
| Assigned, no confirmed human Accept | Awaiting acknowledgment / View assignment |
| Durable device download | Downloaded timestamp, distinct from acknowledgment |
| Acknowledged but not started | Accepted / View assignment |
| IN_PROGRESS | In progress / Open details; due date may also show Overdue |
| Accepted Finish, incomplete private receipts | Field complete — photos pending / View transfer problem/progress |
| Required receipts ready, no releasable package | Awaiting review / Review photos; Off shows Prepare package |
| Open corrective run | Follow-up pending / Open follow-up |
| Eligible package draft | Ready for package approval / Preview |
| Approved current package | Ready to send / Send |
| Queued/partial/uncertain/failed | Sending or Delivery problem / View exact attempt |
| Phase 5 Complete predicate true | Completed / History; offer explicit Follow-up |
| Protected cancellation/assignment/content conflict | Needs attention / Open owning problem, never generic dismiss-to-resolve |

Queues: Needs assignment, Awaiting acknowledgment, In progress, Overdue, Finished—photos pending, Awaiting review, Follow-up pending, Ready to send, Delivery problem, Completed and Problems. A job may have multiple factual flags; show a primary state plus badges instead of inventing durable field states. Overdue is server-time based; last refresh and connectivity reveal stale information. Phone-only actions/photos are unknown to Admin until synchronized, not assumed missing forever or already accepted.

Complete leaves normal Active only under Phase 5's package/retention predicate. Admin history remains searchable. Contractor gets lightweight Recently Completed for seven days; retained metadata and unresolved evidence remain accessible through their proper protected path after normal recent display expires. The seven-day UI window is not a storage deletion/retention rule.

## 3. 6B — Templates, new work and corrective runs

Extend existing `photo_templates` rather than a parallel library. Add optional company applicability, description/instructions, revision and archive metadata. Keep a flat organization-wide/company-specific list, filter suggestions by work type and allow several selectable templates for the same type. Preserve the existing unique organization-wide default; add one company-specific default per normalized work type. Default resolution is company-specific, then organization-wide, then Custom. A suggestion never locks the Admin into it.

Choosing a prior WO/run offers **Follow-up**, **New/repeat work using prior template** or **New/custom template**. Prior snapshot reuse works even when the saved template has changed or been archived: copy the historical snapshot into a new draft, do not reactivate/edit the historical template. A new client order is a new WO UUID. Same-address text never decides whether business work is a follow-up.

Applying a template copies work description, instructions and requirements into an editable draft; source template ID/revision is provenance only. Each new run receives its own requirement revision/snapshot and stable item IDs. Before dispatch, Admin can change every item/on-off/count/instruction or use all-off requirements. Explicit Save as new template or Update template changes future choices, with revision checks and history; editing a job never silently changes the template. Used templates are archived, not destroyed.

After Start, retain the approved requirement/work-type freeze, additive instructions, auditable due-date correction and consent-based handoff. “Always adjustable” means editable drafts and deliberate new work/correction runs, not silently redefining downloaded/started work. The existing photo-bearing pre-Start revision-conflict protection remains in force.

### Corrective-run operation

`admin_create_followup` takes idempotent action UUID, expected current run/WO revision, kind (`INTERNAL_CORRECTION` or `CLIENT_RETURN`), reason, selected prior evidence references, active contractor, due date, new snapshot and release-item mapping. Under the same WO lock:

- validate active same-org Admin or tier-authorized Supervisor with current team/capability scope, plus an eligible contractor, accepted current-run FIELD_COMPLETE, no open successor run, no unresolved protection conflict and no unresolved queued/in-flight/partial/failed/uncertain delivery attempt;
- classify from delivery history: before any initial package is DELIVERED, use INTERNAL_CORRECTION; after confirmed client delivery, use CLIENT_RETURN; do not trust a UI label alone;
- invalidate unsent prior package approval, preserve draft/history, and create one new run UUID/sequence and assignment instance;
- preserve WO UUID/external client number/company, earlier runs/Finish sets/decisions/package receipts and immutable photo ownership;
- set new capture counts to zero and require fresh download receipt and fresh Accept; choose assignee explicitly, even if the original contractor is still active;
- copy/adapt only the required correction work. Prior photos can be reference evidence but never fulfill new-run capture requirements.

The contractor sees **Follow-up — client WO <number>**, its reason, instructions, requested items and due date. A secure reference-photo view may expose only photos deliberately included in that correction to its currently authorized contractor, with short-lived access; no unrestricted historical gallery or other-contractor metadata. Internal review reasons are visible only when intentionally included in correction instructions; they stay out of client delivery.

A first internal correction produces one eventual initial client package under the original number, not a client-visible “returned” label. A client return produces a deliberate new corrected submission with prior delivery history retained. New run creation never moves already delivered package folders or turns earlier delivery into failure. One open field run per WO; do not build parallel corrective branches.

Cancelling an untouched follow-up preserves its creation/history. The WO becomes Needs attention with its correction obligation unresolved; it does not automatically revert to Complete or send an older draft. Admin may dispatch a replacement correction explicitly. Started/photo-bearing cancellation preserves evidence under the existing protected conflict boundary. No generic un-cancel, delete or force-resolve feature is added.

### Contractor Accept

Accept is one tap and a distinct fact, not a new field state or mandatory prerequisite for Start. Do not auto-Accept on download, Start, Finish or account sign-in. Show Accept until acknowledged, alongside the separate Start action; a successful tap immediately means **Accepted — pending sync** after durable local commit. Server-confirmed acknowledgment changes that wording. Duplicate taps reuse one action UUID for the exact assignment instance.

Extend the existing owner-scoped `FieldAction` queue with ACK and preserve its local sequence, event time, run and assignment instance. `ActionSyncCoordinator` dispatches ACK through `acknowledge_assignment_acceptance`; existing START/COMPLETE validation and ordering stay unchanged. No duplicate ack-only worker. Add assignment fields `acknowledged_at` (client event time) and `acknowledgment_received_at` (server time), actor/action UUID and audit history. Constraints permit only the assigned authenticated contractor, exact instance and idempotent payload.

Offline Accept survives restart/session pause. Old-instance/reassigned/cancelled ACK is rejected as a protected stale acknowledgment, never rebound to the new contractor/run. A late ACK for the same already-finished instance can confirm only while that unchanged instance remains the authorized current run; an earlier accepted ACK always remains history after succession. New follow-up/reassignment gets its own fresh acknowledgment. Admin renders only confirmed acknowledgment and download/Start timestamps, with no claim that a human has not tapped solely because the phone is offline.

Accept reminder eligibility is ASSIGNED with no server-confirmed ACK. Start stops acceptance reminders because the assignment has moved into work, but does not invent an Accepted timestamp. An unsynchronized ACK may leave a reminder pending; wording says acknowledgment has not reached the office, not that the contractor ignored the job.

## 4. 6C — Efficient photo review and one correction request

Add item/stage gallery filters, bounded thumbnail pages, inspection/next/previous, selected approval, Approve all remaining in the reviewed scope, explicit rejection reasons, retained selections and save status. “All remaining” means the specified WO/run/filter/content revisions, never unseen photos that arrived later. Display the action's exact scope/count before applying it; Off mode remains optional individual review, not hidden blanket approval.

Bulk review submits photo IDs/content versions/expected decision revisions under an action UUID. Lock those decisions and apply all-or-none when any selected item is stale; return the conflict list. An unrelated photo/job can continue. Rejection need not dispatch a visit; selected approved/eligible coverage may already be sufficient. A reason is required for contractor-requested action; ordinary surplus exclusion may use a concise internal reason.

Collect issues in a server-backed correction draft: affected photo/item, reason, requested new photos/counts, release-goal mapping, assignee, due date and instructions. Show one checked summary, then one explicit dispatch calls `admin_create_followup`. Creating/editing a correction draft, rejecting a photo or opening a tab does not dispatch. A double click/network retry cannot create two runs.

When evidence returns, default Review to the newest corrective run/new photos first; earlier decisions remain visible and valid only for unchanged content. Show original/replacement context without modifying photo UUID/run/category. Required deficits distinguish captured counts from selected release coverage. No auto-reject of all old photos simply because a correction exists; Admin explicitly chooses the final eligible package.

## 5. 6D — Multi-run final package, coverage and history

Extend Phase 5 `client_package_photos` selection to eligible accepted runs of the same WO/company. A final package can mix approved original and replacement photos. With Review required Off, selected received non-rejected PENDING images are eligible, with policy clearly recorded. Never include another WO/company's photo because an address/template/item name matches.

### Exact cross-run coverage

Maintain the WO's revisioned `release_requirement_snapshot`, initially the original run requirements. It represents client-package goals, separately from each immutable run's capture snapshot. A correction may add/replace release goals only through explicit reasoned follow-up planning before dispatch; it cannot relax frozen capture obligations or create a generic bypass.

Each correction item maps to exactly one stable release item ID, or to Extra. Copy the original goal ID for a replacement; allocate a new goal ID for newly requested work. Mapping by matching text alone is prohibited. A package photo maps to at most one release item; its original captured item/run stays unchanged. Count each selected photo once toward final Total and at most one final item. The same image being counted in its own accepted capture snapshot and in the final package is two different factual views, not multiple named-item credit.

In addition to final baseline coverage, selected eligible **new-run** photos must meet enabled item/Total minima for each active correction obligation, from its explicitly designated completed corrective run. Old photos cannot meet a correction's new-photo minimum, even if they satisfy the final baseline item. A correction item with new delivery goals adds them explicitly to the release snapshot; all-off corrective work can have zero new photos. An explicit mapping/snapshot revision is frozen in package approval. Surplus/rejected evidence stays privately retained; it need not be selected when all required coverage is met.

Persist correction obligations with origin run, release-goal IDs, requested minima, designated replacement run, revision and OPEN/SATISFIED/SUPERSEDED facts. If returned evidence is also deficient, a checked new correction request can explicitly supersede the affected earlier request and its new-photo obligation, with reason and successor linkage. It cannot silently lower final job coverage or rewrite the earlier run's capture/Finish snapshot. Final approval validates the active obligations plus final baseline coverage; it does not demand that rejected images from an unsuccessful intermediate correction be selected forever. Package-run closure still records and privately retains all accepted intermediate evidence, even when no image from that run is selected.

Example: original Front minimum 2, two original Front photos captured, one rejected. A follow-up requests one new Front replacement, mapped to the original Front goal. Final selection uses one approved original and one eligible new photo: final Front 2/2, correction new Front 1/1. The rejected original stays private. New-run camera starts 0/1; old photos cannot make it 1/1.

For a client-returned correction, prepare a complete corrected package by default, reusing eligible privately retained original JPEGs plus new evidence. Preview the entire submission and keep earlier delivered package/file IDs intact. Every new package gets its own revision/IDs; retry of that package uses those same IDs. No assumption that a client portal supports partial patching or file replacement.

Complete applies to the latest required submission and current run; older confirmed deliveries remain history. Invalidate unsent approval when a new follow-up or release mapping changes eligibility. In-flight manifests remain immutable and must reconcile before a follow-up/different Send proceeds. Selected evidence whose private bytes are unavailable is a visible problem; historic Drive confirmation does not manufacture missing bytes or authorize silent redownload from an unrelated object.

History shows company/WO identity, runs/reasons, dispatch/receipt/Accept/Start/Finish, template/snapshot revisions, received evidence, review decisions, correction requests, package approvals, exact destination/attempt/receipt and protection problems. Internal and client-facing content are distinct explicit fields. Ordinary Admin cannot hard-delete history or clear unresolved problems merely by clicking Dismiss.

## 6. 6E — Optional dashboard, phone and computer alerts

Use one server issue/event owner deriving from existing verified facts and Phase 5 history. No generic messaging platform, SMS/job-email alert service or native Admin app. The separately approved 6F photo-recovery email uses the existing Auth boundary. Optional **Web Push** supports enrolled Android Chrome admin phones and supported Chrome/Edge desktop browsers over the dashboard's HTTPS origin. OS/browser settings govern actual background delivery. Other browsers/OSes show unsupported until specifically verified; do not promise iOS support from a general web API.

Add a service worker scoped to the existing hosted dashboard path and a small notification settings module. Confirm actual GitHub Pages base path before registering worker or deep links; no assumed root `/`. The worker handles push/click only. It must not cache authenticated pages/API/photo URLs, become an offline photo store or own field/delivery actions. Clear application-visible state on sign-out; generic pushes never reveal saved job contents.

Web Push uses VAPID: public key may reach the browser, private signing key stays server-only. Subscription endpoint/key material is sensitive routing information; store in a private backend table and do not log it. Authenticated enrollment is bound to Admin UUID, org and a locally generated device UUID plus Phone/Computer label. Permission requests happen only after the Admin chooses Enable on that device. No enrollment on a device the user has not opened/authorized. Installation may be offered where useful, not treated as a guarantee of delivery.

### Types, channels and default behavior

Each type has independent Dashboard/Phone/Computer switches. Phone/Computer apply only to enrolled devices of that class, with per-device enabled status. Dashboard alerts default On for the listed operational types; phone/computer default Off. These defaults are approved concrete behavior, not an implementation-completion claim. A job's underlying problem badge/count remains visible even when an alert preference is Off.

| Stable type | Trigger / resolution |
| --- | --- |
| `READY_FOR_REVIEW` | Accepted Finish plus required private receipts ready; resolve when necessary review/package preparation progresses or correction replaces that readiness. Off mode labels Prepare package. |
| `FOLLOWUP_READY_FOR_REVIEW` | Same facts for newest corrective run; resolve on review/next action. |
| `ASSIGNMENT_NEEDS_ACCEPT` | Fresh dispatch awaiting confirmed ACK; resolve on ACK, Start, reassignment or cancellation. |
| `ACCEPT_REMINDER` | Same instance still ASSIGNED after optional configured delay; one reminder per configured threshold, not every refresh. |
| `OVERDUE` | Due boundary passed while current assigned/in-progress field work remains incomplete; resolve on accepted Finish, cancellation or audited due-date change. Photos pending after Finish are a different issue. |
| `UPLOAD_PROBLEM` | Reported safe-failure, uncertainty or backend-detectable stalled transfer; resolve only on received/reconciled evidence. |
| `APP_OR_SYNC_PROBLEM` | Reported assignment/cancellation/content/auth problem requiring intervention; verified resolution clears active issue. Unknown offline device state is not an invented app failure. |
| `DELIVERY_PROBLEM` | Partial/failed/uncertain provider attempt or placement/credential problem; resolve on reconciled success or explicit supported recovery. |
| `CLIENT_DELIVERED` | New package confirmed delivered, once per package; acknowledgment closes this informational alert. |

Needs Accept immediately and delayed Accept reminder are separately selectable. Delay defaults 24 hours when reminder is enabled; Admin can choose a positive delay. Upload stall defaults 30 minutes without a reported progress change after a server-known upload began; wording is `No recent upload progress`, not proof that an offline phone failed. Due dates currently are dates: configure an organization IANA timezone and derive overdue at next local midnight after that due date, using server UTC comparisons. DST transitions and timezone edits are explicit test cases. Do not reinterpret past stored device event times.

Quiet hours are optional per Admin, with an IANA timezone and start/end times. Delay optional phone/computer dispatch until the next allowed time, revalidate issue/prefs/role before sending, and suppress issues resolved meanwhile. Dashboard state stays current. Snooze suppresses interruption until a chosen time; Acknowledge hides/marks read but does not resolve an ongoing issue. Same issue remains in its owning job; a material new version can alert again. No high-severity quiet-hours bypass unless separately requested.

### Persistence, deduplication and dispatch

Planned records: `admin_notification_preferences` (type/channels/delay/quiet hours/revision), private `admin_push_subscriptions` (Admin/org/device/class/endpoint/keys/status), `admin_alert_issues` (type/WO/run/assignment/problem version, first/last time, resolved facts), `admin_alert_receipts` (Admin/read/snooze) and private `admin_notification_outbox` (issue version/Admin/device/channel, state/attempt/next time/lease). Unique keys prevent duplicate notification production from refresh/retry. All records are org-scoped; only active scoped Admin or Supervisor can enroll/settings/read their own subscription summary, with current work entitlement revalidated. A Contractor cannot subscribe to Admin events or use an arbitrary org/device supplied in a request.

Operations: `admin_set_notification_preferences`, `admin_enroll_push`, `admin_disable_push`, `admin_acknowledge_alert`, `admin_snooze_alert`, and paged `admin_alert_list`. Expected revisions/idempotent actions apply to mutations. The notification worker reuses Phase 5's scheduler/lease pattern with a five-minute timed-issue evaluation; transactional facts enqueue immediate eligible events and scheduler drains them. No additional scheduler framework. Secure subscription writes validate HTTPS endpoint shape/size, reject local/private destinations and constrain outbound dispatch against SSRF; no general URL-fetch proxy.

Push payload is generic: `Field Work Hub — an assigned job needs attention`, opaque alert ID and relative authorized deep link. No address/client name/photo/token on the lock screen. Click focuses/opens the correct hosted path, then ordinary login/org/role checks fetch the real job. Cross-account/revoked/expired access shows sign-in or unavailable, never prior-user content. Sign Out disables that device's server enrollment when connected; offline sign-out disables local subscription use immediately and queues removal, without claiming an already-sent generic push can be recalled. Role/deactivation also blocks every new server dispatch.

Worker status distinguishes QUEUED, PUSH_ACCEPTED_BY_SERVICE, FAILED and EXPIRED; push service acceptance is not proof of OS display or human reading. Retry can cause at-least-once delivery after a crash; stable notification tags collapse duplicates where supported. TTL bounds stale pushes, and click revalidates live state. 404/410 endpoint removal disables enrollment; transient 429/5xx backs off; denied/revoked permissions, unavailable subscription or VAPID rotation display an actionable settings condition. Turning channel Off suppresses queued sends for that channel. Notification failures never lose the job, mark it Complete or block safe field work.

On supported devices test delivery with tab closed/phone locked, permissions denied, OS notifications disabled and offline/expired endpoints. A fully exited/force-stopped browser or blocked OS may delay/suppress delivery; list the observed support boundary honestly. Notification support is not guaranteed emergency paging.

## 6F — Shared access and recovery controls

Implement the approved [shared-access amendment](SUPERVISOR_ACCESS_RECOVERY_AMENDMENT_2026-10-05.md) sections 3–8 as one integrated office access surface: team selection; cumulative tiers; owner-only Supervisor enrollment/grant/change/removal and allowances; scoped Tier 2/3 Admin invitations; Tier 3 Contractor recruitment/transfers; guarded work disable/restore; historical photo recovery and optional verified-email link. Account-management controls render only the caller's allowed capabilities. Owner suspension cannot be lifted by a lower manager. Roster moves and active-WO handoffs remain distinct, reasoned, revision-checked actions; in-progress Contractor consent remains required.

Reuse the existing session/invitation/workspace and Phase 5 authority/recovery owners. Use the linked exact photo cutoffs and accepted-Finish continuation rules, never broad operational-table recovery access or invented acceptance of unsynchronized work. Recovery offers inspection/download/export only; email authenticates the existing verified identity and cannot restore work permission. A missing TEST sender is a recorded email gate, not permission to claim completion from a mocked send.

The amendment sections 8–11 govern planned records/RPCs, additive migrations/compatibility, failures, rollback and test matrix. Combine its tier/owner/handoff/disable/email/scoped-push evidence with the existing whole Phase 6 workflow gate. Completion requires all six sections plus the existing field/review/package protections; 6F is not an independent plan approval.

## 7. Persistence, migration and recovery

Use additive Phase 6 migrations: template applicability/defaults, run kind/parent/release mapping, assignment acknowledgment, server-backed job/correction drafts, correction obligations and alerts/preferences/private outbox. Add composite org/WO/run references and unique open-run/action keys; store supersession/closure linkage explicitly. Keep existing run states and assignment history. Do not backfill old download/Start facts into fake Accept timestamps, convert delivered jobs into new events, or notify the entire historical backlog on rollout. Seed current unresolved issues for dashboard visibility; device push starts from enrollment/current selected active events with deduplication.

### Additional Phase 6 interfaces

| Planned interface / record | Exact boundary |
| --- | --- |
| `admin_work_order_list` / `admin_work_order_workspace` | Paged filters/cursor/limit, authorized selected UUID and revision, bounded facts/history/photos; no cross-org group inference. |
| `admin_job_drafts` / `admin_save_job_draft` | Admin/org draft UUID, company/source-template/snapshot/fields, expected revision and Saved result; drafts do not dispatch or rewrite active runs. |
| Extended template save operation | Existing owner gains company, description/instructions and expected revision; used templates archive, defaults unique at each applicability scope. Keep existing clients compatible. |
| `admin_save_correction_draft` / `admin_create_followup` | Exact issue/photo/content revisions, goals/minima, prior obligation supersession, contractor/due date; atomic single-run creation with action UUID. |
| `acknowledge_assignment_acceptance` | Action UUID, WO/run/assignment instance and original event time; exact active original owner, idempotent recorded result and separate server received time. |
| `field_correction_reference_access` | Current contractor/org/run plus deliberately shared prior photo/content ID; short-lived URL only, no broad old-run access. |
| `admin_review_photos_bulk` | Explicit ID/version/revision set and action UUID; all-or-none stale validation with exact conflict list. |
| Extended package approval | Existing Phase 5 owner validates release snapshot, active correction obligations, selected source-run membership and covered-run private retention. Same Send/worker/cleanup path. |

All UI mutation results distinguish durable server success, stale conflict and retryable failure. Narrow RPC grants/private implementations own authorization; job/table/template directly editable privileges cannot circumvent dispatch, snapshot or release rules.

Room 4→5 adds ACK fields/metadata needed by cached assignments and existing FieldAction action-kind handling. Reuse Room/action/assignment owners and WorkManager constraints. Keep export schemas and migration tests 3→4→5 and 4→5. Old pending START/COMPLETE/photo records stay readable and retain identity. Existing v4 server action callers continue safely during update; publish a compatible acknowledgment RPC instead of silently changing parameters required by installed Phase 4 clients. Unsupported old dashboards must be prevented from bypassing new release/company guards at the server, not merely warned in UI.

Recovery pauses alert dispatch/worker enrollment and new follow-up/release actions if affected; preserve events, queues, decisions, runs, package IDs and originals. Provide an evidence-preserving recovery APK matching the new Room schema/package/signer with networking paused; do not uninstall or downgrade to an incompatible schema. Dashboard/service-worker rollback unregisters only the new worker and disables subscriptions, without changing job state. VAPID rotation requires explicit reenrollment status; provider credential change never changes a package's destination identity. Additive DB recovery uses forward repair, not dropped production history.

Update the existing integration/testing contracts with: one-tap human Accept distinct from durable receipt/Start; fresh per-instance facts; completed-run correction before initial client release; narrow reference-photo access; multi-run coverage; optional independently selected Admin notifications. Preserve all other authorization/offline/camera/uncertainty protections. Approval of this plan authorizes only this defined notification path, not a broader messaging subsystem.

## 8. Whole-phase verification and completion

Focused suites while building, one complete suite on exact runtime head before merge. Add behavioral tests to existing dashboard/Android/database owners and a narrowly bounded worker/push integration suite. Provider tests use disposable exact-company TEST destinations and generic test notifications; no live client photos or contractor PII in repository evidence.

| Boundary | Required proof |
| --- | --- |
| Workspace | Bounded pagination/query/thumbnail fetch, stable selection under refresh/filter changes, saved drafts vs unsaved/conflicted edits, keyboard/focus/mobile layout, isolated account state and counts matching server predicates. |
| Templates | Several templates/type/company, default precedence, archive/prior-snapshot reuse, job-copy independence, revision races and frozen started-run preservation. |
| Follow-ups | Idempotent one successor, same WO/client number, fresh run/assignment/receipt/Accept/zero counts, internal vs returned classification, in-flight send race, other contractor, protected cancellation and unchanged prior history. |
| Accept | Offline durable tap/restart, exact instance/owner, ACK sequence with Start/Finish, idempotency, stale rejection, no false download/Start acknowledgment, reminder stops truthfully. |
| Review/package | Bulk scope/conflict atomicity, one checked correction dispatch, returned-first gallery, rejected surplus, cross-run mapping and new-run minima, repeated deficient correction/supersession without stuck coverage, Off semantics, stale approval, immutable delivered history and no cross-WO/client selection. |
| Alerts | Preferences/device/channel isolation, thresholds/timezone/DST/quiet hours, snooze vs resolution, duplicate/at-least-once behavior, role revocation, click auth, disabled/expired endpoints and private routing information. |

Combine the real workflow and device notification checks on one staged exact runtime where feasible:

1. Company/address with several historical WOs/templates → new dispatch; edit copied requirements without changing saved template; close/reopen workspace and preserve saved context.
2. Offline contractor Accept, restart, then Start/Finish; reconnect proves distinct durable receipt, ACK and field times. Admin never sees unsynchronized actions as confirmed.
3. Review completed received photos, reject one required image and surplus, collect one correction, select same/different eligible contractor; fresh follow-up shows original external WO number and zero new counts.
4. Capture only requested correction, review new evidence first, combine eligible original/replacement photos; preview excludes internal rejection text; approve and Send one initial client package. History/private retention/cleanup remain correct.
5. Reopen after actual delivered package as a client return, preserving initial delivery; demonstrate new corrected package and protected cancel/conflict display. Use targeted fixtures rather than repeating all Phase 4 capture checks.
6. Enroll supported admin phone/computer, choose distinct alert types/channels; verify actual delivery, quiet/off/permission-denied cases and authorized click with tab closed/phone locked where supported. Record OS/browser/version and limitations.

A notification-only failure stops that channel's completion claim; independent proven layout/review work can continue. If correcting the failure requires materially changing the promised channel/security design, record one consolidated amendment. Do not repeatedly seek letter-level plan approval.

Phase 6 complete only when the Admin can **select → assign → acknowledge → review → correct → prepare/send → track confirmed delivery without losing context**, all facts remain distinct and private/protected history is correct, shared tier/owner/handoff/recovery controls and optional recovery email satisfy the approved amendment gates, selected supported notifications satisfy their real device boundary, exact-head automation/live parity pass, Level 3 pre-merge approval and integration agree. No runtime/device PASS is claimed by this approved planning update.

## 9. Phase 7 and Phase 8 attachments

**Phase 7:** retain the current internal-pilot scenarios and add repeated multi-company/address/template selection, offline Accept, internal correction before first delivery, client-return correction after delivery, review On/Off, selected rejected/extra evidence, cross-run final coverage, paged context/draft recovery, destination override/default change during retries, optional device alerts and one conflict/notification failure. Pilot uses disposable/safe internal work; a notification failure cannot justify photo loss or silent release.

**Phase 8:** replace HNP-only production labels with the selected configured-company pilot while retaining HNP as one option. Before production, record supported account/root ownership, private holding budget/backup/recovery/retention policy, excluded/cancelled/never-sent evidence treatment, authorized deletion procedures, credential revocation, scheduler operations, notification browser/OS support/enrollment/VAPID rotation, stable update recovery and second-phone evidence. No production automatic private purge until a concrete retention policy and recoverable export/deletion gate are approved. These production choices do not delay the Phase 5 no-purge pilot policy or weaken its final-delivery cleanup guard.

## 10. Official implementation references checked for planning

- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API): service worker/subscription/permission boundary.
- [Web Push overview](https://web.dev/articles/push-notifications-overview): enrolled browser push lifecycle.
- [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions) and [Edge limits](https://supabase.com/docs/guides/functions/limits): bounded persistent alert delivery.

Recheck library/API versions and actual hosted path during runtime. These references do not establish device permission, enrollment or real delivery evidence.
