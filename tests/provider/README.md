# Phase 5: real private Storage provider gate — READ ONLY

**State (2026-10-17):** Google Drive's separate synthetic resumable file upload is a genuine verified PASS (fourth TEST, independently confirmed SHA-256), but the **private Supabase Storage Range/206 gate described in this document remains UNVERIFIED**. The Google pass cannot enable client Send or prove photo-byte review/delivery.

## Preconditions

Operate only against an **already existing, disposable** FWH photo. Before this test can succeed, the pending Phase 5 SQL/RLS/transfer receipt stack must pass a separately governed staging/deployment gate, and the test photo must have its accepted Finish, original Auth owner, exact stored object key, total bytes and SHA-256 verified. Read-only live Team verification on 2026-10-17 confirmed that `fwh-review-private` is a non-public bucket containing 10 objects, with existing authenticated Storage SELECT/INSERT policies and private delivery tables. None of the 10 names contained `test` or `disposable`; this is only a naming check and **does not establish that an approved disposable fixture exists**. No existing object was downloaded or treated as TEST evidence. An explicitly identified, authorized disposable TEST owner/photo and real accepted transfer receipt are still required. **Never use customer evidence.**

## Restricted read-only run

From a trusted, locally secured Node.js 22+ environment, configure the following environment variables. Do not put credentials into GitHub, terminal history, chat, screenshots, or documentation.

| Variable | Required source |
| --- | --- |
| FWH_TEST_EVIDENCE_CLASS | Literal DISPOSABLE_FWH_TEST_ONLY |
| FWH_TEST_PROJECT_URL | Literal https://vyocaujuwrivoqynvitm.supabase.co (Team, never FPP) |
| FWH_TEST_BUCKET | Literal fwh-review-private |
| FWH_TEST_OBJECT_KEY | Existing TEST org_uuid/work_order_uuid/run_uuid/photo_uuid.jpg |
| FWH_TEST_PHOTO_ID, FWH_TEST_OWNER_ID | Immutable TEST photo UUID, original Auth owner UUID |
| FWH_TEST_SIZE, FWH_TEST_SHA256 | Exact derivative byte count and whole-photo lowercase SHA-256 from registered accepted TEST receipt |
| FWH_TEST_PUBLISHABLE_KEY | Team publishable/legacy anon key, NOT a secret/service key |
| FWH_TEST_OWNER_JWT | Fresh test original-owner Auth JWT, current session and exact org |
| FWH_TEST_OTHER_OWNER_JWT | Optional fresh different test owner's Auth JWT; required for cross-owner denial evidence |

Run node tests/provider/phase5-private-range.mjs

This sends only GET requests to the **fixed FWH Team origin**. Anonymous and optional foreign-owner access must be denied. The owner must receive exact 206 Partial Content with Content-Range for each bounded 256 KiB segment. Bytes are streamed and checked against the whole-photo SHA-256. Responses never contain object keys, URLs, OAuth tokens, source bytes or user identities.

If the output says other_owner=NOT_SUPPLIED, do not claim cross-owner authorization verified. Incorrect 200, redirect, range/length/MIME/hash or incomplete bytes are fail-closed; do not substitute a full download and call it a PASS. The script never writes database, Storage, TUS, Drive, APK or FPP objects.

## Test layers and release gate

- Synthetic, no-network self-tests: node --test tests/provider/*.test.mjs. They run in Dashboard CI and prove test-harness validation, not real provider behavior.
- Real read-only gate: run once the authorized disposable sample and test owner JWT exist. No service-role key is involved. Record only the redacted result and effective bucket/policy/provider versions.
- Accepted provider evidence: Google Workspace OAuth, approved TEST folder and one genuine two-chunk Drive resumable synthetic JSON upload with independently verified final remote SHA-256 (2026-10-17); do not repeat that gate for reassurance.
- Separate unresolved gates: a real disposable accepted private photo transfer, initial TUS begin/HEAD/PATCH and verified full-byte receipt, actual owner and cross-owner Storage Range/206, real Admin private-image preview, company/client-specific destination and package Send, original preservation and two-device recovery, and Level-3 runtime pre-merge approval.
- Live Team read-only parity on 2026-10-17: `private.client_delivery_runtime` has zero rows (no worker ready), `private.client_delivery_outbox` has zero rows, `private.client_delivery_final_receipts` has zero rows, and Storage object policies for the review bucket exist. Therefore Phase 5 foundations are present but **no live delivery is configured**. PR #40 remains draft with default-OFF delivery; source plans and live behavior must not be conflated. The company internal Shared Drive is NOT an approved client destination.
