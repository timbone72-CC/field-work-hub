# Field Work Hub — Shared dashboard, supervisor tiers and photo recovery amendment

Date: 2026-10-05. Plan ID: `supervisor-access-recovery`; revision 1.

Status: **COMPLETE PROPOSED AMENDMENT — DOCUMENTATION ONLY — NOT IMPLEMENTED.** The user requested that this discussion be documented and placed in the appropriate phases. The approved Phase 5/6 revision-1 plans merged through PR #38 remain the baseline. Their approval does not cover this later material expansion of account authority, team visibility and recovery. Read this complete amendment with both whole-phase plans; no section below is an independent approval unit.

## 1. Product outcome and recorded direction

An Admin shares the organization's dashboard through individual Supervisor logins. Everyone sees the same authorized job records, current facts and history. Each action records its actual actor. Admins primarily manage their own teams; Supervisors manage explicitly permitted teams or the organization according to a cumulative tier. A contractor team change does not move existing work or rewrite photo ownership.

The Product Owner controls who receives Supervisor access and which tier applies. Turning off ordinary work access for an Admin, Supervisor or Contractor preserves read-only recovery of previously authorized photos and protected evidence on the original device. The access-denied screen offers **Recover my photos** and an optional email link to the account's existing verified email. Recovery never turns work access back on.

The product remains universal: HNP is one possible client-company configuration. The planned business Google Workspace address and website/domain belong to production setup. Current development can continue with correctly configured TEST services.

The user expressly requested tiered sharing, Product Owner oversight, preserved photo access after disablement, optional recovery email and phase placement. The exact cumulative tier boundaries below are the concrete recommended design developed from that discussion. Package prices, seat counts and a billing integration are not decided by permission tiers.

## 2. Classification and authoritative line

| Item | Record |
| --- | --- |
| Goal / scope key | Plan shared dashboard authority and evidence recovery; `supervisor-access-recovery-plan`. |
| Documentation branch | `docs/supervisor-access-recovery-plan`; one authoritative planning line. |
| Baseline / documentation rollback | Main `e4f5c2e868a6caae33aad3f19d3335b7cafee0bb`, with approved PR #38 integrated. |
| Preflight | Main confirmed at baseline; no open PRs on inspection; existing dashboard planning branch is merged, not an active competing line. Phase 4 is COMPLETE; Phase 5/6 runtime has not started. |
| Current level | Level 1 documentation. Future authorization, schemas, recovery and credential/domain cutover are Level 3; ordinary UI is classified by its actual impact. |
| Affected surfaces | This plan, roadmap phase attachments and pending-amendment notices in the approved Phase 5/6 plans. |
| Required rules | AGENTS, Governance, Project Profile, Rule Index, Change Control, Integration, Testing, Phase Staging and complete affected phase plans. Supabase skill used for Auth/recovery planning. |
| External changes | None: no DDL, Auth account mutation, emails, DNS, domain purchase, deployment, storage or FPP changes. |
| Protected behavior | Immutable org/user/WO/run/photo/provider identity, offline evidence, accepted Phase 4 observations, existing review/package/Send/cleanup owners and explicit in-progress handoff consent. |
| Verification | Document/contract consistency, bounded diff, links, exact remote readback and historical roadmap preservation. Runtime/device/provider evidence remains pending. |

## 3. Recommended cumulative tiers

| Capability | Admin | Tier 1 — Work Supervisor | Tier 2 — Team Manager | Tier 3 — Organization Manager | Product Owner control |
| --- | --- | --- | --- | --- | --- |
| Normal visibility | Own assigned team(s) | Explicit supervised teams | Explicit supervised teams, including teams created within allowance | One granted organization | Entitlement/account-control metadata across authorized organizations; business data needs a separate organization grant |
| Create/edit/assign jobs, use templates, review photos, request corrections, approve packages and Send | Own teams | Supervised teams | Supervised teams | Organization | Only through a separately granted work role/scope |
| Cancel or hand off work | Existing guarded rules | Same guarded rules | Same guarded rules | Same guarded rules | No bypass of protected started work |
| Add/invite Contractors | Own teams within seat cap | No | No | Organization within seat cap | Operator provisioning within approved allowance |
| Pause/reactivate existing Contractors | Own teams | No | Supervised teams | Organization | Can disable/restore work access within configured entitlement controls |
| Add/invite and pause/reactivate Admins | No | No | Supervised teams / new teams within owner-set allowance | Organization within owner-set allowance | Sets allowance and may administer access |
| Place an available unassigned Contractor under an Admin | No roster transfer authority | No | Within supervised scope | Organization | Can authorize organization staffing changes |
| Move Contractors between existing Admin teams | No | No | No | Organization, explicit audited action | Can authorize organization staffing changes |
| Create/enable Supervisor access, grant/change/remove tier or supervised scope | No | No | No | No | Product Owner only |
| Raise Admin/Contractor/Supervisor allowance | No | No | No | No | Product Owner only |
| Disable any Admin/Supervisor/Contractor's work access | Own-team Contractors only | No | Admins/Contractors in supervised scope | Admins/Contractors in organization; cannot manage peer Supervisors | Product Owner across managed accounts |
| Recover previously authorized photos after work disablement | Exact recovery grant | Exact recovery grant | Exact recovery grant | Exact recovery grant | Own authorized photo scope only; no automatic customer-photo access |

