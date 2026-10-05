# Field Work Hub — Phase 5 implementation amendment — 2026-10-05

Status: **APPROVED WHOLE-PHASE PLAN / PLANNED — NOT IMPLEMENTED / NO RUNTIME CHANGES**.

Operator approval: **2026-10-05 at 16:32:14 America/Chicago (21:32:14 UTC)**. The operator explicitly stated: “i approve phase 5 and 6 amendments to be merged”. Approval covers revision 1 of both complete numbered parent-phase plans reviewed at `d4dc223f6c3d6df416ae0441a9c2565d8eaee87c`, including 5A–5E and 6A–6E, and merge of their documentation amendments through [PR #38](https://github.com/timbone72-CC/field-work-hub/pull/38). This successor records approval and applies the already-defined governing replacements; it does not change the technical design or claim implementation/provider/device PASS. Level 3 runtime pre-merge approval remains separate.

Plan ID: `phase-5-private-review-delivery`; revision 1. Sections 5A–5E are one numbered parent-phase plan, not separate approval units. Read with the [combined product proposal](DASHBOARD_WORKFLOW_ENHANCEMENT_PLAN_2026-10-05.md), [Phase 6 amendment](PHASE_6_IMPLEMENTATION_PLAN_2026-10-05.md) and [roadmap amendment register](ROADMAP.md#approved-consolidated-phase-56-amendment--2026-10-05).

## Later proposed shared-access amendment

[SUPERVISOR_ACCESS_RECOVERY_AMENDMENT_2026-10-05.md](SUPERVISOR_ACCESS_RECOVERY_AMENDMENT_2026-10-05.md), plan ID `supervisor-access-recovery`, revision 1, documents the subsequent user-requested Supervisor packages, Product Owner controls and preserved photo recovery. It is a complete material amendment proposed for consolidated approval, not part of the earlier approved revision-1 scope.

Phase 5 owns the common team/access/grant foundation before private evidence exposure, accepted Finish-bound transfer after ordinary work disablement, scoped review/Send checks and minimum signed-in/same-device photo recovery. The linked plan covers all 5A–5E dependencies, races, rollback and evidence. Its section 13 lists the higher-contract changes to apply together after approval; until then, do not implement the new dependent authority/recovery paths. Unchanged approved work and accepted Phase 4 evidence retain their status.

## 1. Scope, authority and baseline

Replace the planned direct-to-HNP photo path with **protected phone capture → private holding → usable Admin review → approved client package → explicit Send → confirmed configured-company delivery → guarded phone cleanup**. Phase 5 includes the minimum usable dashboard controls; review security and manual sending cannot wait for Phase 6. Phase 6 improves navigation, templates, corrections and notifications using these same owners.

Planning branch: `docs/dashboard-workflow-enhancements`; combined scope key: `dashboard-workflow-enhancement-plan`. Documentation classification is Level 1. Eventual runtime classification is Level 3 for schema, authorization, storage, durable queues, remote identity and cleanup. Baseline/rollback reference is main `7644fe3e48048d2f2068638494c8ece3348e23fe`. Runtime starts on one recorded authoritative line after this complete parent plan is approved and the governing contract amendments are integrated. Record approval evidence, exact runtime head and deployed-state parity in a Phase 5 implementation record. Level 3 pre-merge approval remains separate.

Preserve Phase 3/4 identity, offline actions, camera, requirement snapshots and accepted physical evidence. Do not change FPP, Android package/signer, existing organization/seat authority or add client login. A client company is business context inside an organization, never a replacement tenant boundary.

### Verified starting point

- Dashboard is vanilla JavaScript; `dashboard/app.js`, `session.js`, `auto-refresh.js` and `photo-requirements.js` already own dispatch, authentication, refresh and requirements. Extend them through small modules; do not introduce another app/framework or token store.
- Server already has `photos`, `photo_finish_sets`, `work_orders`, `work_order_runs`, `work_order_assignments`, `field_actions` and `photo_templates`. Reuse them rather than inventing a competing photo/run model.
- Android Room is version 3. `PhotoOwner` serializes capture/preparation/recovery; `ActionSyncCoordinator` serializes field actions; WorkManager scheduling already exists. `ProtectedPhoto.readable()` currently requires capture state `WAITING`; transfer state must be separate.
- Read-only inspection on 2026-10-05 found no Storage bucket, no installed `pg_cron`/`pg_net`, and only the existing invitation Edge Function. Vault exists. Nothing in this document claims storage, scheduler, delivery or push infrastructure is already configured or verified.

## 2. Concrete storage and provider design

**Private holding:** one private Supabase Storage bucket, `fwh-review-private`, in the existing FWH environment. Store prepared JPEGs, with immutable keys `<org UUID>/<WO UUID>/<run UUID>/<photo UUID>.jpg`. Use the Phase 4 preparation baseline; record actual derivative size, SHA-256 and provider checksum separately from original-file facts. A prepared image is the retained review/delivery evidence; this phase does not promise an indefinite full-resolution remote original archive.

Contractors upload only registered photos from their own accepted frozen Finish set. Authenticated Storage policies validate exact org, capturing user, run, assignment instance, photo and object path. No upsert, overwrite, public bucket, contractor listing of others' photos or reusable storage/Drive secret. Prefer authenticated TUS with the contractor JWT and narrow Storage policies; no broadly reusable signed upload capability. Register and authorize the transfer first, then confirm bytes through trusted backend verification. Expired authorization pauses safely. A previously authorized interrupted upload can leave an unconfirmed object; such bytes are never automatically reviewed or released.

**First supported final destination:** Google Drive, configurable per client company. Backend OAuth refresh credentials remain in server secrets/Vault, referenced by opaque credential IDs. No credential entry on contractor phones or secret values in public SQL, source, browser responses or logs. An authorized Admin configures company labels/defaults and selects among provisioned accounts/roots; connecting a new account is an operator-controlled secure setup step. No new vendor/account purchase is part of this planning change.

Each destination has org/company IDs, immutable destination UUID, provider, credential reference, root folder ID, environment, active/verified status and revision. Verification proves read/create/status-query rights in a disposable folder under the exact root and records the provider account identity. Company defaults and package overrides must be same-org and same-company, active and verified. A changed root/account creates a new destination revision; it never redirects an existing attempt.

Resolve `configured root → address group → WO UUID folder → package UUID folder`. Address is display grouping; store the resolved parent IDs and scope searches to the exact configured root/company. The WO folder carries WO UUID; package folder carries package UUID and revision. Files retain deterministic `field-photo-<photo UUID>.jpg` names. Delivered package folders remain in place when contractor assignment changes. No automatic contractor-based movement of historical client packages. Different destination roots retain distinct WO-folder mappings. Do not change sharing/permissions or claim Drive API receipt means a human client has opened the package.

A client package contains selected prepared JPEGs and a small `submission.json` with client-facing identity, selected filenames and intended notes. It excludes internal correction labels/rejection reasons, Auth IDs and internal audit history. Preview those exact contents. For all-off/zero-photo work, an explicitly approved zero-photo package still delivers its submission manifest and gets a real provider receipt. This supplies a concrete completion path without inventing photos.

The narrow provider owner supports Drive's resumable upload, stable IDs, exact confirmation and reconciliation. Additional portals, email outputs and storage providers remain separate integrations; no generic provider framework is added.

## 3. Durable records and write interfaces

Names below are planned API/schema contracts, not claims of deployed functions. Implement additive SQL migrations with the Supabase CLI at runtime; actual timestamps come from migration creation. Use FK/composite constraints to prevent cross-org/WO/run joins and server-side checks for all writes.

| Record / extension | Required data and invariants |
| --- | --- |
| `client_companies` | UUID, org, display name, active flag, default destination ID, revision. Archive used records; never delete referenced history. |
| `delivery_destinations` | Fields in section 2; FK org/company matching. Credential secret remains outside public records. Admin-readable response excludes tokens/session URLs. |
| `work_orders` additions | `client_company_id`, explicit `review_required` default true, review-policy revision, release-requirement snapshot and release revision. Existing unknown company stays unconfigured and cannot Send until assigned deliberately. |
| `photo_transfers` | One per photo: expected prepared hash/size, bucket/key, transfer state, version, verified receipt, received time, safe problem code. Receipt bound to accepted Finish set and immutable photo identity. |
| `photo_reviews` | One current decision per photo: PENDING/APPROVED/REJECTED, Admin, time, reason, reviewed transfer/content version and decision revision. Append audit events for changes; no byte mutation. |
| `client_packages` | UUID, WO, revision, current run at approval, DRAFT/APPROVED/QUEUED/DELIVERING/UNCERTAIN/FAILED/DELIVERED/SUPERSEDED, selected manifest hash, destination snapshot, release/review-policy revisions, approver/time, sender/time, delivery receipt. Delivered content is immutable. |
| `client_package_runs` | Unique package/run closure membership, accepted Finish UUID/digest, capture/release revisions and retention prerequisites. Includes retained runs with no selected client photos; never inferred from selection alone. |
| `client_package_photos` | Unique package/photo membership, exact receipt/hash/version, decision revision, one release item ID or Extra, deterministic order and inclusion. One photo counted once; source run/Finish remains unchanged. |
| `delivery_items` | Package manifest/JPEG/folder identity, preallocated Drive ID, parent ID, resumable session, confirmed offset, expected checksum/size, state, attempts, lease token/expiry and next-attempt time. Unique package/item identity; sessions are backend-private. |
| `work_order_events` | Append-only narrow history for policy, review, package and delivery changes, actor/time/revision and idempotency key. No general event-sourcing framework. |
| Android `PhotoTransfer` Room entity | Owner/org/WO/run/assignment/Finish/photo IDs, derivative hash/size, upload session/offset, transfer state, receipt version, polling/retry state and cleanup journal. Unique photo/owner; no rebinding. |

Existing `photos.sync_status`, `remote_file_id` and `uploaded_at` cannot mean private receipt. Keep legacy confirmed-client-delivery facts intact; new package-member delivery facts are authoritative for client release. Do not mark rejected/excluded photos UPLOADED to satisfy old queries. Update all old “every photo uploaded” predicates explicitly, including handoff and Complete. Original bytes and derivative bytes have different hashes/sizes; never compare a JPEG receipt against the original metadata size as if they were identical files.

### Authorized operations

Every mutation takes an action UUID and expected revision where mutable state is involved; identical retries return the prior result, changed payload with the same UUID fails. Public RPC wrappers remain security-invoker with narrowly granted private implementations. Active server-validated org/role checks, not editable `user_metadata`, authorize actions. Browser table writes cannot bypass RPC guards.

| Operation | Required checks / result |
| --- | --- |
| `admin_save_client_company`, `admin_save_delivery_destination` | Active Admin, org ownership, matching company, expected revision; configuration only, no secret response. Destination remains unverified until backend probe passes. |
| `begin_photo_transfer` | Exact registered photo and accepted Finish, same authenticated original owner/org, immutable expected bytes; returns scoped object identity/transfer revision. |
| `confirm_photo_transfer` | Backend verifies object identity, byte length and prepared hash, not client success assertion; records durable private receipt or mismatch/uncertain problem. |
| `admin_photo_access` | Active same-org Admin, receipt/version match; short-lived read URL, no public listing. URLs expire; account removal prevents renewal. |
| `admin_set_review_required` | Expected WO policy revision, audit reason; invalidates affected unsent package approval. No auto-send and no erased decisions. |
| `admin_review_photo` | Exact received content/version, expected decision revision, explicit decision/reason; invalidate affected unsent package approvals. |
| `admin_save_package` | Same WO/org/company, eligible source photos, destination snapshot, release/policy revisions; returns saved draft and coverage deficits. |
| `admin_approve_package` | Revalidate all receipt/review/coverage/conflict/destination facts transactionally, freeze manifest/hash and record approval. Missing eligibility fails with itemized causes. |
| `admin_send_package` | Active Admin, exact approved manifest/revisions, no new conflict/current-run change; atomically queue outbox once. Repeated Send returns same package/attempt. |
| `admin_retry_delivery` | Same package/destination/item IDs, retry only safe failure; UNCERTAIN requires reconciliation first. Never create a new package to conceal an ambiguous prior send. |
| `field_photo_receipts` | Original same-org capturing owner can retrieve only their own protection/cleanup facts, including accepted historical runs awaiting cleanup. No Admin/private rejection text or other contractors' evidence. |

Provider-worker claim/confirm methods are private service operations, not ordinary authenticated RPCs. Reviewer access fetches a bounded page of URLs on demand; do not issue signed URLs for every organization photo. Signed read URLs are bearer access until expiry: use a short lifetime (five minutes), omit them from logs, and do not claim instantaneous revocation of a URL already issued.

## 4. 5A — Configure company/destination and holding authority

Add minimal company/default/override selection to the existing create/edit/dashboard surface. Bind existing WOs explicitly without guessing HNP from labels. Once dispatched, company identity cannot change across clients; a wrong-client dispatch follows protected cancellation/new-WO rules. An address typo does not change property or company identity.

Provision private bucket/policies, credential references, Drive TEST root and worker invocation authorization only during governed runtime work. Only received derivatives matching registered metadata can enter the review gallery. Storage APIs must reject anonymous, wrong-org/role/owner and wrong-path operations. No permission broadening to make a failing test pass.

Verify Supabase's actual deployed Data API grants because new-table exposure defaults can change. Explicit grants, RLS and narrow RPCs are part of the migration, not inferred from platform defaults. Run security/performance advisors after live migration and resolve or document affected findings before declaring readiness.

## 5. 5B — Recoverable private transfer

Order is: durable local Finish → existing metadata/Finish action acceptance → private derivative queue eligibility → resumable transfer → trusted receipt → Admin-readable bytes. Metadata-first dashboard truth may show `Field complete — photos pending`; it cannot claim uploaded bytes from metadata alone. No upload before authorized Finish acceptance.

`PhotoTransferCoordinator` owns network byte transfer/reconciliation. It extends the existing worker orchestration after `ActionSyncCoordinator`, uses one serialized drain and session-generation guard, and processes unrelated eligible photos independently. `PhotoOwner` remains sole file mutation/preparation owner. Store session URI and offset in Room before resuming; credentials/URLs stay app-private. Do not change `ProtectedPhoto.state` to UPLOADED, because current capture/Finish validation depends on WAITING. Cleanup has its own terminal journal and explicit handling in recovery.

Local transfer states: WAITING, UPLOADING, FAILED (retry-safe), UNCERTAIN, RECEIVED; these are independent of capture, review and client delivery. Restart queries TUS HEAD before resuming; a completed/missing session reconciles the immutable object key and expected hash/size. Matching existing object confirms receipt. Authoritative absence permits a replacement session at the same key with no overwrite. Inaccessible, conflicting or ambiguous evidence stays UNCERTAIN. Persist progress only from server-confirmed offset, not bytes merely written to the socket.

Use bounded backoff for transient network/408/429/5xx failures, honoring Retry-After. Token expiry pauses/re-authenticates through the existing session owner. Permission, assignment, wrong-content and storage-capacity errors surface specific problems; originals survive. Do not create busy background loops. WorkManager constraints/persistent scheduling own Android retry; opening the app is another guarded wakeup, not a second queue owner.

Use the existing Android HTTP boundary for a minimal TUS client: session creation with exact length/key, `Tus-Resumable: 1.0.0`, HEAD offset/status reconciliation and streamed PATCH chunks matching Supabase's supported chunk requirement. Validate every session URL against the configured storage host; do not forward JWTs to a returned arbitrary host. Persist the session before sending and never derive offset from local socket writes. Protocol/offset conflicts stop that photo for reconciliation.

An accepted finished run remains upload-authorized for its original capturing identity even if a later corrective run becomes current. This is narrow Finish-bound historical evidence authority, not permission to upload stale unaccepted offline work. A stale/cancelled/reassigned run without accepted Finish preserves bytes as conflict and cannot bypass authorization. Sign Out stops authenticated upload/polling, retains protected files and lets the same authorized owner resume. A different account sees none of them. Extend assignment-cache reconciliation to recognize server-accepted historical runs awaiting protection receipts as retained delivery work, not an unauthorized active assignment or an automatic no-longer-returned conflict. Unaccepted stale local work keeps the original conflict rules. Historical receipt access does not grant Start/capture/edit authority on a closed run.

Phone says `Photos received privately — awaiting office release`, distinct from `Delivered to client`. Finish frees the contractor to leave the screen and work another job. No guarantee that Android force-stop immediately continues background work; preserve durable work and resume when the OS/app permits. Before in-progress handoff, unresolved actions/unreceived photo evidence still block consent; private-received evidence can cease being an unsynchronized-photo blocker without masquerading as client-delivered or permitting local cleanup.

## 6. 5C — Minimum usable Admin review

On the existing WO surface provide a bounded photo viewer: item/stage groups, thumbnails, inspect/next/previous, receipt status, include/exclude selection, individual Approve/Reject with reason, Review required toggle, saved draft and clear errors. Stage/framing is saved context; no AI classification or multi-item credit. Phase 6 adds efficient bulk review and workspace layout.

Review required defaults On for new work. On requires valid individual approval for every selected photo. Off allows selected received PENDING photos without generating false approval timestamps. REJECTED stays excluded in both modes unless deliberately changed. Both modes require package approval and explicit Send. Missing receipt, coverage, authorization or protected conflicts cannot be bypassed by the toggle. Record who changed it and invalidate unsent approval on change.

A review decision belongs to exact immutable derivative content; a mismatched replacement is not the same reviewed evidence. No storage overwrite to “replace” a rejected image. Corrections use new photo UUIDs/runs in Phase 6. Surplus rejection may need no contractor revisit if eligible package coverage remains sufficient. Required deficits explain why Send is blocked; Phase 5 shows them truthfully and Phase 6 supplies integrated correction dispatch. No generic requirement override is introduced.

## 7. 5D — Package approval, Send and provider confirmation

For Phase 5 a package normally draws from the current accepted frozen run. Define `release_requirement_snapshot` from that run's requirement snapshot; enabled Total and named-item minima govern selected package coverage. Each selected photo contributes once to Total and at most one named item; Extra contributes no named item. Captured Finish counts and selected release coverage remain distinct. Rejecting evidence does not revoke/rewrite an accepted Finish. With all requirements off, empty or voluntary-photo packages are valid if explicitly approved.

An Admin reviews a saved preview containing company, external WO number, client-facing description/notes, photo order, coverage and exact destination. Approve records an immutable manifest hash. Changes to selection, notes, content/decisions, review policy, release goals, destination or current-run identity invalidate unsent approval. Another Admin's stale change returns conflict and requires reload/review; no last-write-wins. Send rechecks eligibility atomically and queues one attempt. Navigation, toggles, approval and notifications do not Send.

No package can Send while earlier delivery for that WO is unresolved, a corrective run is open or a protected assignment/cancellation/content conflict remains. Once QUEUED/DELIVERING, its manifest cannot be edited. Concurrent review/policy edits may be recorded for future packages but do not alter the in-flight manifest; warn that the queued package uses its recorded snapshot. No “unsend” promise. Corrective runs must wait for any in-flight delivery to reconcile before first/client-return classification is committed.

`ClientDeliveryWorker` in the trusted backend owns remote writes, retry and reconciliation. A DB outbox with fenced lease claims, capped attempts per invocation and scheduled continuation survives browser closure and function restart. Provision one `pg_cron` + `pg_net` scheduler invocation per minute, authenticated with a dedicated backend secret held in Vault; a public/publishable key alone does not authorize worker processing. Pause/deactivate the job for recovery. Bounded invocations stream prepared bytes rather than buffer an entire job, persist progress between resumable chunks, and stop safely before Edge runtime limits. The scheduler is new infrastructure to verify, not an already-running service.

Preallocate Drive IDs for folders, JPEG files and submission manifest using `files.generateIds`, persist each identity before create, then use the same IDs on retries. Store exact parent/destination and appProperties. Query resumable offset after interruption; reconcile a finished create by known ID, expected parent, size and checksum. An expired session does not authorize a new file ID. A repeated create conflict with the known ID prompts reconciliation. Multiple/mismatched/inaccessible candidates remain UNCERTAIN. A stale lease worker cannot commit results or generate a competing identity; preallocated IDs fence unavoidable in-flight remote requests.

Package status is DELIVERED only after all selected files and submission manifest are verified at the recorded provider destination and the complete receipt transaction commits. A partially sent package is visible as partial/failed/uncertain, never Complete. Drive can expose files incrementally within the package folder; no false claim of atomic external visibility. Folder/file presence does not constitute email, client portal submission or human acknowledgment. Unknown outcome stays unresolved; retry the same immutable manifest after reconciliation, not a new package with fresh IDs.

## 8. 5E — Retention, cleanup, completion and recovery

### Fixed pilot retention policy

Private holding retains **all verified prepared evidence**, including rejected/unselected photos, immutable identity/Finish provenance and review history. Automatic server deletion/expiry is disabled through Phases 5–7. No ordinary Admin/Contractor Storage DELETE/overwrite permission. Quota/access loss is a visible storage problem, not permission to lose originals. Monitor holding usage and failed writes; document actual limits in the implementation record. Production retention, backup/export and authorized deletion belong to the mandatory Phase 8 storage gate; no retention duration is silently invented from FPP settings.

Phone-original automatic cleanup requires all of:

1. same original owner/WO/run/photo and accepted Finish identity;
2. a verified private receipt for that photo's prepared bytes, including any excluded/rejected evidence;
3. confirmed DELIVERED final package covering the applicable accepted run(s), with server-recorded closure membership and no unresolved protection conflict;
4. durable owner-scoped Room copy of the package/retention receipts and cleanup decision;
5. original Finish/metadata actions accepted, with no pending action requiring those originals for validation.

A private receipt, Finish, review approval, package approval, Send tap or notification satisfies none of the final-delivery requirement by itself. Excluded evidence gets `retained privately / excluded from client package`, never a false client-file ID or uploaded timestamp. Included photos retain per-package client file IDs, even when selected again in a later corrected submission.

`PhotoOwner` executes cleanup from a journal: READY → CLEANING → CLEANED after deleting original/derivative, leaving identity, capture facts, hashes, receipt and history. Crash during deletion resumes deletion only; it never calls camera preparation or re-uploads a confirmed delivery. Modify recovery and frozen-readability checks only at the explicit terminal cleanup boundary. File-delete failure retries cleanup without changing provider success. Server receipt outage, mismatch or missing local journal retains bytes and surfaces the problem.

Cancelled, rejected-only, never-sent and conflicted work with no delivered closure **does not automatically clean phone originals**. Keep the protected record visible as held evidence; an Admin may resolve valid work through supported correction/release, or cancel business work while evidence remains held. There is no hidden force-delete or fake-delivery escape. Pre-Finish explicit safe discard remains the already-approved Phase 4 path. Any later evidence-only release/deletion feature requires its own material amendment. This is a defined protected outcome, not a promise that every cancelled job will eventually clear itself.

### Derived Complete

Complete requires: current accepted run FIELD_COMPLETE; server-valid capture minima; latest required client package DELIVERED with eligible selected coverage and applicable approvals; all accepted evidence in the explicitly recorded covered runs received/privately retained; no open correction or unresolved assignment/cancellation/transfer/delivery/placement conflict. It does **not** require every rejected/extra photo to be client-delivered. Phone cleanup pending due solely to a file-delete error is separate maintenance and does not undo provider delivery; a missing receipt/protection conflict still blocks Complete.

Phase 5 uses the same completed/history facts that Phase 6 will render. Complete can leave Active only when this predicate is true. Contractor receipt polling continues for accepted historical runs so a follow-up/current-run change never strands earlier originals. Confirmed delivery history survives later Drive disappearance; do not police permanent presence or auto-recreate files after historical delivery.

### Recovery and rollback

Room migration 3→4 adds transfer/cleanup records and exportable schema; no destructive fallback or change to existing DB filename. Backfill existing protected photos as NOT YET TRANSFERRED, preserving paths, state, owner and Finish identifiers. Phase 6 follows with 4→5 if its new fields require it. Test both direct and chained upgrade paths against real exported schemas. APK rollback after Room upgrade must use an evidence-preserving recovery APK that understands the new schema and pauses affected networking; an older v3 binary is not a safe downgrade. Preserve package and signer.

Server migrations are additive: snapshot existing rows, inspect live drift, add guarded tables/columns/RLS/grants/RPCs and explicit backfill without guessing company/destination. Do not rewrite accepted Phase 4 manifests, clear photos or infer legacy receipt/delivery from labels. If any pre-existing confirmed Drive delivery exists, preserve its evidence and recognize it through a documented compatibility read; never redeliver it to fill new fields. Record exact deployed migrations/functions/bucket/policies/cron/secret-reference configuration without secret values.

If interrupted: pause worker/scheduler and new sends; retain outbox, IDs, sessions and files; reconcile attempts before resuming. Dashboard rollback can remove new controls only while preserving recorded server state. Do not restore obsolete direct-upload/cleanup predicates. Remove disposable fixtures only after the evidence gate and explicit safe fixture disposition; do not use production data cleanup as migration rollback.

## 9. Exact amendment application

The operator approved these clauses with this whole-phase plan; they are applied to the governing roadmap, integration/testing contracts and project profile in PR #38. The table records the superseded assumptions and their current replacements.

| Current clause | Applied approved replacement |
| --- | --- |
| `INTEGRATION_CONTRACT.md`, Photo sync/upload: cleanup after confirmed remote success | “Local original/derivative cleanup requires confirmed applicable final client-package delivery, durable local/server bookkeeping, and verified private retention for excluded evidence. Private staging receipt alone never authorizes cleanup.” |
| Integration, Google Drive/storage: permanent HNP-only destination | “Private Supabase holding is organization-controlled review storage. First final provider is configurable company-controlled Google Drive, with same-org/company authorized accounts/roots and immutable package destination snapshots. HNP is one configuration; contractors receive no reusable provider secrets.” |
| `TESTING_CONTRACT.md`, sync/upload cleanup and Admin visibility | Apply the same two-receipt cleanup guard; cover private receipt, individual decisions, package approval, final delivery and excluded evidence distinctly. |
| Roadmap global archive/reassignment hierarchy and direct Phase 5 delivery | Replace with sections 2–8 here: stable configured-root/WO/package identity, no historical-package move on reassignment, private holding and explicit release. |
| Roadmap Fully Complete / Phase 6 all-frozen-photos delivered | Replace with the section 8 package/coverage/private-retention predicate; keep field states unchanged. |
| Roadmap phase/deferred push rules | Keep Phase 5 phone attention/OS mechanics, but Phase 6 adds the explicitly bounded optional Admin alerts described in its plan. |

These are narrow behavioral amendments. All unrelated organization, camera, offline, identity, uncertainty and evidence protections remain governing. Phase 4 accepted scope/result paragraphs remain historical truth; future private-transfer eligibility supersedes their HNP delivery wording only for new Phase 5 behavior.

## 10. Verification and whole-phase completion

Focused tests while building, then one complete automated suite on the exact proposed runtime head. Existing `android-ci`, `dashboard-ci` and `database-ci` remain owners of automated checks; extend meaningful suites/gates rather than duplicate implementations in tests. Record backend/live parity and advisor results. Documentation-only approval integration requires document/contract review; automated PR checks are recorded separately and are not device/provider evidence.

| Boundary | Required automated evidence |
| --- | --- |
| Auth/storage | Wrong org/role/owner/path denied; received historical Finish authorized narrowly; revoked/stale unaccepted evidence denied; no public/overwrite/delete/secret leak. |
| Transfer | Missing preparation, hash/size mismatch, interrupted/changing token/TUS session, durable offsets, unknown success, authoritative absence, duplicate path and one-photo failure independence. |
| Review/release | Toggle On/Off, rejection persistence, stale decisions, immutable content, required selected coverage, Extra/Total counts, zero-photo manifest and no auto-send. |
| Races | Two Admins, duplicate Send/action UUID, setting/decision/current-run changes, in-flight immutability, stale lease and immutable destination under default changes. |
| Provider | Same preallocated IDs across timeouts/expired sessions; 409 reconciliation; correct parent/checksum; partial delivery; no false Complete or blind recreate. |
| Persistence/cleanup | Room 3→4, owner/session isolation, private receipt cannot delete originals, excluded private retention, terminal cleanup crash recovery, accepted historical-run polling and recovery APK compatibility. |

One combined real phone/laptop/provider gate after independent automated work is ready:

1. Disposable configured company/root; real offline photos/Finish; restart and reconnect. Retain accepted Phase 4 camera evidence; test transfer/recovery effects only.
2. Metadata-first state, private receipt and actual Admin image inspection; unauthorized/client/public access denied; originals still present after private receipt and review.
3. Review On blocks pending/rejected selected evidence; Off permits selected pending without false approval, still requiring explicit package approval/Send. Demonstrate rejected surplus exclusion and retained evidence.
4. Change to another verified same-company TEST destination before approval; Send; prove exact destination/files/manifest and interruption/idempotent reconciliation without duplicate IDs.
5. Original cleanup only after final server receipt plus durable phone bookkeeping; preserve excluded metadata and private bytes. Repeat only affected failed checks.
6. Demonstrate supported Android background retry and locked-phone behavior; force-stop/reopen recovery is truthful. Revoke/restore a disposable credential without losing local evidence; validate recovery build/update without uninstall.

Stage exact APK/dashboard/function/migration revisions, rollback artifact and one straight-line checklist. Real credentials/provider configuration and quota are genuine boundaries: automation cannot declare them passed. Optional notification tests belong to Phase 6 and cannot postpone this minimum usable release workflow.

Phase 5 complete only when **usable private review, guarded On/Off package release, exact configured Drive delivery, protected interruption/restart, rejected-evidence retention and final-delivery-gated cleanup are proven**, required exact-head automation and live parity pass, explicit Level 3 merge approval is recorded and integration/publication checks agree. No runtime or physical evidence is claimed by this approved planning update.

## 11. Official implementation references checked for planning

Recheck current versions before runtime integration; these references support the chosen boundaries, not a claim that provider gates passed.

- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads): TUS sessions and immutable/no-overwrite transfer.
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control): private authorization/RLS.
- [Supabase Edge limits](https://supabase.com/docs/guides/functions/limits): bounded streaming invocations.
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions): cron/net and Vault configuration.
- [Drive upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads): resumable status and pre-generated IDs.
- [Supabase changelog](https://supabase.com/changelog): explicit Data API/grant verification rather than exposure assumptions.
