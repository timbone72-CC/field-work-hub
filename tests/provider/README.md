# Phase 5: real private Storage provider gate — READ ONLY

**State:** source + synthetic CI tests. A real Supabase/Google/phone PASS has NOT been recorded. This gate cannot enable client Send.

## Preconditions

Operate only against an **already existing, disposable** FWH photo. Before this test can succeed, the pending Phase 5 SQL/RLS/transfer receipt stack must pass a separately governed staging/deployment gate, and the test photo must have its accepted Finish, original Auth owner, exact stored object key, total bytes and SHA-256 verified. The current live Team project has no such authorized test sample or Phase 5 Storage permissions. **Never use customer evidence.**

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
- Separate unresolved gates: initial TUS begin/HEAD/PATCH, trusted full-byte verification receipts, real reviewer preview permissions, backend Workspace OAuth, exact client-specific TEST Drive destination, restored/retried Google resumable upload, final file GET/checksum, two-device retention/recovery and Level-3 runtime pre-merge approval.
- PR #40 remains draft with default-OFF delivery and no deployed Phase 5 policies. The company internal Shared Drive is NOT an approved client destination.