Tier 2 may create an Admin and its team atomically within its supervised organization and allowance, then place an available unassigned Contractor there. That makes Tier 2 useful without allowing recruitment or cross-team transfers. A genuinely unassigned Contractor has no current team or open assignment; moving a roster label alone cannot make a busy Contractor eligible. Tier 3 adds recruitment and transfers. Tier 1 manages work, including assignments among already eligible Contractors, without account-management authority.

Admin management of Contractors is the existing operational capability, now scoped to the Admin's team. A Supervisor package is an additional delegation role, so Tier 1 need not inherit every Admin staffing capability. Admins cannot create other Admins or Supervisors. Tier 2/3 cannot change peers' Supervisor grants, promote an Admin to Supervisor or evade caps by reactivation. Pausing an Admin requires a reason, affected-work warning and continuity decision; it does not cancel jobs.

Permission tiers and capacity allowances are separate. Preserve existing Contractor seat reservation and durable-release rules. New Admin/Supervisor invitations use explicit owner-set capacity and pending reservations; no unlimited implicit seats. A recovery-only account consumes no active work seat, but keeps its immutable identity and recovery grants. Product Owner suspension cannot be defeated by a lower manager's reactivation: an owner-imposed suspension requires Product Owner release. Supervisors may lift only eligible operational suspensions within their scope.

Pricing, trial durations, extra seats and billing enforcement remain a later business decision. These tiers can operate as manually granted packages without implementing payments.

## 4. Teams, work visibility and handoff

Use one durable `admin_team` identity within an organization. Admin membership and Supervisor scope grants reference team UUIDs. A WO records its responsible team explicitly; authorization cannot derive it from the current contractor roster. All WOs, runs, photos, drafts, packages, alerts and counts are filtered through the same authoritative scope checks. Companies and addresses remain navigation/business context, not authorization boundaries.

A Contractor normally belongs to one active Admin team. The Contractor sees current authorized assignments and their own protected evidence, not that team's full dashboard. Admins may share a team only through an explicit membership grant; joining an organization alone does not expose all its work. Tier 1/2 may supervise multiple explicitly granted teams; Tier 3 has one explicitly granted organization scope, never all tenants.

Roster transfer and active-WO handoff are separate actions. A Tier 3 transfer shows old/new team, active assignments and retained evidence, then records actor, reason and revision. Existing WOs keep their responsible team and assignment until an explicit WO handoff; historical photos keep their original org/WO/run/capturing identity. For a Contractor moved with old active work, store a narrow assignment-specific eligibility exception so the old responsible team's Admin can finish managing that assignment without acquiring the new team's roster. New dispatch uses the current roster. An in-progress assignment still requires Contractor consent; changing teams cannot bypass it.

Team ownership handoff is also explicit, revision-checked and limited to Tier 3 or authorized Product Owner organizational operations. It preserves historical responsible-team events, package folders and original photo identity. The old office scope loses normal future-work visibility while its already-authorized evidence receives recovery grants. Contractor-facing assignment/run IDs do not change merely because an office owner changes; any actual reassignment follows the existing fresh-instance rules.

If an Admin is paused or leaves, existing jobs remain intact. An active authorized Supervisor can manage them within the same team. Without one, the Product Owner assigns a replacement Admin or grants Supervisor scope before work continues; no platform-wide data bypass. Show the team as needing an active manager. An authorized manager's departure never silently clears protected problems or auto-Sends an approved package.

