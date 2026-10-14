# FWH Phase 5D — trusted client delivery (SOURCE ONLY)

**Authoritative line:** existing Phase 5/6 PR #40 and the approved Phase 5 plan. This is not a second queue, a parallel worker, an FPP integration, or a production deployment. The Team production `client_delivery_runtime.worker_ready` must remain **false** until authenticated real-provider evidence is recorded and the Level-3 runtime merge/deployment gate is separately approved.

## Implemented source boundaries

| Owner | File | Proved capability | Not proved |
| --- | --- | --- | --- |
| Database | `20261010130000_phase_5_delivery_fencing.sql` | Service-only fenced claim, immutable preallocated remote IDs, exact simulated confirmations and final receipt | Real Google files |
| Database | `20261010141000_phase_5_encrypted_delivery_sessions.sql` | Private ciphertext journal, monotonic offset, forbidden session replacement, current-lease-only restore | A hosted encryption key or resumable session |
| Database | `20261010150000_phase_5_delivery_source_projection.sql` | Current-lease-only exact immutable source/photo/manifest projection | Actual protected byte reader |
| Backend | `workspace-oauth.mjs` | Fixed Google OAuth refresh endpoint, bounded token and scope; no secret in user response | Google account consent/token obtained |
| Backend | `session-vault.mjs` | AES-256-GCM session capability encrypted and bound to package/file identity | Durable hosted key and key-rotation recovery |
| Backend | `drive-client.mjs` | OAuth identity, exact writable client destination, generated file IDs, resumable status/chunk, exact independent Drive SHA-256 GET | Live Google GET/PUT |
| Backend | `worker-runtime.mjs` + `worker-core.mjs` | Existing protected preflight reserves immutable identities; new **internal-only** `continueTrustedDeliveryFile` checks refreshed Workspace account and exact authorized package folder, reads the current fenced server plan, and composes the same `upload-one.mjs` + private-source reader (not exposed by Edge) | Real provider/Storage bytes, live authorization and deployed file-worker invocation |
| Backend | `upload-one.mjs` | One 256-KiB protected chunk per call; encrypted session saved before bytes; independent offset/GET verification | Hosted protected source-byte implementation |
| Backend | `folder-one.mjs` | Source-only one-attempt package folder reconciliation: preallocated Drive ID, lease, one-shot journal interface, trusted WO parent and exact GET | Missing durable WO/address folder maps and service RPCs; real Google creation untested |
| Backend | `private-source.mjs` | Revalidates current lease-bound private catalog projection both before and after each strict 256 KiB Storage GET/206 range; exact object, SHA/size-bound JSON manifest and fixed origin | Live Storage Range/206 behavior and deployed provider credentials |
| Backend | `service-ledger.mjs` | Fixed Supabase service-only RPC allowlist; fail-closed ambiguous results | End-to-end production worker authorization |
| Backend | `handler.mjs` + `index.ts` | Dedicated worker-secret-only **preallocation** route; default OFF regardless of valid caller; no CORS; errors redacted | Authorized deployed worker, real uploads, scheduler, released customer destination |

## Frozen client filename and package-folder dependency

The trusted SQL source projection now names each selected JPEG `field-photo-<permanent-photo-UUID>.jpg`, as required by the approved Phase 5 plan. The photo's selected display order is **not** its file identity; changing the order cannot silently rename or replace remote evidence. The existing manifest remains `submission.json`. The exact projected name, SHA-256, size, parent and preallocated file ID travel through the single existing upload/GET verification path.

**Still incomplete, not enabled:** the candidate SQL now blocks direct-root package placement and requires VERIFIED same-company ADDRESS and WORK_ORDER parent records before reserving the PACKAGE folder. The existing preflight reserves only the next missing address/WO parent ID and returns without package files until its independent provider receipt exists. This is a source/CI protection, **not real Google folder creation**. Address/WO one-shot RPCs are prepared, but their real provider executor and PACKAGE folder one-shot receipt/recovery are not yet connected. Do not bypass them via the company's internal Workspace Shared Drive or by generating replacement IDs.

