# Phase 5D — TEST migration 132 + all-OFF hosted worker v61: verified deployment

**Status: COMPLETE / DEPLOYED DISABLED.** Operator November 9, 2026 expressly authorized deploying **only** migration 132 and the all-OFF `client-delivery` worker from reviewed merge commit `d9a8bb7a79beb1f5e12d78c5f50ef3bdbfb6a92f` into **FWH TEST `vyocaujuwrivoqynvitm`**. No fixture creation, provider Send, cleanup, Android release or original FPP change was authorized.

## Record classification and authority

- **Scope key:** `phase5d-migration132-hosted-v61-off-test-deployment-20261109`. This note is documentation-only Level 1; authorized database migration and hosted trusted worker deployment are Phase 5D Level 3 and already performed under the separate explicit TEST deployment authority.
- **Baseline:** governed `main` merge `d9a8bb7a` ([PR #74](https://github.com/timbone72-CC/field-work-hub/pull/74)), source-only Level-3 merge separately authorized. Exact-head Android, Database and Admin checks passed; prior PR-head Governance passed. Latest TEST Android release remains v42 and installed v42 state unchanged.
- **Deployment target:** *only* known FWH TEST `vyocaujuwrivoqynvitm`, connected Business Supabase account; not original Field Photo Prep.
- **Changed external systems:** FWH TEST Postgres (one additive SQL migration and exact tracking-version reconciliation), FWH TEST `client-delivery` hosted Edge Function v60→v61. GitHub notes capture verified facts; no Drive API request or provider writes, Android, customer data, FPP or cleanup changes.

## 1. Exact SQL migration verified PASS

- GitHub migration: `supabase/migrations/20261109221500_phase_5d_two_package_frozen_photo_scope.sql` at approved source SHA; file Git blob `81e3521a6abd2841e3d1fde909b4002a89a02479`. Source-only tests had already applied all 132 migrations in disposable CI.
- Live preflight: exactly **131** installed migration records; version `20261109221500` and helper absent; no new package permits; original held legacy permit **1**; verified final receipt **1**; queued outbox **0**; dispatch `enabled=false`, `legacy_worker_off_verified=true`, `max_in_flight=2`, and both cutover triggers enabled.
- Applied this **exact unmodified GitHub SQL** with the connected Supabase migration operation. That operation generated history version `20261110021022` rather than the version-control filename. To prevent a remote-only orphan, reconciled **only that one freshly applied history row** using a guarded UPDATE to `20261109221500` with exact migration name, helper-installed and 132-total predicates, and target-version-free check. No DDL was rerun, and no unrelated history row was modified. Postflight confirms exactly **132** installed records, one version `20261109221500` / name `phase_5d_two_package_frozen_photo_scope`, **zero** orphan version `20261110021022`.
- New private `service_bounded_frozen_photo_ids(jsonb)` accepts legitimate one/two-photo manifests; rejects empty, duplicate and malformed photo IDs. `anon`, `authenticated` and `service_role` have no direct EXECUTE on helper. The two existing private provider-check and same-owner expired-permit renewal RPCs remain `service_role` executable and not `anon`/`authenticated`. No broad dispatch/trigger/grant change.
- Post-DDL advisors completed: current INFO private RLS-no-policy and unindexed/unused index findings and known WARN executable Admin security-definer / Auth-password-protection notices remain present. No new critical migration-specific advice finding was observed. See Supabase's [database linter reference](https://supabase.com/docs/guides/database/database-linter) for classification; those preexisting project-wide notices are separate from this narrow rollout.

## 2. Exact hosted all-OFF worker verified PASS

- Deployment replaced only FWH TEST `client-delivery`, **v60 → v61 ACTIVE**, same function ID `2c41bb2b-1c08-4690-9140-e05d714cac86`; hosted bundle hash `eb2a7cc6b47703a3442c889936ad848f1e93aef4ba5a3fffa1824568e1e8c11d`.
- All **14 hosted files** read back after deployment and compared **byte-for-byte with the exact GitHub files from merge SHA `d9a8bb7a`**. Every one matches. No alternative delivery runtime, scheduler, missing dependency or stale v60 handler was deployed.
- Hosted entrypoint confirms `enabled:false`, `testRecoveryEnabled:false`, `pinnedTestEnabled:false` with old one-package ID/destination/root literals empty, `twoPackageTestEnabled:false`, `twoPackageTestPins:[]`. The previously enabled v60 one-package TEST route is now **disabled in actual hosted code**. Prior protected database/package/provider history remains untouched.
- `verify_jwt=false` is retained intentionally from v60, not newly disabled; the existing secret-header authentication remains in the exact hosted handler. Independent TEST read-only preflight retains its separately gated environment setting; no probe was invoked or provider account/Drive read claimed during this deployment.
- No broad claim, new frozen fixture/pin, provider file/folder create, upload/Send, delivery status transition, scheduler, new local photo deletion, phone check, APK or original FPP action occurred.

## 3. Final parity, failure isolation and rollback

**Post-deployment read-only DB snapshot:** 132 migrations / exact version 132 present; dispatch **OFF**; legacy retirement flag **TRUE**, cap **2**; new permits **0**; legacy HELD permit **1**; final receipt **1**; queued new packages **0**; both old/new-overlap guards active. Previous one-package accepted provider receipt is preserved, not retested. Original uncertain legacy provider IDs, lease and session are quarantined. v42 photo-retention checks remain accepted and automatic cleanup stays OFF.

**Rollback on any later failure:** keep dispatch OFF and new/old pinned modes OFF, preserve migration 132 and its exact history record, maintain v61 disabled artifact or an independently reviewed all-OFF compatible worker. **Do not redeploy historical v60 blindly**, since its one-package TEST pin was ON. Never reset historical HELD or DELIVERED identities or replay ambiguous remote steps. A single package failure should not halt unrelated safe work; a shared Google root/account failure can affect both when separately activated.

**Exact next boundary:** Prepare two **new**, independently identity-checked disposable FWH TEST packages and fresh destination/root/provider read-only proofs, then a separately reviewed literal server-pin source change. Explicit operator approval remains required before enabling any two-slot provider step, Send or cleanup. This deployment **does not** prove two concurrent real Google deliveries; no physical/Google tests were repeated.

**Disposition:** SQL 132 and hosted all-OFF staging PASS; all service-side mutations OFF; real two-package provider acceptance PENDING. Next development may prepare new TEST fixtures without interpreting this deployment approval as fixture/Send/provider authorization.