Shared edits use expected revisions and action UUIDs. Concurrent photo decisions, assignment edits, templates, recovery cutoff and Send fail with an understandable reload/compare conflict. Two people cannot create duplicate corrections or delivery attempts by clicking simultaneously. Audit logs show actual users and before/after scope, rather than a shared Admin identity.

## 5. Product Owner authority

Use a private server-controlled platform capability bound to the verified immutable Supabase Auth UUID of the Product Owner. Do not infer it from an email spelling, GitHub username, first signup or editable metadata. During implementation, verify the intended identity in the correct environment, bootstrap through the governed trusted operator path and record only non-secret verification evidence. No public source hardcodes personal email, recovery credential or elevated key.

Product Owner controls organization allowances, Supervisor enrollment, tier, scope, upgrade/downgrade/removal and owner-imposed work suspension. The UI shows organization, granted tier, teams, active state, seat usage and audit history. Changes take an action UUID, expected grant/access revision and reason; the server atomically enforces authority and prevents self-escalation. Removing a tier disables Supervisor work access, preserves historical attribution and creates the appropriate photo-recovery cutoff.

The platform capability does not itself authorize customer photo inspection, job review or Send. If the Product Owner needs to run an organization's work, grant an explicit organization work role/scope and audit those actions normally. A separate `OWNER` organization role solely for licensing is unnecessary; this amendment proposes a real `SUPERVISOR` work role with tier/scope grants, alongside the existing ADMIN and CONTRACTOR roles. Clients must not treat all non-Contractors as Admins.

Require recent verified authentication for entitlement/access changes and use available verified MFA for Product Owner controls before outside use. Initial/replacement Product Owner binding is an operator security procedure, not a button available to any Supervisor. Prevent disabling the last usable Product Owner capability without a verified replacement. Account recovery for that authority does not use the ordinary photo recovery grant.

## 6. Work disablement and exact photo recovery

Separate three facts: Auth identity/session, active work entitlement, and historical evidence-recovery grant. Ordinary business disablement sets work entitlement inactive without deleting/banning the Auth identity. The person can authenticate into recovery-only mode; every normal work/account mutation and live-work listing remains denied server-side even with an old JWT or altered client.

A security lock for compromised credentials revokes/blocks authenticated remote use until verified identity recovery. It does not delete evidence. Offer a support/recovery route without granting the potentially compromised credential remote photos. Owner-scoped files already protected on a device remain preserved and exportable through the legitimate device/identity recovery boundary; a different signed-in account cannot browse them.

### Grant construction

At a work-disablement, tier downgrade, team removal or ownership handoff, take a transactionally defined cutoff revision and materialize exact photo/content IDs the person is authorized to recover from the scope being removed. For a Contractor, this means their own evidence and any specifically shared reference photos already authorized; no other Contractors' general gallery. For an Admin/Supervisor, it means authorized existing photos in the removed work scope, including retained review evidence. Do not use a perpetual query such as “all photos under every WO ever seen.”

Recovery may include registered frozen photos whose accepted Finish and identity existed before cutoff but whose verified bytes arrive later. The grant pins those exact photo/Finish/content expectations; it does not admit subsequently captured photos on an old WO. Existing narrow reference grants retain only their exact intentionally shared content. Never broaden by matching address, name, external WO number, a reused email or a new team membership.

For large scopes, use a durable indexed grant header plus materialized member records under a stable transactional snapshot. Mark grant construction PENDING and expose no incomplete/widened set until READY. Disable work access immediately, retain all evidence and allow retry to complete the fixed snapshot. Each later scope removal adds its own immutable set; expiry of an email session does not delete the underlying recovery eligibility.

Recovery mode permits bounded gallery inspection and individual download/batched export of existing authorized bytes with minimal WO/run provenance. It excludes roster/email lists, internal review comments, new job details, edits, delete, Accept/Start/Finish, assignments, approvals, client Send, provider configuration and tier management. Export is an evidence copy, never client delivery or job completion. Cloud recovery returns retained prepared JPEGs; protected originals are available only if still on the original device or explicitly retained elsewhere. Do not promise recovery of a deleted full-resolution original from its derivative.

### Offline and transfer boundary

Previously accepted, registered Finish-bound evidence remains eligible for its original owner to complete private transfer in recovery-only mode. Validate the exact frozen photo, expected bytes and pre-disable authorization on every transfer/resume/receipt request. An active TUS request or already issued read URL may finish within its existing authorization window; block new broad access/renewals and verify any resultant private object before exposure. Never claim that revocation recalls already downloaded bytes or five-minute signed read URLs.

