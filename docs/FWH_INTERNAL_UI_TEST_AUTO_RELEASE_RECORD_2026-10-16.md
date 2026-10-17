# FWH Verified Internal UI TEST Release Automation — Implementation Record

**Scope key:** `fwh-internal-auto-update-ui-preview`  
**Classification:** Level 3 — automatically granting a trusted GitHub Actions workflow the authority to create **publicly downloadable** signed internal TEST APK releases.  
**Operator authorization:** 2026-10-16, explicit: **“approve automatic publication of verified internal TEST builds.”** This approves the proposed governed distribution behavior, **not** unattended Android installation, photo/delivery deployment, or automatic merge of draft PR #40.  
**Source-of-truth branch:** `feat/verified-internal-test-auto-release`, independent from the app runtime owner, draft PR #40 (`feat/phase-5-6-dashboard-workflow`). No shared modified files and no competing MainActivity implementation.  
**Current status:** Implementation and verification complete; **separate explicit Level 3 merge approval granted by the operator on 2026-10-16**, specifically for **PR #47 only**: “approve merging PR #47 only to enable automatic publication of verified internal TEST builds.” Trusted-workflow activation still requires that exact PR to merge into `main`; no APK has been published by this new workflow at this checkpoint.

## Approved user-facing result

One standing opt-in replaces `bash ci/publish_internal_update.sh RUN_ID` and repetitive typed `PUBLISH` after every approved UI-review checkpoint. After the UI implementer explicitly marks **the final candidate commit** `FWH-UI-TEST-READY: <even-internal-version>`, three exact-source CI suites complete green, and a trusted separate workflow confirms the allowed UI-only diff since the previous public internal version, GitHub may publish a new immutable one-asset public **TEST** release automatically.

FWH Android continues to use its existing updater to find the **latest higher version**, verifies the asset SHA-256, version, Android package and exact debug signer; Android requires user authorization for install and never clears Room, queued work or protected original photos. A phone coming back online may skip multiple superseded published versions and install the latest version directly.

## Source design and trust boundaries

- **Trusted publisher**: `.github/workflows/internal-ui-test-auto-release.yml` lives on `main`, triggered by completion of Android, DB or Dashboard Gate CI. It checks out **main only**; no PR source is executed in privileged publishing.
- **Fail-closed policy script**: `ci/auto_publish_verified_ui.py` is also from `main`, checks hardcoded repo and in-repo PR #40 exact branch/head, a single final-commit ready trailer, monotonic even version, successful newest Android/DB/Dashboard **pull_request** runs for that exact SHA, complete bounded source comparison against the last public source, and a strict allowed Android-presentation/test/build-identity/docs file set. Schema/Auth/PhotoOwner, backend/Drive, AndroidManifest and workflow/signing trust modifications block release.
- **Immutable bytes**: Download only the `field-work-hub-internal-direct-release` artifact from the exact passing Android CI run. Require the exact two-file artifact inventory (single candidate APK + CI metadata), stable app package/signature, Room version 5, source SHA, size, exact advertised version and SHA-256. Re-read PR/CI/tag before creating GitHub Release. Never upload the recovery APK or extra assets. Never replace a preexisting version tag.
- **Repository-level kill switch**: `FWH_UI_AUTO_RELEASE_ENABLED=false` repository Actions variable disables publication. Missing variable defaults to enabled **only after this workflow is merged by explicit operator approval**.
- **Least privilege**: only the trusted `workflow_run` publish job receives `contents: write` and `actions: read` to create the public test release; ordinary PR policy-test job has `contents: read`. Workflow concurrency serializes releases.
- **No production boundary expansion**: test APK distribution does not merge PRs, apply migrations, authorize private photos, change Drive/Supabase credentials, enable worker/Send/cleanup, install APK, or modify FPP.

## Important operational constraints

1. **No auto-publication for every individual code commit.** Mark only completed, validated **UI review** heads with a final commit message trailer `FWH-UI-TEST-READY: 30`, later `32`, etc. A new commit moves the PR head and invalidates that earlier readiness; a fresh final marker follows finished changes. The marker is an implementer release declaration, not GitHub proof of the user's future visual acceptance.
2. **No silently recycled versions.** Each batch needs a newer even internal `versionCode`, with its paired odd recovery code reserved. Already published v28 is immutable; as of planning, v30 is the next staged visual candidate.
3. **CI only proves software, not real-world screens.** First automatic publication must still undergo one Samsung review: download/install consent, in-place update retains saved jobs/photos, UI and release manifest visible as expected. No repeat of accepted unrelated camera/Drive tests.
4. **GitHub Actions permissions matter.** If the repository's effective `GITHUB_TOKEN` is restricted to read-only or a branch protection rule blocks use of this workflow, automation must fail closed and the operator must authorize the minimal release-bot permission in repo settings. Do not add a long-lived personal access token or bypass permissions.
5. **An APK is publicly downloadable** from the TEST channel, even if no customer data is bundled and work access remains authenticated. This consequence is part of the operator's explicit release-policy approval.

## Verification, rollback and gate

**Focused tests** in `tests/ci/test_auto_publish_verified_ui.py`: multiple/invalid markers, odd/stale versions, wrong PR/branch/origin, missing/failed/pending or superseded success, restricted changed files, missing UI change, invalid signer/package/Room/APK/hash, old/duplicate version tag, and kill switch. Python standard library only.

**Mandatory final gate**: new publisher workflow PR policy-test CI pass; inspect exact diff and permissions; **separate Level 3 approval of PR #47 was explicitly granted 2026-10-16**; verify merge result and actual trusted workflow active on `main`. Finally, mark the approved latest complete UI candidate in PR #40 and observe one successful automatic TEST release without manual publish command. Test Android updater and user-confirmed installation at a narrow phone gate.

**Rollback**: disable via repository variable `FWH_UI_AUTO_RELEASE_ENABLED=false` (immediate publication freeze) then revert the isolated workflow + policy + tests on `main`. Leave previously published immutable TEST tags and working phone data untouched; if an APK is already installed, publish a newer fixed version rather than downgrading/mutating Room.

**Protected behavior**: all existing FWH application code, authorization, update SHA/signer/download checks, installer permission, offline jobs/photographs, Phase 5/6 provider gates, and separate FPP app are unchanged by this implementation.
