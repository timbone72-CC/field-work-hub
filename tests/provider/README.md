# Phase 5: real private Storage provider gate — READ ONLY

**Current boundary:** One independent fourth disposable Google Drive resumable TEST file is confirmed by real provider SHA-256 (2026-10-17). That PASS does not establish FWH's protected received-photo content, Admin review or final client Send. The real authenticated Supabase photo-byte gate in this document remains **NOT RUN**.

## Why the received-photo gate uses Admin signed preview

A direct GET to /storage/v1/object/authenticated/fwh-review-private/... is **not** the received-photo viewer. The deployed fwh_review_private_select Storage RLS policy invokes private.photo_storage_object_allowed, which authorizes the original upload owner only when the registered transfer is WAITING and has no verified receipt. Once the photo is RECEIVED, that raw owner GET is deliberately denied.

The existing scoped **Admin private preview** is the approved received-photo path: authenticated POST /functions/v1/admin-private-photo with only immutable photo UUID and transfer-version UUID. The server validates the live Auth session and current organization/team work authority, rebinds the exact RECEIVED receipt and Storage object, and issues a 120-second same-origin signed Storage URL. The Admin dashboard already follows that path, and an image preview is only displayed after the browser loads the signed image. **Never weaken Storage RLS or reclassify a received photo as WAITING to make a test pass.**

The existing phase5-private-range.mjs read-only test now checks this actual path. It confirms raw anonymous direct access is denied; optionally confirms raw original-owner access is denied after receipt; confirms unauthenticated signer access is denied; optionally confirms a separate **actually unauthorized** office/user session cannot sign the photo; obtains one authorized short-lived Admin signed URL; then attempts bounded 256 KiB 206 Partial Content reads from that exact signed URL and hashes all returned JPEG bytes against the immutable registered receipt. It never sends Send, review decisions, migrations, writes, updates, or deletes. If signed URL Range requests are not supported by the live provider, record **BLOCKED/FAIL** rather than silently falling back to a whole-file 200 download or weakening RLS.

## Existing TEST evidence

Operator classified **all 10** existing FWH Team private review photos as TEST-only on 2026-10-17. Read-only catalog/receipt/Finish reconciliation verified 10/10 exact received transfer + receipt + active object identity/version/key, SHA-256 and size, Storage JPEG metadata, canonical org/WO/run/photo path, capture owner and accepted Finish provenance. There is **one original TEST capturing owner and one TEST organization**. Metadata proves fixture suitability, not actual HTTP content or Admin authorization. No photo bytes were inspected in that metadata reconciliation. Do not ask whether these original photos are customer photos again absent contradicting evidence. Choose one privately from the already verified ledger; no new photo is needed for this preflight.

## Private operator-side prerequisites

Use a trusted, locally secured **Node.js 22+** environment, the existing FWH Team project only, and an active approved Admin account with work permission for that TEST photo. Do not paste JWTs, signed URLs, original photo IDs/keys/hashes or credential material into GitHub, terminal history, chat or screenshots. The optional second TEST user must be **unauthorized for this photo** (different organization/team or valid non-office role). A second authorized Admin should not be used as a negative control.

| Environment variable | Meaning |
| --- | --- |
| FWH_TEST_EVIDENCE_CLASS | DISPOSABLE_FWH_TEST_ONLY |
| FWH_TEST_PROJECT_URL | https://vyocaujuwrivoqynvitm.supabase.co (Team; never FPP) |
| FWH_TEST_BUCKET | fwh-review-private |
| FWH_TEST_OBJECT_KEY | Exact existing TEST org_uuid/work_order_uuid/run_uuid/photo_uuid.jpg from trusted receipt |
| FWH_TEST_PHOTO_ID, FWH_TEST_TRANSFER_VERSION | Exact immutable UUIDs from that same received transfer/receipt |
| FWH_TEST_OWNER_ID | Original captured-by Auth UUID from verified receipt (fixture binding only, not signer identity) |
| FWH_TEST_SIZE, FWH_TEST_SHA256 | Exact whole-JPEG byte count and lowercase 64-digit SHA-256 from verified receipt |
| FWH_TEST_PUBLISHABLE_KEY | FWH Team publishable/legacy anon key; **never** service role |
| FWH_TEST_ADMIN_JWT | Fresh, normal scoped Admin Auth JWT for the exact TEST job; server rechecks its signature/session/capability |
| FWH_TEST_OWNER_JWT | Optional fresh original contractor JWT; verifies direct **received** object reads are denied |
| FWH_TEST_OTHER_USER_JWT | Optional fresh different **unauthorized** user JWT; verifies server signer denial. Required to claim cross-user denial PASS |

Run privately: node tests/provider/phase5-private-range.mjs

The output reports only pass/fail class, verified whole content bytes and chunk count, and DENIED or NOT_SUPPLIED for optional negative roles. Do not share environmental values. An existing verified receipt and a current authorized Admin session are required. A database service view or old Auth session UUID does **not** mint an Admin JWT. This invocation is a real, operator-side physical/network test and cannot be claimed from a source CI run.

## Verification layers and remaining release gates

- Focused synthetic, no-provider self-tests: node --test tests/provider/*.test.mjs. These run in the existing Dashboard CI; they prove test logic and fail-closed handling, not the live provider.
- Real read-only scoped TEST gate: Admin/other-user signed-URL authorization and actual 206/Content-Range/bytes/SHA-256 against one preexisting received TEST photo. A separate denied anonymous direct URL is checked; owner_direct=NOT_SUPPLIED or other_office=NOT_SUPPLIED means that optional check is not proven.
- **Already accepted, do not repeat for reassurance:** the operator's real signed-in Chrome Admin preview displayed the original TEST photo on 2026-10-13 and Run-2 photo on 2026-10-14; the existing authoritative implementation record also confirms persisted individual Approve, Reject-with-reason, restored Approve and Review-required On→Off→On without client Send. These are true UI/SQL PASS boundaries, not claimed signed Range 206/hash or wrong-user live denial. Pending separate Phase 5/6 gates still include review-to-client-package Send, corrections, protected delivery, cleanup and device/account evidence.
- Existing accepted independent Google TEST upload PASS must **not** be rerun for reassurance; three earlier ambiguous provider journals stay frozen.
- Live holding remains private; as of the last read-only parity check, 10 operator-confirmed TEST held objects and receipts, **0** client destinations, **0** ready delivery workers, **0** queued Send attempts, **0** final client receipts. Hosted client-delivery is TEST read-only, not active delivery. Two planned client proposal/upload-fence migrations remain deliberately unapplied pending the governed release gate.
- Remaining real Phase 5/6 workflow, TUS/recovery, device, verified recovery-email, Web Push and explicit Level-3 merge/integration gates follow the approved parent-phase plans. The internal company Shared Drive is **never** automatically an approved client destination. Protected phone originals cannot be removed on a private receipt alone.

Do not invent a privileged temporary policy, receive-time bypass, service-role client, new photo, alternate test endpoint or manual provider upload to force PASS. Keep the existing implementation record and PR #40 as sole authoritative handoff.