Unaccepted offline Start/Finish or photos not known to the server remain protected local evidence. They cannot be registered as successful work, uploaded through a fake accepted Finish or included in client delivery merely because recovery was requested. Provide same-device owner-scoped read/export without modifying originals or frozen metadata. The existing same-UUID temporary-reactivation path remains an explicit authorized option for resolving legitimate unsynchronized business work; stale assignment/cancellation checks still apply. No new quarantine intake or emergency bypass is included in this amendment.

When revocation is learned on reconnect, stop new work synchronization/capture authority, preserve pending actions/photos and show recovery plus the protected conflict state. An offline device cannot know a server access change instantly; any locally queued later work remains unconfirmed and may be rejected without erasing it. No local action is falsely called accepted.

Work disablement itself never authorizes cleanup or deletion. Approved Phase 5 automatic cleanup still needs the existing final-delivery/receipt/journal predicates, leaving retained prepared evidence available to exact recovery grantees. Read-only originals may be exported before eligible cleanup but are not promised as an indefinite local gallery. Private no-purge retention through Phases 5–7 remains. Phase 8 must reconcile any proposed retention expiration with this recovery promise and export availability before deletion is authorized; no implied recovery-photo purge is added now.

## 7. Recovery screen and optional email

After successful authentication with no active work entitlement, show **Work access is turned off. Your previously authorized photos remain available for recovery.** Offer **Recover my photos**, **Email me a recovery link** and the configured support route. If no eligible bytes are stored online, explain that protected unsynchronized photos may still be on the original device. A link cannot remotely recover a lost/offline phone.

The email option is voluntary. For a signed-in user, target only their existing verified Auth account email; never accept an arbitrary alternate destination. A signed-out recovery request may take an email for lookup but returns the same generic response whether that account exists, is disabled or has evidence. It sends only to the verified account address, does not create a new account or reveal customer details. A changed/lost email uses normal verified identity-support procedures, not a free-form forwarding address.

Use Supabase Auth's supported one-time email sign-in flow with account creation disabled, and a fixed allowlisted recovery callback. The link authenticates the existing identity; server checks separately restrict that identity to its recovery grants. A magic-link session is not a privileged recovery bypass or proof of active work entitlement. Do not use password reset to switch active flags. Require the same ordinary server authorization on every gallery/export request.

Use a 15-minute Auth email-token lifetime for this flow if compatible with the environment's Auth settings; record shared effects on other email flows before applying that configuration. If isolation requires a separate server-issued recovery request nonce, make it opaque, store only its hash, bind it to the existing user/environment/purpose and consume it once after successful Auth verification. It cannot replace Auth or carry photo scope from the URL. Recovery session access lasts at most 30 minutes before fresh authentication; underlying photo grants persist. Check expiry/access/session revision on every request, not only screen entry.

Rate-limit requests by account and request origin, return generic outcomes, handle expired/replayed links safely and offer a new request. Scrub tokens from visible URL/history immediately after exchange; no tokens, photo URLs or personal details in logs or email subject. Email contains the access link and concise instructions, not attached job photos. Use a deliberate confirmation step to avoid an email scanner consuming application recovery state merely by fetching the page.

Reuse the existing session owner and trusted Auth/email boundary. Phase 6 must inspect the current configured sender and prove actual permitted TEST delivery; it cannot assume Supabase's default email service sends to arbitrary external users. If sender configuration is missing, implement and verify the signed-in recovery path, record email delivery BLOCKED and retain the email feature's outstanding gate. Do not mark the whole amendment's email outcome complete until the real test passes. The future Workspace mailbox/domain does not automatically configure transactional Auth delivery.

## 8. Planned server and client owners

These are planned interfaces, not deployed schema/RPC names. Implement additive migrations using the actual current source and Supabase CLI; do not invent migration timestamps or alternate authority systems.

