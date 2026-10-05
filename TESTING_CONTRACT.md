# Field Photo Prep Team Testing Contract

## Purpose

Define which tests run, when they run, and when testing must stop work. The goal is proportional verification: enough evidence to protect multi-user authorization, offline work, and field photos without repeating expensive checks after every small edit.

## Mandatory reread before test planning

Before selecting tests, interpreting a failure, declaring a runtime head ready, or staging a device gate:

1. read `AGENTS.md` completely;
2. read the relevant phase in `docs/ROADMAP.md` completely;
3. read `CHANGE_CONTROL_CONTRACT.md`;
4. read `INTEGRATION_CONTRACT.md` when the work touches Supabase/Auth/RLS, local persistence, offline behavior, reassignment, camera/photos, background sync, remote storage, upload, retry, or cleanup;
5. read `docs/PHASE_STAGING_DOCTRINE.md` before deciding that phone/device evidence is required or before declaring a device gate complete.

Do not replace these rereads with memory, a chat summary, prior CI results from another runtime head, or earlier-session notes.

If the roadmap does not define the behavior being tested, **STOP. Testing cannot invent the product rule.**

## Development loop

- Documentation-only changes require diff/contract review only.
- For runtime changes, run the smallest focused test set that directly covers the changed behavior.
- After fixing a focused failure, rerun that focused test first.
- Do not run the complete suite after every edit unless the change is so broad that no meaningful focused boundary exists.

## Final runtime gate

Before merging a runtime change:

1. focused tests for the changed behavior pass;
2. the complete automated suite passes once on the exact final runtime head;
3. affected smoke/device/provider checks required by the change class pass;
4. the tested head is the head proposed for merge.

A successful CI run on the exact final runtime head satisfies the complete-suite requirement. Do not duplicate it locally without a concrete reason.

## Required behavior boundaries

As Team grows, automated coverage should be organized around state/identity boundaries rather than UI snapshots alone.

### Authorization and assignment

Cover:
- organization isolation;
- Admin vs Contractor permissions;
- server-authoritative assignment;
- assign/reassign validation;
- durable contractor download receipt versus one-tap human Accept, with fresh exact-instance facts and no automatic acknowledgment from Start/Finish;
- consent-required handoff of in-progress work;
- stale/unauthorized client requests denied by server;
- narrow RPC behavior and direct-table privilege boundaries.

### Offline work orders

When Phase 3 is implemented, cover:
- assigned WOs persisted locally;
- cached WOs survive process/app restart;
- offline opening of downloaded assignments;
- offline ACK/Start/Complete intent persisted durably;
- reconnect sync is idempotent;
- locally started work is not silently destroyed by remote reassignment/cancellation;
- conflicts remain visible/recoverable until resolved;
- one WO failure does not corrupt unrelated local WOs.

### Photo identity and capture

When photo capture is implemented, preserve FPP-proven boundaries:
- permanent photo UUID reserved before capture;
- every shutter press has unique protected identity/file;
- immutable Team WO binding;
- protected original persists despite callback/preparation/network/upload failure;
- multi-shot capture cannot overwrite prior shots;
- process restart recovers durable captured photos;
- camera controls cannot mutate photo/WO identity.

### Preparation

Cover:
- prepared/compressed copy is separate from original;
- orientation remains usable;
- preparation failure preserves original;
- restart can resume/recreate missing eligible prepared derivatives;
- preparation concurrency cannot corrupt identity/files.

### Sync/upload

Cover:
- queued state survives restart;
- retry preserves exact original Team WO and remote destination identity;
- known-safe failure remains retryable;
- confirmed success is durable before cleanup;
- `UNCERTAIN`/ambiguous remote outcome stops blind retry;
- duplicate-prevention/reconciliation rules;
- one photo failure does not corrupt unrelated photos;
- local original deletion requires confirmed applicable final client-package delivery + durable local/server bookkeeping + verified private retention/closure of excluded evidence;
- private holding receipt, review/package approval, Send and notifications cannot authorize original cleanup;
- rejected/excluded/cancelled/never-sent evidence stays truthful and protected; terminal cleanup restart never triggers re-upload.

### Admin visibility

Cover that dashboard/server-derived counts distinguish:
- field status;
- assignment receipt;
- captured photos known to server;
- privately received prepared evidence versus confirmed client-package delivery;
- waiting/failed/uncertain photos;
- review policy/decisions, selected coverage and package approval separately from Send/confirmed delivery;
- complete/problem derived presentation without falsely marking excluded evidence client-delivered.

