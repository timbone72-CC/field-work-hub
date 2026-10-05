# Field Photo Prep Team Integration Contract

## Purpose

Protect the boundaries between the Admin dashboard, Android contractor app, Supabase, local offline state, camera/photo storage, background sync, and company-controlled remote photo storage.

This contract does not authorize unfinished roadmap phases. It defines safety rules those phases must preserve once implemented.

The complete Phase 5/6 amendments were approved on **2026-10-05 at 16:32:14 America/Chicago** and integrated through [PR #38](https://github.com/timbone72-CC/field-work-hub/pull/38). Their approved private holding, controlled release, fresh Accept/follow-up and optional Admin notification boundaries replace the earlier HNP-only/direct-delivery assumptions. These are governing implementation rules, not claims that new infrastructure/runtime is deployed.

The shared-access/recovery amendment was approved **2026-10-05 at 17:40:18 America/Chicago (22:40:18 UTC)** (“review approved”, reviewing `af056da36c5ecbcfac16cb8e1c0b8ce3832754fd`) in [PR #39](https://github.com/timbone72-CC/field-work-hub/pull/39). The [shared-access amendment](docs/SUPERVISOR_ACCESS_RECOVERY_AMENDMENT_2026-10-05.md) governs the added Phase 5 foundations, whole Phase 6 including 6F and Phase 7/8 attachments. These are approved future implementation boundaries; no new role, grant, recovery service or email/domain configuration is claimed deployed.

## Mandatory reread before integration work

Before changing Supabase/Auth/RLS, local persistence, offline synchronization, reassignment, camera/photo state, background work, remote storage, upload, retry, reconciliation, or cleanup:

1. read `AGENTS.md` completely;
2. read the relevant phase in `docs/ROADMAP.md` completely;
3. read `CHANGE_CONTROL_CONTRACT.md`;
4. read `TESTING_CONTRACT.md`;
5. read `docs/PHASE_STAGING_DOCTRINE.md` when the change depends on real-device/provider evidence or crosses a phase boundary.

Do not substitute memory, a chat summary, earlier-session notes, or assumptions from FPP for these rereads.

If the roadmap does not define the intended cross-system behavior, **STOP. Integration code may not invent it.**

## Authority map

### Supabase is authoritative for

- authenticated user identity;
- organization membership, role, responsible-team membership/scope, Supervisor tier, work entitlement and exact historical photo-recovery grants;
- server-visible work-order identity/details;
- current server assignment;
- server-approved reassignment request/consent state;
- server field-status state after successful synchronization;
- server-visible photo metadata/sync state once reported;
- verified private evidence receipts, review policy/decisions and correction obligations;
- immutable approved package/destination snapshots, explicit Send authority and confirmed delivery/closure metadata.

### Android local persistence is authoritative for

- whether a downloaded WO is available offline on that device;
- locally captured photo files/metadata before server/remote confirmation;
- pending offline field actions not yet accepted by the server;
- pending local photo sync attempts/recovery evidence;
- durable exact-instance human Accept before server confirmation and owner-scoped final-delivery/cleanup receipts.

Local pending state must never be falsely presented as already confirmed by Supabase.

### Remote photo storage is authoritative for

- whether a specific remote photo object/file actually exists after confirmed upload;
- its stable remote identity once created/confirmed.

A local queue update alone cannot prove remote success.

## Authentication and authorization

- Supabase Auth owns login identity.
- `organization_id` and application `role` are server-controlled authorization facts.
- Do not authorize from user-editable metadata.
- Android/browser clients use only publishable/public client credentials appropriate for untrusted clients.
- Service-role/secret credentials never ship in Android/browser code.
- RLS/narrow RPCs enforce authorization even if a client UI is modified or bypassed.
- JWT claims can become stale; sensitive work/read/Storage operations revalidate current server role/org/team/tier/access/session rather than relying solely on old claims. Refresh/login does not turn a disabled work entitlement back on.
- Contractor devices never receive the company Google Drive account password or long-lived company storage credentials.

## Shared office authority and photo recovery

The approved [shared-access amendment](docs/SUPERVISOR_ACCESS_RECOVERY_AMENDMENT_2026-10-05.md) sections 3–8 define the cumulative permission matrix and server owners. Admin work/roster is limited to explicit teams. Tier 1/2 Supervisor access is explicit supervised teams; Tier 3 is one granted organization. Product Owner alone controls Supervisor grants/allowances and owner-imposed suspensions through a private verified-UUID capability; that capability alone does not authorize customer photos or Send. Tier 2/3 Admin invitations respect owner-set capacity and the existing trusted invitation boundary. Only Tier 3 adds Contractor recruitment/cross-team roster movement; existing own-team Admin recruitment remains within Contractor caps.

WO responsible-team identity is independent of current roster. Roster move, office ownership handoff and Contractor reassignment are distinct audited operations; historical photo/run/provider identities stay fixed. In-progress Contractor consent remains required. An Admin's disablement preserves jobs and allows only an active explicitly authorized replacement/manager to continue. Concurrent edits and access changes use expected revisions/idempotent actions.

Ordinary work disablement preserves Auth identity and exact removed-scope photo grants while denying every new operational permission. Photo grants pin org/user/photo/Finish/content/cutoff IDs, including previously registered accepted frozen evidence received later; no ongoing grant to later photos under an old WO. Recovery has bounded view/download/export with minimal provenance, no roster/internal-review access and no work edits/Accept/Start/Finish/assign/review/approve/Send. Cloud recovery returns retained derivatives; local originals require the original device/identity boundary. Security lock requires verified identity recovery and never purges evidence.

Previously accepted pre-cutoff registered Finish-bound transfers and owner protection receipts may continue narrowly with unchanged bytes/identity. Unaccepted offline actions/photos remain protected local evidence/export, not fake accepted work or a new quarantine intake. Explicit authorized same-UUID business reactivation remains possible under existing conflict/seat/suspension checks. Sign-out stops authenticated network work; another user gets no prior-owner access. Access revocation cannot recall an already downloaded image or issued five-minute bearer URL.

Optional recovery email targets the existing verified Auth account, disables account creation, uses fixed allowed callbacks, one-time expiring verification and current exact grant checks. It never restores work entitlement or carries unrestricted photo authority in a URL. Generic responses/rate limits/token scrub and session expiry follow the approved plan; password reset remains separate. No company secret or photo attachment is emailed. Work disablement and export never authorize cleanup; final-delivery/receipt/journal predicates and pilot no-purge retention remain. Phase 8 retention must preserve the agreed recovery/export boundary before deletion.

All relevant list/count/workspace/history/template/draft/photo/review/correction/package/Send/alert endpoints and direct table/Storage policies use the same current scoped capability predicate. Recovery uses separate narrowly authorized interfaces, never a blanket active-or-recovery policy over operational records. Existing public security-invoker wrappers/private implementations and session/file/action/transfer/provider/cleanup owners remain. Supervisor runtime cannot activate until its complete Phase 6 controls and verification are ready.

## Work-order identity

- Team WO UUID is permanent identity.
- WO number/address/work type/instructions/due date are mutable business/display fields, not identity.
- A server-generated WO number and an Admin-provided external number must not replace the permanent UUID.
- Local cached WOs are keyed by Team WO UUID.
- Photo binding uses Team WO UUID, not address text or visible WO number.

## Assignment, download receipt and human Accept

- Assignment is server-authoritative.
- Download receipt means the assigned authenticated contractor app durably received/downloaded that exact assignment/run before recording receipt to the server. It does not prove human acknowledgment.
- Accept is one deliberate contractor tap, durably persisted before the phone says Accepted, then idempotently confirmed for the exact user/run/assignment instance. Pending sync and server confirmation remain distinct.
- Receipt, Accept, Start and Finish are separate facts; none invents another. Accept is not a mandatory Start prerequisite.
- Reassignment/follow-up requires fresh download receipt and human acknowledgment. Historical facts stay with their original instance; stale ACK is not rebound.
- Receipt is tied to the current assignee; reassignment clears/invalidates prior-assignee receipt.
- Repeated receipt acknowledgement must be idempotent.
- `ASSIGNED` work may be reassigned by Admin under the approved server action.
- `IN_PROGRESS` reassignment requires current-contractor consent under the approved flow.
- approval transfers the WO while preserving truthful started-work state;
- decline leaves current assignment unchanged;
- field-complete/cancelled reassignment behavior must follow the roadmap and may not be improvised client-side.

## Offline work-order integration

Phase 3 must define the exact implementation before code is added. Once implemented:

- downloaded assigned WOs persist locally without contractor configuration;
- previously downloaded work remains readable without network after app/process restart;
- offline ACK/Start/Complete actions are persisted locally before the UI claims they are queued;
- local pending actions synchronize through narrow server-authorized operations;
- retries are idempotent;
- reconnect must not silently overwrite or erase locally started work;
- remote reassignment/cancellation racing local offline work must surface an approved reconciliation state;
- client-side cache eviction must not remove unresolved started work or unconfirmed photos.

Room is the planned structured local store because Team has multi-WO/offline-state requirements; contractors do not manually configure Room.

## Background-work integration

When background sync is introduced:

- use persistent work only for approved retry/sync tasks;
- background scheduling does not create new business authority;
- a worker must re-read durable state before acting;
- process death/restart must not turn stale in-memory selection into retry authority;
- connectivity returning may trigger eligible work, but must not bypass conflict/uncertainty guards;
- repeated worker execution must be safe/idempotent.

WorkManager is the planned Android mechanism for persistent deferred work where roadmap behavior requires it.

## Camera and local photo integration

Carry forward FPP-proven behavior unless the Team roadmap explicitly changes it:

- reserve permanent photo UUID before capture;
- reserve protected app-private original destination before bytes are accepted;
- one shutter press = one immutable photo identity;
- multi-shot session photos remain bound to the same selected Team WO unless a new session is deliberately started;
- protected original is never overwritten by preparation;
- preparation/network/provider/upload failure cannot destroy an unconfirmed original;
- process restart recovers durable captured photos;
- camera controls do not mutate WO/photo identity or sync state.

## Prepared-copy integration

- prepared/compressed copy is separate from protected original;
- preparation starts only after capture is durably recorded;
- preparation failure leaves the protected original recoverable;
- restart may recreate missing eligible prepared derivatives;
- prepared-copy generation must preserve usable orientation;
- preparation concurrency must not corrupt or redirect photo identity.

## Photo sync/upload integration

The Team upload implementation may differ from FPP's SAF path, but it must preserve the proven safety boundaries:

- every photo retains immutable Team WO identity;
- remote destination is explicit and server/company authorized;
- contractor device does not infer a destination from visible address/folder names;
- remote identity is retained once created/confirmed;
- success is recorded only after remote success is confirmed;
- known-safe failure may retry;
- ambiguous/uncertain remote outcome must not trigger blind duplicate create;
- retry/reconciliation must preserve original photo and destination identity;
- one photo's failure must not corrupt unrelated queue items;
- local original/derivative cleanup requires confirmed applicable final client-package delivery, durable local/server bookkeeping, and verified private retention for excluded evidence; private staging receipt alone never authorizes cleanup;
- rejected/unselected photos retain private evidence/history without false client-delivery flags; cancelled/never-sent/conflicted work lacking delivered closure keeps protected originals;
- terminal cleanup recovery preserves metadata and never recreates/re-uploads confirmed deliveries.

## Google Drive/storage boundary

Private Supabase holding is organization-controlled review storage. First final provider is configurable company-controlled Google Drive, with same-org/company authorized accounts/roots and immutable package destination snapshots. HNP is one configuration; contractors receive no reusable provider secrets. Supabase remains authoritative for business, review and release state.

- Team must not become architecturally inseparable from Google Drive.
- contractors never receive a company password or reusable privileged provider credentials;
- upload authorization must be mediated by approved backend/server logic;
- no client may broaden Drive sharing/permissions unless explicitly planned;
- visible folder names are organizational context, not permanent business identity;
- uncertain Drive/API outcomes fail closed until reconciled.

## Private review, client release and corrections

- Actual verified private bytes, not registered metadata, make evidence available for review. No public/client holding access or implicit release.
- Review required On requires individual approval of selected exact content; Off permits selected received non-rejected pending evidence without falsifying approval. Both require package approval and explicit Send.
- Capture counts, review decisions, selected release coverage, package approval and final delivery remain independent facts. One photo counts once toward final Total and at most one named release item.
- Explicit same-WO corrective runs may follow accepted FIELD_COMPLETE before first delivery; classify internal corrections versus client returns from confirmed delivery history. New run/assignment, fresh receipt/Accept and zero new capture counts preserve old evidence/history.
- Narrow reference-photo access exposes only deliberately shared correction evidence to the currently authorized contractor; no unrestricted historical gallery.
- Package selection may span eligible same-WO/company runs with explicit release-item/active correction-obligation mappings. Old photos cannot satisfy new-run capture/new-photo minima. Reasoned successor obligations preserve intermediate failures without forcing rejected evidence into final selection.
- Freeze approved queued/in-flight/sent manifests and exact destination/remote IDs. Reconcile any unresolved delivery before conflicting follow-up/release. Delivered package folders do not move on contractor reassignment.
- Private pilot retention has no automatic purge through Phases 5–7. Production retention/export/deletion is an explicit Phase 8 gate; storage pressure cannot bypass protected originals.

## Optional Admin/Supervisor alert integration

- Approved Phase 6 alerts have independent per-type Dashboard/Phone/Computer settings and authenticated enrollment on supported devices.
- Browser Web Push/service worker is an interruption channel, not a second authorization, field-action, release or cleanup owner. Generic lock-screen payloads contain no customer details/photos/tokens.
- Server checks current active Admin/Supervisor org/team/tier/work access before event listing/dispatch; click fetches the job through the same authorization. Removal/downgrade disables new scoped work pushes; recovery-only identity cannot enroll for work alerts. Permission failure, endpoint expiry, quiet hours and OS/browser limitations remain truthful.
- Deduplicate event production; acknowledge/snooze never resolves a protected job problem. Push service acceptance is not proof of OS display or human reading; notification failure cannot lose evidence or alter work state.

## Cross-system conflict rules

When local and server state disagree:

- do not silently discard locally started work;
- do not silently move photos to a new assignee/WO;
- do not let stale server data erase unconfirmed local evidence;
- do not claim server acceptance before the server accepted it;
- do not invent conflict resolution in UI code;
- surface an approved pending/conflict state until the roadmap-defined rule resolves it.

## Restart/recovery rules

Any integration that can leave work in flight must define restart behavior before implementation:

- what durable record exists before the risky action;
- how an interrupted action is recognized;
- whether retry is safe, unsafe, or requires reconciliation;
- what evidence is retained to avoid duplicates/misattribution;
- when local cleanup becomes safe.

## Reality gates

Mocks/fakes/emulators may prove deterministic logic, but cannot alone prove:

- actual Android offline/restart behavior;
- CameraX/device behavior;
- Android background execution under real lifecycle constraints;
- real remote upload/resume/reconciliation behavior;
- real device storage/provider behavior.

Use `docs/PHASE_STAGING_DOCTRINE.md` to stage only the smallest necessary real-device gate after all provider-independent work is complete.

## Relationship to the governance set

- `AGENTS.md` owns mandatory entry/reread rules.
- `docs/ROADMAP.md` owns approved product behavior and phase gates.
- `CHANGE_CONTROL_CONTRACT.md` owns risk classification, approval, and rollback.
- `TESTING_CONTRACT.md` owns test selection/timing/failure-stop behavior.
- `docs/PHASE_STAGING_DOCTRINE.md` owns evidence-based phase/device staging.

## Governing principle

**No integration boundary may silently change identity, authority, ownership, or the truthfulness of field/photo state.**