| Record / owner | Required boundary |
| --- | --- |
| Private platform-owner capability and organization allowances | Verified owner UUID, environment, active/revision; owner-only entitlement operations. No automatic photo authorization. |
| `admin_teams`, team memberships, Contractor roster memberships | Org/team/user composite identity, active/revision; one current Contractor team, explicit Admin grants and historical transitions. |
| Supervisor grants | Org/user, tier 1–3, explicit team members or org scope, grantor/reason/revision; Product Owner-only modification. |
| Account work-access record | User/org, active flag, suspension authority/reason, cutoff/revision; independent of Auth validity and photo eligibility. |
| WO team ownership and assignment exceptions | Durable responsible-team UUID, explicit handoff events; old active assignments managed narrowly after roster move. |
| `photo_recovery_grants` and exact members | Removed scope/cutoff, original user/org/photo/Finish/content expectations, PENDING/READY, byte availability; immutable bounded read/export set. |
| Private recovery sessions/requests | Auth identity/session ID, grant reference, hashed nonce if needed, expiry/consumption/revocation; no privileged URL scope. |
| Append-only access/roster events | Actor, target, old/new scope/tier/state, reason, revision/action UUID/time; no public PII or token logs. |
| Dashboard | Existing session and workspace owners gain server-filtered scope, team selector, scoped people controls and recovery-only view. No second dashboard data model or token store. |
| Android | Existing Room/session/PhotoOwner/action/transfer coordinators gain access-mode presentation and owner-scoped export; no second capture/sync/cleanup owner. |

Planned operations: `owner_set_supervisor_grant`, `owner_set_org_allowance`, `set_account_work_access`, `invite_scoped_admin`, `move_contractor_team`, `handoff_work_order_team`, `photo_recovery_list`, `photo_recovery_access`, `photo_recovery_export_manifest`, `request_photo_recovery_email` and recovery-session exchange. Account/tier/roster operations require expected revisions and idempotent action IDs. Validate caller, target, org, scope, suspension authority, capacity and affected-work conditions transactionally. Privileged Auth invitation calls remain backend-only; pending reservations and failed-send retry use the existing invitation owner rather than a parallel provisioning service.

Extend all Phase 5/6 list/count/workspace/photo/template/draft/review/correction/package/Send/retry/notification APIs with one common current server permission predicate. Admin and Supervisor work access require role, active entitlement and exact team/organization capability. Recovery APIs require ordinary authenticated identity/session plus exact grant membership, never an `active OR recovery` blanket policy over operational tables. Direct-table and Storage policies enforce the same boundary. Security-invoker public wrappers and narrowly granted private implementations stay; no generic service-role proxy.

Short signed photo access URLs preserve the approved maximum five-minute lifetime and are issued only on demand. Recovery exports paginate and stream a bounded exact manifest; no permanent public ZIP or company Drive credentials. Export failure retains grant state and evidence, shows retry, and never marks delivery/cleanup complete. Account/scope changes invalidate work drafts and new pushes on reload without deleting saved server history. Alerts, preferences, subscriptions, issue lists, worker dispatch and notification click recheck current team/tier/access; recovery-only accounts receive no new work alerts. Alert preferences stay per user, independent of Supervisor tier.

## 9. Phase placement and complete implementation sequence

| Phase / section | Amendment placement | Dependency / completion condition |
| --- | --- | --- |
| Phase 5A | Team/account permission foundation, exact work vs recovery authorization, immutable WO team binding, grant cutoff/snapshot and private bucket/RPC policies | Resolve reviewed legacy team mapping before exposing private evidence. Supervisor packages may remain disabled until Phase 6; foundations cannot defer isolation until after release. |
| Phase 5B | Finish-bound transfer continuation and owner-scoped receipt access after ordinary work disablement | Registered accepted evidence can resume; unaccepted local work remains held. No fake Finish or widened upload policy. |
| Phase 5C/5D | All review/package/Send operations use the scoped authority owner; preserve existing active-Admin workflow | Recovery access never approves or Sends. Any Supervisor work grant becomes usable only when the complete Phase 6 controls/tests are ready. |
| Phase 5E | Minimum signed-in read-only cloud photo recovery and same-device owner export, no evidence loss on disablement | Real disable/reconnect/recovery/transfer checks join the existing combined gate; no automatic cleanup caused by suspension. |
| Phase 6A | Shared compact workspace, explicit team selector, scoped rows/counts/history, actor/conflict display | Reuses Phase 5 scoped facts and one workspace. |
| Phase 6B–6D | Supervisors use existing assignment/template/correction/review/package controls according to capability | Same protection, consent, immutable manifest and explicit Send; no duplicate workflow engine. |
| Phase 6E | Optional per-user Supervisor/Admin alerts with team-scoped event/list/dispatch/click checks | Removal/downgrade stops new work alerts and enrollment. |
| Phase 6F — Shared access and recovery controls | Full tier/owner UI, Admin invitations, roster moves, work disable/restore, recovery screen and optional secure email | New section inside the whole numbered Phase 6 amendment, not a separate phase/design approval. Integrate alongside 6A–6E, not as a late security patch. |
| Phase 7 | Repeat multi-person work, handoffs, downgrade/disable, denied-action and recovery scenarios | No shared passwords, lost photos, unauthorized visibility or routine manual repair. |
| Phase 8A/8B/8C/8E | Verified business domain/sender/callback cutover, production owner/seats/lifecycle/retention, second-device email recovery | Real external configuration is a production gate; development is not blocked waiting for a purchased domain. |