## Hard-stop provider gates

1. Verify that the *backend* can legally authorize exactly the recorded Workspace provider identity (not a personal ChatGPT Drive connector). Obtain an approved OAuth flow/refresh token or tightly constrained delegated identity **outside the public repo**. Record provider identity, intended scope and revocation procedure.
2. Configure the client-company-specific destination and prove folder ID, shared Drive ID and `canAddChildren` **using the actual backend OAuth token**. The internal Workspace Shared Drive is company holding; it is **not** the configured client destination and must never become shared with a client by mistake.
3. Provision server-only credentials and the **32-byte AES-GCM key** via hosted secrets/Vault; no literal value in GitHub, dashboard, Android, SQL journal or test logs. Distinguish an inaccessible encrypted session from a known-safe nonexistent upload; **never allocate replacement remote IDs automatically**.
4. Verify the **source-only** `private-source.mjs` trusted chunk reader with a real disposable authenticated Supabase Storage partial GET (`206`, exact `Content-Range`, bytes and current catalog receipt). The internal `continueTrustedDeliveryFile` path is now composed with the **existing** `upload-one.mjs` worker seam and tested against mocked provider/Storage responses, but it has **not** been independently validated against real Storage or Google. It is **not called** by the published/preallocation-only Edge entry, and that entry stays **default-off** with no file upload, Send, or cleanup. Only after real provider/TEST gates can a governed trusted runtime invocation be added. No ordinary JWT/publishable key can invoke it.
5. Prove on a disposable client TEST destination: partial chunk, app restart/reconnect, provider offset probe, exact Drive file GET including SHA-256/size/parent, missing/foreign folder, wrong user, conflicting ID, and manifest verification. `DELIVERED` needs all exact files and the submission manifest; a 308 or 200 upload alone isn't enough.
6. Only **after** the above: configure `pg_cron` + `pg_net` with a Vault-held secret, confirm pause/off behavior, validate failed/UNCERTAIN reconciliation and operator recovery. Enable `worker_ready` only after a recorded signed-off provider gate and staged deployment.

## Protected invariants

- No contractor receives Google provider tokens, destination permission or a service-role key.
- Admin Preview / Approve / queued Send / private receipt cannot delete phone originals.
- No production cleanup before confirmed applicable final client delivery and durable server/local retention closure.
- Unknown Google outcome remains `UNCERTAIN`; operator reconciles the **same** remote ID, never a new file/folder ID.
- There is currently no automatic retry/requeue of expired provider lease. That is intentional and safe until reconciler is tested.
- All package SQL/Edge sources are candidate-only: production Team migrations and actual Drive writes are not implied by CI PASS.

**Testing:** `tests/supabase/phase_5_private_review_gate.sql` and `tests/functions/client-delivery-*.test.mjs` are disposable, non-network tests in the existing database/dashboard CI. CI success is not a live-photo, phone or Workspace-provider PASS.

### One-shot package folder recovery (source only)

The new `folder-one.mjs` accepts only a trusted server-frozen package folder below a verified WORK_ORDER folder. It enforces immutable package UUID, preallocated ID/parent/name, manifest binding, current lease and expected client Shared Drive. Its ledger interface requires an atomic server `beginFolderCreate` transition to ATTEMPTED **before** the first external POST. On any ambiguous POST or restarted attempt, it can only GET/verify the original ID; no replacement ID or blind second create is allowed. An independent authenticated Drive GET checks exact name, ID, parent, MIME and appProperties before a durable confirmation.

