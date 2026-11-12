# Phase 5D — Send-triggered delivery and verified continuation

Scope key: `fwh-5d-send-event-wake-20261112`. Owner: FWH-F04 / FWH-AC1, existing 5D scheduler/independent-progress defect. Level 3. Authoritative line: `feat/fwh-5d-send-event-wake-20261112`. Baseline/rollback: main `faafaa2bd200cfe14ae9ca408070ae72e7c23e2d`. Source preparation only; new event transport is OFF until separately deployed and activated.

## Operator decision and observed defect

On November 12 the operator agreed that pressing Send should immediately wake delivery, automatically continue verified steps after the browser closes, and retain a periodic recovery check. This refines the approved Phase 5 explicit Send/outbox/one trusted worker behavior. No new Send, provider write, migration deployment or activation is authorized by this source work.

Read-only investigation supersedes the earlier unconfirmed blocker: GitHub recorded only four scheduled wakes in the preceding 24 hours, 5–8 hours apart despite the offset five-minute cron. All four succeeded; the latest run 43323867829 executed with the activation variable true and HTTP 200. At 22:52:30 UTC it claimed package `e690b8c4-708f-44c2-b6f3-4da01dc07ac4`; its first provider step verified at 22:52:33 UTC. It is DELIVERING, not DELIVERED. SQL dispatch is ON with cap two; deployed migration 135 contains queued-first/oldest-progress fairness. The other active package has five verified steps; both have no unresolved step and no final receipt. GitHub's internal reason for missing events is unknown. No manual wake or repeat Send was used for this investigation.

## One delivery owner, immediate events

1. Preserve the existing authenticated, scoped, idempotent `admin_queue_package` transaction and immutable approved outbox. Its committed INSERT requests a wake; rollback sends nothing. No browser code, worker key or new user action is required.
2. Each existing package step's first transition to a positively verified durable outcome requests the next wake. No trigger runs for unverified/uncertain work, no open step is cleared, and the existing read-only fair selector chooses only safe work. Events carry no package/destination/root selection.
3. Reuse `client-delivery`, its service ledger, exact TEST pin, provider validation, two-package cap and single-flight fences. One HTTP invocation still advances one bounded existing step; database events continue the sequence.
4. A separate private OFF-by-default wake configuration and one coalesced, expiring wake ticket arbitrate notifications only. They are not a second delivery queue or package owner. The database creates a random 256-bit single-use token, retains only its hash, and sends it to the fixed TEST worker endpoint through asynchronous pg_net. A service-only consume RPC verifies exact ticket, hash, expiry, activation and dispatch before admitting one invocation. Replay, guessed/expired token, caller-selected identity and ordinary user access are denied. Existing reusable worker/service/OAuth secrets never enter SQL, pg_net or cron metadata.
5. A separately installed one-minute pg_cron recovery job calls the same wake producer. It consults the same selector, coalesces an unexpired ticket and issues a new notification only for eligible work. Transport failure or process loss cannot discard queued delivery. No synchronous provider call occurs in Send.

## Failure containment and recovery

- Network enqueue/extension failure must preserve Send and the verified step; retain a bounded safe problem code. No raw error, token or provider data is logged. Periodic recovery reselects durable eligible work.
- A duplicate/event/cron race can consume a ticket once. Existing per-package step admission remains final authority even if an older authenticated GitHub wake overlaps. Single ticket coalescing limits notification storms; no webhook retry replays provider writes.
- An unverified provider step remains held with its original IDs, permit and journal. Another independently eligible package may continue. Shared credential/quota/parent problems remain shared failures, not assumed independence.
- Missed notification: expiry allows a fresh safe wake. Lost consume reply: that ticket remains consumed; a later recovery wake re-reads eligibility. Lost provider confirmation: existing unresolved-step exclusion holds that package. Browser closure does not own continuation.
- Existing Admin QUEUED/DELIVERING/DELIVERED states remain truthful; queued is not delivered. Operational recovery uses the wake's safe problem code and cron/net status without exposing token payloads. Delivery and cleanup authority are unchanged.

## Verification and controlled rollout

Focused Node tests cover default OFF, exact TEST scope, invalid/replayed tickets, conflicting modes, denied auth before provider work, and reuse of the existing worker. Disposable PostgreSQL tests cover private grants/RLS, real token consumption/replay/expiry, wake coalescing, Send-rollback/event/verified-step semantics, transport failure and no mutation of protected delivery evidence. pg_net transport is simulated in CI; it cannot prove hosted notification delivery. Existing exact-head CI supplies final automated verification, not new camera/offline tests.

After source merge approval, separately authorize TEST deployment and extension/cron activation. Verify hosted source parity, database grants/advisors and extensions; keep new SQL/Edge wake switches OFF during deployment. Cut over from GitHub periodic wakes to the new notification producer and one recovery cron job only after exact endpoint/transport permissions are checked. Activation must explicitly account for already-Sent eligible packages because starting recovery can advance them without another Send. Verify one NEW real Send-to-first-step/automatic-continuation/recovery boundary with the dashboard closed and an actual final receipt; reuse existing approved fixtures and previous provider/device acceptance. Do not label source tests as operational PASS.

Rollback: turn the event wake switch OFF, disable its cron job and backend event flag; if any unsafe delivery outcome occurs, also pause SQL dispatch. Preserve tickets, outbox, step attempts, permits, encrypted sessions, receipts, protected photos and remote IDs. Do not roll back to legacy delivery or reset uncertain evidence.

## Current status

Implemented with new event transport OFF: additive migration 136, private one-use admission and transaction triggers, existing Edge handler/service-ledger integration, and review-only recovery activation template. PASS: 35 focused Node tests; all 136 migrations on disposable PostgreSQL 17.11; focused wake/queue SQL gates; real two-connection admission and existing package/lease races with simulated HTTP. Exact-head full CI and review PENDING. These results are software/SQL evidence only. Hosted delivery remains v67 and existing scheduler configuration is unchanged by this branch. Explicit Level 3 pre-merge approval, separately authorized deployment/activation and NEW hosted event/recovery acceptance remain pending.