Implement in coherent dependency batches: first the common authorization/team/access/grant foundations and safe legacy mapping; then private transfer and minimum recovery with Phase 5 review/release; then all Phase 6 shared workspace/people/tier/alert/email controls; then repeated pilot and production cutover. Plan and approve each whole parent-phase amendment once. Independent layout work may use synthetic facts before the backend is ready; it cannot claim deployed scopes or recovery from mocks.

## 10. Legacy rollout, failure handling and rollback

Existing WOs have no reliable team ownership in the baseline. Inventory existing org/Admin/Contractor/WO relationships with operator-reviewed UUID mappings. If an organization has only one current Admin, create its team through that reviewed mapping; never infer ownership from email/address. Multiple existing Admins require explicit legacy-team memberships/WO mappings that preserve genuinely authorized prior access during migration. Unmapped rows fail closed for new scoped operations and stay visibly awaiting mapping; preserve history/photos and keep a trusted operator repair path. Do not silently expose all rows to each new Admin or arbitrarily seize another Admin's work.

Deploy additive tables, grants, policies and compatibility RPCs before new UI. Test legacy role callers; don't let an old dashboard bypass team or inactive-work checks. Introduce SUPERVISOR only when enum/claim/constraint/client handling is compatible and the complete grants path is tested. Store authoritative access in trusted backend records, not solely in JWT claims; stale JWTs must fail current work checks. Inspect actual Data API exposure/grants and run advisors after DDL.

Room version 3→4 and 4→5 remain the approved Phase 5/6 baseline. Add required access/export fields to their planned migrations before implementation where possible; if runtime has already moved, create the next actual additive schema version and test all supported upgrade chains. No destructive fallback, changed DB filename, incompatible APK downgrade or evidence deletion. PhotoOwner exports read-only copies through a deliberate user-selected destination; it never deletes/renames source files or changes their bindings. Cancellation or export I/O failure leaves originals intact. Another account cannot export prior-owner files; same verified owner recovery uses existing protected account isolation.

A suspension race can leave an already queued/in-flight immutable package. The disable transaction prevents new Send actions. Already committed outbox delivery retains its manifest and provider identity and may reconcile to completion under the existing worker; changing an actor's access does not invent an “unsend.” The active permitted team manager sees the attempt. Revoked provider credentials still produce the existing truthful delivery problem. Pause workers only through their established recovery controls, never discard remote IDs or restart with fresh identities.

Rollback reference is the exact pre-runtime known-good commit recorded when implementation starts. Pause new affected grants/invites/sends/email/push work, retain memberships/grants/audit/outbox/photos, use compatible clients and forward repair. Reverting UI must not restore broad org access or work permission from a recovery session. Deployed SQL/Auth/domain state requires a separately recorded non-secret parity/rollback record; source revert alone is not evidence of external rollback. Documentation rollback can revert this isolated plan and notices without touching runtime.

## 11. Verification and genuine gates