**Important:** Server-side ADDRESS/WO mapping and one-shot ATTEMPTED/VERIFIED RPCs now exist in **unapplied candidate migrations**, and the existing preflight/ledger reads and reserves those IDs before package files. PACKAGE-folder one-shot `getFolderPlan`, `beginFolderCreate` and `confirmFolder` now exist as **unapplied service-only candidate SQL RPCs**, backed by a unique original-ID attempt journal and full independent same-client Google Drive GET receipt. `service_finish_delivery` now requires that receipt before DELIVERED. The existing worker's service ledger invokes these RPCs only from trusted internal code; the actual provider folder-create/reconciliation executor remains **unimplemented and disabled**. This helper is not exposed by the disabled Edge worker or invoked by the current `worker-runtime.mjs`; SQL rejects direct-root package reservation. Tests remain synthetic, not evidence of Google folder creation or deletion.

## TEST-only Workspace provider identity preflight (read-only operator helper)

The source-only `ci/verify_phase5_workspace_provider.mjs` invokes the **existing** trusted `workspace-oauth.mjs` and `drive-client.mjs` boundaries without exposing a new server/Android/dashboard endpoint. Run it only once the intended Workspace OAuth refresh credential and a disposable **client-specific** Google Shared Drive/folder have been independently provisioned and protected outside this public repository. It does **not** create consent, obtain a refresh token from an interactive browser, configure the actual FWH backend, create destination rows, deploy a worker, upload photos or enable Send.

Supply these exact values from a **locally protected environment** (never commit a `.env` file, paste credentials into a shell command/chat, screenshot them or put them in GitHub secrets without the approved deployment process):

| Name | Meaning |
| --- | --- |
| `FWH_TEST_EVIDENCE_CLASS` | Exact `DISPOSABLE_FWH_TEST_ONLY` safety marker |
| `FWH_TEST_WORKSPACE_EMAIL`, `FWH_TEST_WORKSPACE_DOMAIN` | Exact intended backend Workspace user and domain, never an assumed ChatGPT Drive connector identity |
| `FWH_TEST_INTERNAL_SHARED_DRIVE_ID` | Existing *company-internal* Workspace Shared Drive ID; this must differ from the client TEST Drive |
| `FWH_TEST_CLIENT_SHARED_DRIVE_ID` | Independent disposable client-specific TEST Shared Drive ID |
| `FWH_TEST_CLIENT_ROOT_FOLDER_ID` | Existing disposable client-specific folder under that exact TEST Shared Drive |
| `FWH_TEST_WORKSPACE_CLIENT_ID`, `FWH_TEST_WORKSPACE_CLIENT_SECRET`, `FWH_TEST_WORKSPACE_REFRESH_TOKEN` | Backend-approved OAuth refresh credentials, supplied privately |
| `FWH_TEST_WORKSPACE_SCOPE` | Exact approved `https://www.googleapis.com/auth/drive.file` or `https://www.googleapis.com/auth/drive` scope |

Run from the existing PR #40 checkout: `node ci/verify_phase5_workspace_provider.mjs`. A redacted `PASS` means only: Google OAuth refresh succeeded, Drive `about.get` returned the exact intended Workspace identity, and Drive `files.get` independently verified a writable folder within the exact distinct client Shared Drive. The helper performs only OAuth token refresh POST and Drive **GET** calls; no Google file POST, provider upload, ACL change, database mutation, scheduler action or client Send. A `BLOCKED` is a real operator credential/destination gate; retain the protected original evidence and do not switch to the internal Shared Drive as a workaround. No secrets, file IDs, email, URLs or tokens are printed.

`node --test tests/functions/client-delivery-provider-preflight.test.mjs` runs **synthetic no-network** allow/deny cases and is included in the existing dashboard CI function-test glob. It cannot prove Workspace membership, real OAuth consent, writable client folder or hosted worker configuration. Even a real helper PASS does **not** activate `client_delivery_runtime.worker_ready`; preserve the separate exact provider upload/GET/uncertainty test and signed-off Phase 5/6 release gates.


## Operator TEST OAuth bootstrap (one-time local consent; source-only until real Google gate)

