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
| Backend | `worker-runtime.mjs` + `worker-core.mjs` | Refresh before claim; verify account/destination; reserve all file identities without writing | A deployed runnable worker |
| Backend | `upload-one.mjs` | One 256-KiB protected chunk per call; encrypted session saved before bytes; independent offset/GET verification | Hosted protected source-byte implementation |
| Backend | `service-ledger.mjs` | Fixed Supabase service-only RPC allowlist; fail-closed ambiguous results | End-to-end production worker authorization |

## Hard-stop provider gates

1. Verify that the *backend* can legally authorize exactly the recorded Workspace provider identity (not a personal ChatGPT Drive connector). Obtain an approved OAuth flow/refresh token or tightly constrained delegated identity **outside the public repo**. Record provider identity, intended scope and revocation procedure.
2. Configure the client-company-specific destination and prove folder ID, shared Drive ID and `canAddChildren` **using the actual backend OAuth token**. The internal Workspace Shared Drive is company holding; it is **not** the configured client destination and must never become shared with a client by mistake.
3. Provision server-only credentials and the **32-byte AES-GCM key** via hosted secrets/Vault; no literal value in GitHub, dashboard, Android, SQL journal or test logs. Distinguish an inaccessible encrypted session from a known-safe nonexistent upload; **never allocate replacement remote IDs automatically**.
4. Build the trusted private-source chunk reader against the exact Supabase catalog receipt and add a server-only worker entrypoint that validates a dedicated backend invocation secret; prevent direct user/publishable-key invocations.
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