| Boundary | Meaningful automated evidence |
| --- | --- |
| Tiers | Every allowed/denied matrix action, Tier 2 unassigned placement vs Tier 3 transfer, no Supervisor peer management/self-escalation, owner suspension precedence and concurrent seat reservations. |
| Visibility | Same org/wrong team, different org, joins/counts/search/address suggestions, history/drafts/photo paths/templates/alerts; direct Storage/Data API operations cannot bypass scope. |
| Owner | Verified immutable UUID binding, client metadata spoof denial, customer-data denial without separate grant, stale session/claim denial and last-owner protection. |
| Team continuity | Roster move leaves active WO untouched; explicit WO handoff preserves identity/history; in-progress consent; no automatic cancellation/Send when Admin disabled. |
| Recovery | Exact cutoff includes prior registered pending receipt, excludes new photos under old WO and new team/customer photos, excludes general rosters/comments; reused email/new Auth UUID denied. |
| Disable/races | Old JWT work denied; existing exact transfer reconciles; new unaccepted evidence held; package outbox immutable; concurrent access/scope/grant snapshot cannot widen recovery. |
| Email/session | No implicit signup, verified destination only, generic unknown-account response, request limits, expiry/replay, fixed callback, token scrub and recovery-only authorization despite valid Auth session. |
| Device/export | Same-owner only, offline/restart files preserved, photo-copy cancellation/low storage failure, migration upgrade, no source deletion or false server acceptance. |
| Alerts | Scoped counts/settings/dispatch/click, per-user optional channels, removal suppresses queued new sends, generic payload and no recovery-session work enrollment. |

Phase 5 adds one compatible sequence to its already planned disposable phone/laptop/provider gate: accepted Finish with interrupted private transfer → ordinary Contractor work disablement → old work writes denied → original owner's exact authorized transfer/receipt/recovery succeeds → unaccepted offline evidence stays preserved/exportable. Verify an Admin with removed team access can recover cutoff photos but cannot inspect newly added photos. Accepted Phase 4 camera behavior is reused.

Phase 6 combines the existing whole-workflow gate with individual Admin/Supervisor accounts: work management at each tier, one allowed Tier 2 staffing action, denied account/transfer/escalation actions, explicit Tier 3 team move, shared-edit conflict, owner downgrade/disable, existing-photo recovery, optional email opening in supported phone/desktop browsers and scoped push revocation. Record exact runtime head, deployment, OS/browser and permitted TEST email recipient; actual mailbox delivery/link exchange and same-device protected export cannot be proved by mocked calls. Missing sender or identity verification is BLOCKED, never PASS; independent verified work may continue.

Phase 7 repeats these under realistic sessions, offline access changes and active job continuity without SQL repair/reinstall/manual photo relocation. Phase 8 verifies production sender/domain/callback configuration and second-device cloud recovery; device-only evidence requires its original device. Level 3 runtime branches still require exact-head complete automation/live parity and explicit operator pre-merge approval.

Completion for amended Phase 5 includes safe minimum disable/recovery and scoped private evidence; amended Phase 6 includes working shared dashboard, all tier/owner controls and proved optional email/alert paths. Existing phase completion criteria continue in full. This document claims only planning/document verification.

## 12. Business email and website/domain plan — Phase 8

Record the purchased domain, intended public website URL, dashboard HTTPS URL, support mailbox, Auth From/Reply-To identity and verified sending service as environment configuration. Suggested mailbox functions are support and account notices; exact names depend on the user's chosen domain. Do not hardcode a future address or buy/provision anything as part of this amendment.

A Workspace mailbox supplies the business identity and support inbox. Transactional Auth sending is a separate configured and verified delivery path; determine whether the chosen setup supports the required sending/limits before connecting it. Reuse current working invitation delivery where appropriate. Configuring a mailbox alone is not proof that Supabase recovery messages are routed through it.

Before outside use, verify domain ownership, dashboard HTTPS, exact Auth Site URL and sign-in/invite/password/photo-recovery callback allowlists, email templates and sender authentication records required by the selected sending setup (SPF/DKIM/DMARC). Keep TEST and production recipients, credentials, roots and URLs distinct. Keep app package/signer changes governed separately; this does not rename Android or FPP.

Cut over as one documented environment change: stage domain/dashboard/support/sender settings, verify permitted disposable invitations/password reset/photo recovery and phone/desktop callbacks, then publish the reviewed configuration. Retain a deliberate valid callback transition window for legitimate previously issued links and record rollback settings; don't leave broad wildcard redirects or a permanently open stale callback. A dashboard origin/path change also requires explicit Web Push/service-worker reenrollment and truthful status; subscriptions cannot be assumed to follow a new domain. No real recipients are emailed during this documentation task.

Outside-pilot gates: verified sender and support mailbox, allowed callbacks and TLS, tested owner recovery, documented retention/export availability, subscription reenrollment and environment rollback. Pending provider choice/domain identity are genuine future setup inputs, not reasons to stop current planning or ask repeated phase-section questions.

## 13. Required governing amendments before dependent runtime

The following is the exact application list for approval integration. It records contradictions explicitly; the proposed design cannot override higher governing contracts before these replacements are applied together.