The approved Workspace user created an **independent Google Cloud project** (display name \`Field Work Hub\`, ID \`field-work-hub\`) with the Google Drive API enabled, a new Internal Google Auth Platform audience and one Web application OAuth client. Its downloaded client JSON is sensitive operator-owned input, **not** a repository asset. At this checkpoint the Web client has **no redirect URIs**, no refresh token and no connection to the protected FWH TEST backend. Its credentials must never be pasted into GitHub, Supabase SQL, code review, a shell command, log output or screenshots.

The current approved source includes a TEST-only **one-time local login helper** at \`ci/authorize_phase5_workspace_provider.mjs\`. It is the missing consent-code step **before** the existing read-only \`ci/verify_phase5_workspace_provider.mjs\` and before hosted worker-secret provisioning. It does not enable Send, deploy an OAuth callback, create remote Drive files or activate production provider delivery.

1. In Google Cloud → Google Auth Platform → **Clients** → existing \`Field Work Hub - Workspace Drive Backend\` Web client, add exactly this **Authorized redirect URI**: \`http://127.0.0.1:8765/oauth2/callback\`. Leave JavaScript origins empty. This is only the operator laptop's loopback listener; a later hosted callback is a distinct separately verified configuration. Do not create a second OAuth client to obtain this URI.
2. Record the actual new **FWH CLIENT TEST** Shared-drive ID via Google Drive's opened drive URL and the exact child \`FWH TEST DELIVERY\` folder ID from the operator's already-created folder; **never infer** the Shared-drive ID from the folder ID or give the internal holding drive's ID as the client drive.
3. In the **operator's laptop terminal only**, provide the following nonsecret configuration to the helper through local environment (not a committed or attached .env file): \`FWH_TEST_EVIDENCE_CLASS=DISPOSABLE_FWH_TEST_ONLY\`, \`FWH_TEST_WORKSPACE_EMAIL\` (the approved Workspace user), \`FWH_TEST_WORKSPACE_DOMAIN\`, \`FWH_TEST_INTERNAL_SHARED_DRIVE_ID\` (preexisting internal holding), \`FWH_TEST_CLIENT_SHARED_DRIVE_ID\`, \`FWH_TEST_CLIENT_ROOT_FOLDER_ID\`, \`FWH_TEST_WORKSPACE_SCOPE=https://www.googleapis.com/auth/drive\` and \`FWH_TEST_CREDENTIALS_OUT=$HOME/.config/field-work-hub/workspace-oauth-test.json\`. Invoke \`node ci/authorize_phase5_workspace_provider.mjs /path/to/downloaded/client_secret.json\` from the **existing PR #40 checkout**, using the actual private downloaded JSON path. The file itself is read locally; **never include a secret in the command line**.
4. The helper prints a Google consent URL **without client secret**. Open it in the signed-in approved Workspace Chrome profile, choose the approved user, and authorize the displayed Drive scope. The loopback handler accepts only the original anti-CSRF state and PKCE verifier, exchanges the code with Google, and verifies real Drive \`about.get\` exact user, \`files.get\` exact folder/Shared-drive ID and \`canAddChildren\`. It also confirms that the new refresh token is usable through the existing Workspace token refresher.
5. The helper saves a TEST-only receipt/credential bundle **outside the checkout**, in an existing or newly created owner-private directory with mode 0700 and new file mode 0600; it refuses overwrite. The receipt must be used only for separately authorized trusted server secret provisioning. Neither the refresh credential nor client secret is returned by the browser, printed in CI or uploaded to GitHub. Immediately after successful provider login, repeat the existing read-only provider identity check and then stage trusted server Vault/secrets under the approved Phase 5D provider gates. **Do not activate** the deliberately disabled client delivery worker until independent real Storage/Google create/read/uncertainty/receipt evidence is recorded.

A synthetic CI PASS verifies validation, fixed URI/scopes, CSRF/PKCE request construction, tested token-identity fail-closed behavior and no Drive write, but it **cannot prove** Google has accepted the redirect URI, issued offline consent, verified the actual Workspace identity or granted a writable client TEST root. If the exact real Google gate fails, retain all previously accepted private photo and Android evidence and leave \`worker_ready=false\`.