### Phase 5/6 workflow and optional alerts

The complete plans approved 2026-10-05 govern additional coverage: company/template/destination isolation and defaults, private object authorization/content receipts, Review required On/Off, bulk revision races, approval invalidation, immutable Send/remote IDs, cross-run release coverage and active correction-obligation supersession. Follow-ups preserve same WO/client number and old history while requiring new run/assignment/receipt/Accept and zero capture counts. Verify bounded workspace navigation, server-saved drafts, stale refresh conflicts and account isolation.

Optional alerts require per-type/channel/device authorization, timing/timezone/DST/quiet-hour rules, snooze versus resolution, deduplication, role/endpoint revocation, generic private payloads and authorized click. Real supported phone/computer delivery and OS/browser limitations are a Phase 6 device gate; mocked push success cannot prove them. Notification failure does not change job or photo authority. See the complete Phase 5/6 plans linked from the approved roadmap for exact combined gates; preserve accepted Phase 4 observations.

## Realistic integration tests

Mocks/fakes are useful during development but do not prove physical Android, network, camera, or Google Drive/provider reality.

Use real-device checks only for the smallest boundary automation cannot honestly prove, such as:
- actual CameraX capture/controls;
- app/process restart on a real device;
- offline/airplane-mode usability;
- Android background execution behavior;
- real remote upload/resume/reconciliation behavior;
- device storage pressure where relevant.

Never use live customer work/photos when disposable test data can prove the behavior.

## Supabase verification

For Supabase Level 3 changes, test the exact authorization boundary using real JWT/RLS behavior or an equivalent controlled project context:
- allowed same-org action succeeds;
- wrong-role action fails;
- wrong-org/cross-tenant action fails;
- bogus/invalid assignee/target fails;
- direct broad table operations remain denied when narrow RPCs are intended;
- migrations are mirrored and advisors checked.

## Offline/retry coverage

Changes affecting offline work or retry must include at least:
- network unavailable before action;
- network loss during/after action where meaningful;
- process/app restart with pending local work;
- repeat sync/retry is idempotent;
- stale server data does not silently overwrite protected local progress;
- reconnection converges or surfaces a conflict instead of guessing.

## Failure gate

A required test failure stops:
- verification claims;
- merge;
- publication/deployment;
- device-gate progression that assumes the failed behavior works.

Fix the failure, rerun the focused test, then run the final complete suite once when the branch is ready.

## Device-gate staging

The approved numbered parent-phase plan owns the verification schedule for all its lettered sections. For each phone, laptop or provider gate, record the concrete behavior software cannot prove and which subsequent work depends on that observation. A laptop check is selected for its actual workflow boundary, not as an automatic companion to every phone check. Lettered-section, branch/PR and session boundaries alone do not justify another device gate or design approval.

Combine checks that can safely share one staged runtime. More than one device/provider gate inside a phase is justified only by a real evidence dependency or newly observed contradiction, with its reason recorded. Reuse accepted observations; repeat only the affected checks when a changed runtime or failure invalidates their evidence. Required tests, exact-head complete-suite verification and Level 3 pre-merge approval still apply.

Do not fragment development into repeated phone checks. Follow `docs/PHASE_STAGING_DOCTRINE.md`:

**build as far as automated evidence can honestly prove → freeze the tested runtime at the genuine device boundary → run one straight-line device gate → record PASS/BLOCKED/FAIL → continue from that evidence.**

## Reporting

When reporting verification:
- label focused vs complete-suite runs accurately;
- distinguish mocked/fake integration evidence from real backend/provider/device evidence;
- record the exact branch/SHA for staged device builds;
- do not claim a physical behavior passed from unit tests alone;
- record real-device observations once when they prove the required behavior.

## Relationship to the governance set

- `AGENTS.md` owns mandatory entry/reread rules.
- `docs/ROADMAP.md` owns approved phase behavior and completion gates.
- `CHANGE_CONTROL_CONTRACT.md` owns risk classification, approval, diff control, and rollback.
- `INTEGRATION_CONTRACT.md` owns authority/synchronization boundaries across systems.
- `docs/PHASE_STAGING_DOCTRINE.md` owns staging at genuine real-device boundaries.