| Existing clause | Consolidated replacement to apply |
| --- | --- |
| Roadmap initial roles only ADMIN/CONTRACTOR; no extra roles without need | Add justified SUPERVISOR with cumulative server grants; no organizational OWNER solely for licensing. |
| Roadmap additional Admin creation Product Owner only | Product Owner retains allowance/tier control and delegates scoped Admin invitations to Tier 2/3 within caps. |
| Roadmap Admin organization-wide permissions / account controls | Admin work/roster scoped to explicit teams; Supervisor grants and table in section 3 govern account management. |
| Roadmap deactivation blocks all new server access; temporary reactivation as sole recovery | Ordinary work disablement preserves authenticated exact historical photo recovery and accepted Finish-bound transfers; unaccepted local evidence export stays local, normal explicit same-identity reactivation remains an option. Security lock requires verified recovery. |
| Phase 5 active same-org Admin review/Send; capturing-owner transfer/receipts | Add current team/capability checks, separate exact recovery-only reads, narrow accepted pre-cutoff transfer and minimum recovery in 5A–5E. No broad role OR clauses. |
| Phase 6 Admin-only workspace/events/notification enrollment | Use scoped active Admin/Supervisor work access throughout 6A–6E; add integrated 6F account/tier/owner/recovery controls. |
| Integration Auth/assignment/private holding/release/alerts | Add team-scoped server authority, work vs recovery separation, exact photo grants, stale-token checks and Supervisor actor/capability checks; preserve existing owners/consent/cleanup. |
| Testing authorization and Phase 5/6 evidence | Add the section 11 matrix and combined reality gates without repeating accepted Phase 4 evidence. |
| Project Profile / Rule Index | Register private platform entitlement control, scoped SUPERVISOR need, recovery owner and mandatory amendment link in role/recovery work routing. |
| Roadmap Phase 7 and 8A/B/C/E | Attach shared-account pilot and business domain/sender/production recovery gates described above. |
| Deferred customer billing tiers | Permission packages are planned here; pricing/payments remain deferred. No Stripe or other billing integration is authorized. |

Apply all affected authority clauses in one coherent approval-integration change, preserving unchanged whole-phase scope and historical evidence. Do not mark the baseline plans as already approved revisions containing this new material. After approval, record the amendment ID/revision and operator evidence on both whole parent phases and in their runtime impact records. No letter-by-letter approval is needed.

## 14. Remaining inputs and handoff

| Item to establish at implementation / production gate | Owner / placement |
| --- | --- |
| Verified Product Owner Auth UUID and trusted bootstrap/replacement procedure | Operator with governed backend implementation; Phase 5 foundation, Phase 6 controls, Phase 8 security gate. |
| Reviewed legacy team/WO mapping and actual Admin/Supervisor capacity values | Product Owner/operator; before affected Phase 5 migrations or new invitations. No guessed default unlimited allocation. |
| Exact deployed Auth/sender/email-template configuration and permitted TEST recipient | Backend implementation record; before Phase 6 email reality gate. |
| Chosen domain, Workspace/support addresses and production sending credentials/configuration | User/operator; Phase 8 environment cutover. Secret values stay outside source. |
| Production recovery/retention/export duration and operation budget | Product Owner; Phase 8 policy gate before any private deletion or outside pilot. |
| Package price and commercial limits | Business decision when needed; separate from role design and current implementation approval. |

Next checkpoint: review this one complete amendment and its phase attachments. Material tier/team/recovery authority requires consolidated plan approval under CHANGE_CONTROL_CONTRACT and Phase Staging before the affected runtime paths begin. Already approved unrelated Phase 5/6 work retains its approval; do not restart Phase 4 or ask again for unchanged design. Once approved, apply section 13 together, establish one runtime line with exact source/live-state and rollback records, and implement as far as honest automated evidence permits before the combined device/provider gates.

### Official references checked for planning

Checked 2026-10-05; recheck actual versions/configuration at runtime. These sources support Auth boundaries, not a claim that live sender/device gates passed.

- [Supabase passwordless email sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless): one-time email authentication and disabling implicit account creation.
- [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls): configured callbacks and exact production allowlists.
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp): transactional sender setup, default-service limits and sender-domain authentication.
- [Supabase changelog](https://supabase.com/changelog): relevant current email-template and Data API exposure changes; inspect actual project settings before migration/configuration.
