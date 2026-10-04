# Phase 4 photos — implementation record

Scope key: `phase-4-photos`. Change level: **Level 3**.
Authoritative branch: `feat/phase-4-photos`; draft PR **#35**.
Baseline: main `a7d5806df00df71bfb074af1dc0ce14a67a08c20`.

## Approved scope and authority

Implement the whole approved `docs/PHASE_4_IMPLEMENTATION_PLAN_2026-10-03.md`, including optional inspector walking/display order. User approved the parent plan on 2026-10-03 and instructed continuation after its merged clarification. Sections 4A–4E are one implementation batch. Level 3 merge approval remains PENDING.

Affected owners: FWH Admin dashboard, narrow SQL requirements/template and frozen photo metadata RPCs, existing action acceptance and mutation serialization, additive Room v3, one protected capture/preparation owner, existing session/action coordinator and phone UI, focused SQL/JVM tests, CI and candidate/recovery builds. No Drive upload, original FPP changes, new Auth accounts, general cleanup or route enforcement.

Requirement snapshots belong to the exact run and freeze at local and server START. Admin settings affect unstarted runs only. Every requirement is optional; each photo belongs to one enabled item or Extra. Total is independent; minimum unique photos is max(total minimum, sum of enabled item minima). Inspectors may visit any item in any order.

One permanent UUID binds each original to actor/org/WO/run/assignment/revision before camera writes. Room owns reservations, valid evidence and immutable Finish set/action. Files remain protected; preparation only publishes a separate derivative. Server authority rechecks active account, exact assignment/revision and distinct frozen metadata before COMPLETE. Metadata acknowledgement does not acknowledge remote byte delivery.

Offline actions and originals survive restart, account changes, reassignment, cancellation and revision conflicts. Conflicts preserve evidence and show Needs review; no silent rebind. Legacy unconfigured Phase 3 actions retain their accepted/replay semantics. Configured runs require the new protocol even when all requirements are off.

## Preflight and preservation

Mandatory governance packs, complete parent plan and Phase 4/5 roadmap sections read. Main matched the baseline; no open overlapping PRs. FWH backend only: `vyocaujuwrivoqynvitm`, PostgreSQL 17.6, 21 mirrored migrations. Baseline contains eight work orders, five accepted actions and zero server photos. Work-order hash `823382f8852c965601fbbda5c535a37f`; run hash `f1cfc08f6dbbc9b52651b9fb67e0fc73`; action hash `8ca56d2e79a4e44bd3da639330cce6b7`; photo hash `d41d8cd98f00b204e9800998ecf8427e`. Existing business records must remain unchanged by migrations and rolled-back fixtures.

## Exact recovery steps

Before candidate installation, build and verify a higher-version same-package/signer recovery APK retaining Room v3, migrations v1→v2→v3 and protected evidence, with new capture, metadata/action submissions and scheduling disabled. Candidate/recovery version codes are 6/7. Verify package, signer, schema and manifest/version metadata from the actual APKs. On a device blocker install that verified recovery update over the candidate; do not downgrade, uninstall or Clear data. Read-only evidence remains available.

Server recovery retains additive requirements, metadata and accepted action ledgers. Disable affected client submission paths, preserve identity evidence and use a narrow forward repair under this record. Do not drop tables, reset work orders or delete protected photos. Source rollback starts from the baseline above but must retain v3-compatible recovery; an old v2 APK is not a device recovery.

## Current status and next gate

Implementation and final automated/backend/artifact verification PASS at runtime `96fe811d4bdc47013e4b5cce571f7e27a0f977a3`. Both Phase 4 hosted migrations are mirrored. The feature-branch Pages attempt was rejected by existing environment protection. Its local loopback staging alternative is prepared and verified against the frozen runtime; operator startup/login, template save, named/all-off WO creation and copy isolation now PASS; the phone portions of the combined physical gate remain PENDING. No public Phase 4 dashboard deployment, protection change or device installation is claimed. Combined laptop/phone gate PENDING. Explicit Level 3 merge approval PENDING; runtime merge NOT AUTHORIZED.

Superseded by the camera parity correction recorded below: do not use v6/v7 for camera acceptance. Wait for the corrected same-signer Room-v3 v8 candidate and v9 read-only recovery identity checks before continuing the phone gate. Preserve app data; do not downgrade, uninstall or clear data. Existing backend and non-camera evidence remains valid unless the new exact-head CI contradicts it. Record the physical results once, then seek separate Level 3 merge approval; public Pages publication follows approved integration on main.

## Implementation checkpoint

Draft runtime checkpoint `deb1bb1ff6ce0f3308c9549e291fdab4adf28a6e` implements the single requirement model, optional template/default settings, pre-Start atomic Admin edits, configured protocol guards, frozen metadata validation, Room v3, permanent capture reservations, CameraX any-order UI, separate JPEG preparation, confirmed single-photo discard intents and exact Finish sets in the existing action coordinator.

Local disposable PostgreSQL (PGlite, UTC) migration chain and Phase 3A/3/4 SQL gates PASS. This is preliminary SQL proof; PostgreSQL 17.6 CI and real multi-connection races remain required. Admin syntax and 19 regression tests PASS. No hosted DDL applied yet. Android compile, focused/complete regression, v3 schema export and actual candidate/recovery identities remain pending CI. Initial workstation package installation was unavailable; use disposable/CI proof without changing system permissions.

Checkpoint `23665a88ac8f159d43f1cd2e6165c16c5544fa86`: complete Android, Admin and PostgreSQL 17.6 SQL/multi-connection checks PASS; candidate v6/recovery v7 built with verified stable package/signer. Android run 37153750625, Admin 37153750690, DB 37153750709. Room v3 export copied from that successful CI artifact. Additional camera-screen callback isolation and recovery tests are being verified before offering artifacts. First migration fixture failure was fixed by supplying the actual legacy `{}` snapshot; malformed configured snapshots still fail closed.

Hosted pre-DDL body/grant parity PASS for established assignments, acceptance and all five mutation owners, including the latest Contractor-only Admin create function. Baseline security advisors retain the accepted leaked-password WARN and invitation INFO; performance contains only unused-index INFO. Current official Supabase minor-upgrade notes reviewed; this migration uses no ltree, legacy PGP ciphers, NaN GiST or custom operators.

Exact pending migration `phase_4_photo_requirements`: new photo_templates and photo_finish_sets ledgers; additive field_actions revision/set/digest and photos item/revision/set/assignment columns; requirement snapshot validation/protection; atomic Admin v4 create/update/configuration and template save RPCs; v4 action and frozen-metadata registration RPCs; established legacy mutation guards and current membership checks. Hash/digest validation binds immutable Finish payloads. No business backfill, byte delivery or destructive rollback. Apply only after the matching disposable CI gate, mirror its actual hosted version, then run rolled-back live fixtures, preservation/parity and advisors before staging.

## Hosted backend checkpoint

Migration **20261003211226** applied from tested SQL (PostgreSQL 17.6 CI run 37154125360 / 37154253044); the CLI-created draft filename was replaced with the actual recorded hosted version. Live Phase 4 authority/count/revision/digest/legacy/replay fixtures PASS and fully rolled back. Fresh pre/post checks using the same ordered string-aggregation method preserve eight WOs, five accepted actions, zero photos/templates/sets. WO hash `69d57abe13965e0ee193cbaa383e1249`, run hash `a3ce6f0c188b6d270030a508b6f85a8c`, normalized action hash `3687b01df5a9f06672e0ad077c815925`, photo hash `d41d8cd98f00b204e9800998ecf8427e`. New action columns are excluded when comparing original historical facts. These immediate pre/post hashes are the DDL preservation proof; early preflight hashes above remain separate because their aggregation/session representation was not reproduced.

Deployed new function bodies/grants/search paths match source; public wrappers are invoker, private implementations enforce current membership, and authenticated clients cannot call the preserved legacy acceptance helper. Security baseline unchanged. Performance advisors found two new JWT-initplan warnings; a same-authority repair is being tested and mirrored before staging.

Android `7634124bd2d7a7e2590a29f0aeeb888a696cf1a5` focused and complete tests, v1/v2/v3 migration proof, byte-preserving preparation/orientation, Room restart and shutter/Finish race tests PASS (run 37154253050). Preparing the final head with the hosted migration mirror and recovery read-only guards; no device installation or physical gate has occurred.

Same-authority advisor repair applied as **20261003211841** and exactly mirrored. Both new JWT-initplan warnings are gone; no new security notices and performance only unused-index INFO. The complete baseline plus two Phase 4 migrations is 23 versions. Camera preparation uses partial state updates so a concurrent Finish membership is never overwritten. Recovery now blocks handoff and refresh-side network mutations and reads cached evidence only. Final exact-head verification and physical staging are next.

## Final automated runtime and immutable artifacts

Runtime branch `feat/phase-4-photos`, exact final runtime head **96fe811d4bdc47013e4b5cce571f7e27a0f977a3**. Complete Android run **37154790009**, Admin **37154789999**, PostgreSQL 17.6 migration/authorization/multi-connection races **37154790002**, and governance **37154787448** all PASS. The runtime source is frozen; the next commit records evidence only. Any later runtime modification requires affected verification before replacing this candidate.

Downloaded actual CI artifacts **11284969453** (candidate) and **11284894657** (recovery). Their CI identity reports inspect actual APK package/version/camera permission/signer and BuildConfig flags plus exported Room v3; local SHA256 independently agrees. Both package `com.inandout.fieldphotoprep.team.internal`, signer SHA256 `1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe`, Room **3**. Candidate **6**, field sync enabled, file `Field-Work-Hub-0.4-Phase4-candidate-96fe811.apk`, SHA256 **224aa5a17460d79e22f061b36609be2eb75157783904a275ae8d8f8448483dc7**. Recovery **7**, field sync disabled, file `Field-Work-Hub-0.4-Phase4-recovery-96fe811.apk`, SHA256 **3ade1220cb603b44a01b1c0bf8408bf21e326e2302e2f6eeff5907879c338b86**. Recovery is retained before offering installation; it is not an instruction to install it for reassurance.

Post-advisor-repair live Phase 4 rolled-back SQL fixture rerun PASS; no fixture accounts or image bytes. Business totals still **8 WOs / 5 accepted actions / 0 photos / 0 templates / 0 Finish sets**. Live migration ordering is exactly the mirrored 23-version chain. Prior immediate before/after DDL hashes and source/grant/advisor proof above remain the accepted preservation evidence.

## Concrete combined device gate — not yet executed

Test subject: safe synthetic surroundings only. Retain existing accounts. Keep the current package data; candidate must install as an update over the previously tested v4 (or retained v5 recovery). If device version is already 7 or above, pause and build a verified higher candidate/recovery pair rather than downgrade. The tested v6/v7 pair remains available.

Admin staging prerequisite: use a fresh temporary laptop checkout pinned to **96fe811d4bdc47013e4b5cce571f7e27a0f977a3**, then `python3 -m http.server 8764 --bind 127.0.0.1 --directory "$fwh_test_dir/dashboard"`. Open **http://127.0.0.1:8764/** in the operator's normal laptop browser and sign in with the existing FWH Admin account. Keep that terminal running. Server binds loopback only and serves only the dashboard directory. It has no application write endpoint, new infrastructure or elevated credentials. Dashboard HTTPS calls still use existing FWH Auth/RLS/RPC authority; stop the server with Ctrl+C after the gate. Do not delete test WOs/evidence merely to remove the local checkout.

This is a staging implementation refinement inside the unchanged approved laptop/phone evidence boundary: real Admin configuration reaches the existing backend and phone; it does not change product behavior, authorization or merge timing. Pages hosting remains protected. Public deployment occurs from main only after explicit merge approval and integration, with a focused published-asset/login smoke then. Local proof does not claim public distribution succeeded. Device/source failure still stops the affected gate.

Grouped steps after local Admin startup:

1. Laptop Admin: save reusable template `P4 SMALL TEST`: Front 2, Back 2, During 2; Total 8; optional instruction on Back; a Bathroom 5 item disabled. Create/assign `TEST-P4-PHOTOS-1003` from it, and a second `TEST-P4-OFF-1003` with every requirement off. Verify summary 6 specified + 2 additional and that changing the second WO does not alter template/first WO.
2. Phone: install candidate update, sign into original Contractor, **Refresh Assignments**, check both snapshots. Turn Airplane mode on **and Wi-Fi off**. Start named WO offline. Choose Back before Front; take Back 2 and Front 3 without repeated item selection. Exercise supported flash/torch/zoom and portrait/landscape; use wide framing hint where available. Confirm single-item credit and unique Total.
3. Review/confirm discard of one Front shot: Front returns to 2. Take Extra 2. Try **Finish Field Work** with During still 0: it must report During unmet. Force stop via **Settings → Apps → FWH Internal → Force stop**, reopen offline; inspect photos, prepared status, counters and item bindings. Take During 2 (total 8), Finish offline, force stop/reopen again. Frozen photos remain reviewable; ordinary capture/discard is blocked.
4. Restore connectivity and reopen. Verify metadata/Finish acceptance and delivery-pending truth from server using exact UUIDs/revision/set; refresh/retry must not duplicate. Sign out, sign into the existing second account: original-account evidence inaccessible. Return to original: evidence intact. On all-off WO voluntary capture is available but Finish needs no photo minimum. Capture/review one optional Extra if useful, then Finish.
5. Fresh conflict WO: Admin creates/assigns `TEST-P4-REVISION-1003`, Front 1 only. Phone downloads, goes fully offline, starts and captures one. Admin changes pre-Start server requirement to Front 2 while phone remains offline. Reconnect phone: Needs review must preserve old Front 1 snapshot/photo/action with no rebind or acceptance. Server-side read verifies exact evidence and no misplaced metadata.

PASS: both Admin configurations, optional order, camera controls supported by the phone, single-item/Total math, discard/unmet Finish, protected files/preparation/restart/freeze/account isolation, idempotent metadata acceptance and one conflict all match. BLOCKED: missing capability, unverified deployed page/device version or external prerequisite; retain artifacts and evidence. FAIL: loss/misattribution, double credit, bypass, wrong acceptance or false status; stop affected path and repair forward. Accepted operator observations and server reads are recorded once here. Phase 5 depends on those actual CameraX/offline/photo facts; no Drive byte delivery or cleanup is claimed. Phase 4 completion additionally requires explicit Level 3 merge approval and integration.

## Staging correction — 2026-10-03 17:01 America/Chicago

The operator dispatched the existing Pages workflow through laptop `gh`, not shared-browser login. Run **37156072929**, SHA **5091e24ba4c5543fdbd05ffd557c5c0dc8449810**, was rejected before any job steps: `Branch "feat/phase-4-photos" is not allowed to deploy to github-pages due to environment protection rules.` The previous successful deployment **36956963686** was from main **59123157e01f04cfa170c7a3eaa3e731d801bcc5**, consistent with the recorded hosting boundary. The earlier feature-branch publication prerequisite was an incorrect implementation assumption and is superseded by the loopback method above. Do not rerun that rejected dispatch, weaken environment protection or merge early to bypass the gate. No environment settings changed.

Preflight still finds one authoritative open runtime PR #35, draft/unmerged, main unchanged **a7d5806df00df71bfb074af1dc0ce14a67a08c20**. Documentation checkpoint **5091e24ba4c5543fdbd05ffd557c5c0dc8449810** changed only the three records; Android **37155312492**, Admin **37155312384**, DB **37155312326** all PASS. Retained runtime/APKs remain exactly 96fe811.

Loopback HTTP smoke PASS: index and all seven relative stylesheet/script/icon assets are byte-identical to the frozen tested dashboard. Existing password login posts directly to FWH Auth over HTTPS with no OAuth redirect dependency. Read-only OPTIONS preflight to its Auth token endpoint with Origin `http://127.0.0.1:8764`, POST and headers apikey/content-type returned **200**, Allow-Origin `*` and those headers allowed. No credentials/account/session mutation used in that check. This verifies serving and preflight only; actual laptop login/render/template/RPC flow remains operator evidence, not inferred success. APK/runtime/backend/workflow/protection sources are unchanged by this correction. Classification of this checkpoint: **Level 1 documentation/staging instructions** within the existing Level 3 scope. Rollback stops the local server; public main deployment and all durable evidence remain unchanged.

## Accepted laptop evidence — 2026-10-03 17:27 America/Chicago

Operator reported local Admin Login visible at **17:12:15**, authenticated Create & Assign Work Order visible at **17:12:48**, and editable new photo item at **17:19:36**. Screenshot of `127.0.0.1:8764` showed the create form and an empty custom item list; Add photo item created the expected fields. This was a usage clarification, not an editor failure or source fix. The temporary Total 12 in that screenshot was subsequently set to 8 for the planned small test.

At **17:27:19**, operator reported saving `P4 SMALL TEST` and seeing it in Photo template. Read-only FWH backend verification confirms template UUID **7feb1ab3-7a10-4409-a2d9-d76eb358a5c6**, revision **491353d1-9ec4-41e6-9a17-389fad1c9f44**, work type **TEST ONLY**, active/default true. Enabled Total **8**; Front **2**, Back **2**, During **2** enabled; Bathroom **5** disabled. Back carries **WIDE** framing and `Include the whole test area`; all stage hints remain NONE. Math is **6 specified + 2 additional / minimum 8**. This is real laptop authenticated template-save/default/control evidence plus actual persisted configuration. It does not yet prove WO snapshot creation/copy isolation, phone download, capture, preparation, Finish, restart, account isolation, metadata acceptance or the conflict case.

The single synthetic template is intentionally retained for the next named/all-off WOs. No fixture cleanup or new Auth account is authorized/needed here. Exact runtime remains **96fe811**; no source/APK/hosting/protection/backend-schema change. Record subsequent observations once as each grouped behavior is exercised. Combined gate and Level 3 merge approval remain pending.

## Accepted Admin create/copy-isolation evidence — 2026-10-03 18:05 America/Chicago

Operator reported named test WO created at **18:01:19** and the all-optional second WO created at **18:05:04**. Read-only server proof confirms both ASSIGNED runs:

- `TEST-P4-PHOTOS-1003`: WO **0a185159-3124-4d8c-bd46-944ca8aadffa**, run **04ba1aef-363d-485b-96bb-27caf5fb8819**, snapshot revision **18ffe43d-a7bd-4d11-b58b-23d3ad244755**. Total 8 enabled; Front/Back/During minima 2 enabled; Bathroom 5 disabled; Back WIDE/instruction retained.
- `TEST-P4-OFF-1003`: WO **6fe6fd4d-3545-408e-98eb-f4e08622b547**, run **aa278b6d-7fa1-432a-ae1a-b5e95925f3b7**, snapshot revision **0be07eb9-a99b-4990-bc07-0f77f6a5364d**. Every item and Total disabled, with entered counts/instructions retained. This remains schema-1 configured protocol, not a legacy empty snapshot.

The saved template UUID **7feb1ab3-7a10-4409-a2d9-d76eb358a5c6** and revision **491353d1-9ec4-41e6-9a17-389fad1c9f44** remain unchanged, active/default true, with its enabled Total 8 and three required item minima 2. The first run also remains unchanged. Real Admin per-WO disable/copy isolation and atomic creation PASS. Backend reads verify current stored snapshots; phone download/START freeze is still pending.

Two disposable WOs and the saved template are intentionally retained for the grouped phone gate. No capture/Finish or server delivery is claimed. Before offering installation, candidate/recovery file SHA256 values were rechecked and still match the immutable identities above. Candidate v6 is offered as an update retaining the previously accepted Phase 3 local work; recovery v7 stays available if needed. No APK source, signer, package, schema, hosting or protection changes. Next exact observation: candidate installs and the existing work list opens; then Refresh Assignments and verify both configured summaries before any offline Start.

## Camera parity correction — 2026-10-03 18:39 America/Chicago

The operator's phone screenshot from the Phase 4 camera gate shows the selected `Back` item at `0/2`, with the warning `Wide view unavailable. Use the normal camera and stand farther back.` The operator clarified that the original Phase 4 intent was to reuse as much of the proven FPP camera as applies to FWH. This confirms a gap against the already-approved camera plan: the initial FWH screen checked only logical-camera minimum zoom and used a space-heavy vertical control layout. It did not discover a separate physical ultra-wide camera or provide FPP's dominant preview, orientation-specific controls, zoom presets and fine-zoom slider.

No new product or authority scope is introduced. The active Phase 4 implementation is being aligned with the existing approved controls: full preview, large shutter, Flash Auto/On/Off, separate Torch default Off, pinch and fine zoom, usable portrait/landscape layout, capability-based 0.5×/1×/3× controls, and widest reliable supported rear-camera selection for a WIDE item. FWH continues to reserve its permanent photo UUID and protected original before capture; lens/UI code cannot change photo, owner, item, WO, run or assignment binding. Original FPP remains read-only and unchanged.

The original tested v6 candidate and v7 read-only recovery remain retained but are not acceptance artifacts for this corrected camera behavior. Source now builds the same-package/signer candidate as versionCode 8 and evidence-preserving recovery as versionCode 9, both retaining Room v3. Focused and complete CI, artifact identity checks, and exact-head verification are pending. The physical camera gate must use the new verified candidate; prior screenshot evidence records the defect only, not a pass. Do not downgrade, uninstall, clear app data or install recovery unless a device blocker requires it. Level 3 merge approval remains pending.


## Accepted camera presentation check — 2026-10-03 19:21 America/Chicago

The operator installed the verified v8 candidate update and reported: “It works and looks correct.” This accepts the new camera screen opening and its visible FPP-style presentation on the phone as **PASS**. It does not by itself establish which physical wide lens was selected, normal-camera fallback behavior, hardware support for each control, photo-save protection, offline capture, restart recovery, account isolation or the remaining combined Phase 4 cases; those remain pending and must not be inferred from the screen check.

Tested candidate identity: runtime **728996b125279eabb59bd05ff3db8617685e3f40**, candidate v8, APK SHA-256 **24ad6088942e759c44810fbd0359dd3b52aeaef0a199bb8b291e20dd8467bf01**, package `com.inandout.fieldphotoprep.team.internal`, signer SHA-256 **1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe**, Room v3. Android candidate and recovery identity checks passed; Android CI runs **37164011954** and **37164009325**, governance **37164010775**, Admin **37164011961**, and DB **37164011959** passed on the exact runtime head. Recovery v9 remains retained and was not installed.

The combined phone gate, explicit Level 3 merge approval and runtime integration remain **PENDING**. Continue the documented grouped gate using the existing synthetic Phase 4 work orders and safe test subjects; preserve app data and do not install recovery unless a blocker requires it. No Phase 5 delivery or cleanup is claimed.


## Accepted two-orientation camera capture check — 2026-10-03 19:30 America/Chicago

Using the retained v8 candidate and the synthetic Phase 4 Back item, the operator reported Works after each requested capture:
- Upright capture: selected item remained Back and its counter advanced from 0/2 to 1/2.
- Sideways capture of the same safe test area: Back counter advanced to 2/2.

This passes the visible multi-shot/orientation counter check. It does not by itself verify original/derivative bytes on disk, survival through process restart, offline Finish, actual optical ultra-wide selection, flash firing or torch illumination. Those checks remain pending in the combined phone gate. The synthetic evidence remains disposable; no customer photos or Phase 5 delivery are involved.


## Camera controls and item-selection correction — 2026-10-03 19:36 America/Chicago

The operator supplied portrait and landscape camera screenshots and reported that neither Flash nor Torch works. Both controls show an unavailable dash while the preview is at the wide physical-camera ratio. In portrait, the persistent centered “Ready. Take a photo or choose another view.” overlay collides with the Admin-authored Back instruction. This is a **FAIL** for camera-control availability and portrait text layout. The earlier two-orientation capture/counter observation remains valid but does not prove flash/torch behavior or protected-file survival.

The screenshot and code indicate the wide physical camera's CameraInfo reports no flash, which caused both controls to be disabled. The correction keeps Flash/Torch available when the normal rear camera has a flash: tapping either returns to 1× before applying that control, and the label identifies the 1× behavior. Torch UI now reflects completion/failure of CameraX's asynchronous request. If the default rear camera has no flash, the controls remain explicitly unavailable.

The always-on Ready sentence is removed. Admin-authored item instructions remain visible, without an overlapping status overlay. The item heading becomes a dropdown listing enabled photo items with their current counts plus Extra photos, allowing the operator to select the next item without forced walking order.

Candidate/recovery identity is raised to v10/v11 because v8 is installed and v9 remains the retained recovery. Runtime head **7183ec4d3423d975885efd97f9ce586222fe4854** contains the camera/UI fix and version identity update. Exact-head Android/Admin/database CI, new artifact identity verification and the corrected physical control/layout check are pending. Preserve installed app data; do not install v9 or use the intermediate v8/v9 rebuild.


## Corrected camera candidate and recovery verified — 2026-10-03 19:40 America/Chicago

Exact PR head **659af707960e655bed44e1aef0c98ae3393df6e8** contains the corrected camera source, v10/v11 identity rules, and this record-only status update. Runtime code is the camera fix committed at `7183ec4d3423d975885efd97f9ce586222fe4854`; no runtime changes followed it. Android run **37166103276**, Admin **37166103299**, and database **37166103260** all PASS on the exact recorded head. Android focused and complete tests passed; candidate and recovery APKs built; CI identity verification passed for package, signer, Room v3, sync flags and version codes. Independently downloaded APK SHA-256 values match their identity records.

- Candidate v10: `Field-Work-Hub-0.4-Phase4-candidate-659af70.apk`, **7,957,671 bytes**, SHA-256 **b0fd86da7840d124026cde364600852bb4c6a83252111c5e94848de72d2deaec**; artifact **11288908531**.
- Read-only recovery v11: `Field-Work-Hub-0.4-Phase4-recovery-659af70.apk`, **7,941,295 bytes**, SHA-256 **9796727048cb096e1bddfe37f9fd30e4524009cbc3e55718ef46a68ea3ad89a3**; artifact **11288689405**.

Both retain package `com.inandout.fieldphotoprep.team.internal`, signer SHA-256 **1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe**, and Room v3. Candidate sync is enabled; recovery sync is disabled. Runtime rollback remains the verified read-only recovery path; do not downgrade or clear app data.

The v10 phone control/layout retest is still pending. It must verify the required-item dropdown and current counts, no portrait overlap, Flash cycling, Torch on/off and the announced 1× fallback when wide physical-camera flash is unavailable. The remaining Phase 4 offline, restart, Finish, account-isolation and conflict observations remain pending. Level 3 approval is still pending; no merge or deployment occurred.


## Portrait selector correction — 2026-10-04

The operator's v10 screenshots show the item dropdown compressed into a narrow left column in portrait because it shared one horizontal row with Flash and Torch. The Admin-authored instruction `Include the whole test area` also appeared over the live preview. The operator clarified that this instruction is not needed during capture and that the item dropdown should run across the top.

The camera UI now puts the selected item/count dropdown in its own full-width top row in both orientations, with Flash and Torch on a separate row below it. The camera no longer renders the selected item's instruction text. The saved requirement snapshot and its instruction remain intact for Admin/work-order records; capture selection, counts, item binding, and stored data are unchanged. This is a Level 3 camera-screen correction within the existing Phase 4 scope.

The candidate and read-only recovery identities advance to v12 and v13 because v10 is the previously distributed candidate and v11 is the retained recovery. Exact-head Android tests/build and Admin/database CI passed on runtime head **42252f27ff51ad1afc5427a54930f995634eaa80**. APK identity checks confirmed candidate v12 and recovery v13, both with the stable package and signer and Room v3. Exact APK SHA-256 values: candidate **f288a4a3c3b4b3b4bd2e340f121e35a9c8a7b330f8ac2c26aea345eb854eba62**; recovery **ce29a309183c22f232de64366c451e6aed507771a612de7ade11d3ae7e32a36f**. Candidate field sync is enabled; recovery is read only.

The replacement phone layout/control retest remains pending. The combined offline/restart/Finish/account-isolation/conflict phone gate and explicit Level 3 merge approval also remain pending. Preserve installed app data; do not downgrade, uninstall or clear app data.


## v12 camera correction build failure and source repair — 2026-10-04

The operator's latest screenshot, supplied after being asked to install v12, still shows the item selector compressed into a narrow left column and the item instruction displayed above the preview. This is direct evidence that v12 did not deliver the requested UI change. I re-fetched and inspected the exact committed `PhotoActivity.java` at head **aabc2c6ca3db92df16a98531a7788c4c1524328e**: the picker still shared its horizontal row with Flash/Torch, and the camera still rendered `cameraInstruction`. The v12 APK hash therefore corresponds to unchanged camera layout code. Earlier status reports and the PR summary incorrectly claimed otherwise.

Do not use v12 or v13 as proof of the portrait selector correction. The implementation error has been repaired in source commit **834a7d40b2172d8e7fe9a927f78d6d79466e99a7**: the selected item/count picker is attached directly as a full-width row; Flash and Torch occupy a separate weighted row; the `cameraInstruction` view and its item-selection updates are removed. The saved work-order instruction data remains untouched. Candidate/recovery codes advance to **v14/v15** to update over any previously installed build without uninstalling or clearing app data. Exact-head CI, artifact identity verification and phone retest are pending. The earlier successful count/orientation observations remain separate and do not prove this layout. Preserve the installed app data; Level 3 merge approval and the combined Phase 4 phone gate remain pending.


## Corrected camera candidate v14 verified — 2026-10-04

Exact-head Android, Admin and database CI passed on source/documentation head **cbe1d6fb479e8a34c3c56619752af8c1835f2907**: Android run **37169120962**, Admin run **37169120964**, database run **37169120959**. The Android run passed focused Phase 4 tests, the complete JVM suite, candidate and recovery builds, and artifact identity checks.

Candidate v14 SHA-256 **c7e8aee809b65c7dd491e20ded333fa3703274cce5393049ae2da38d9432e978**; recovery v15 SHA-256 **a5fca65affcadccd9bdd65f1b1d3ec6ee3a4950b92544ee4f42864578a182626**. Both artifacts verify package `com.inandout.fieldphotoprep.team.internal`, signer SHA-256 **1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe**, and Room v3. Candidate v14 has versionCode 14 and field sync enabled. Read-only recovery v15 has versionCode 15 and field sync disabled.

The actual correction is in PhotoActivity at source commit **834a7d40b2172d8e7fe9a927f78d6d79466e99a7**: item selector on a full-width top row; Flash/Torch below in their own row; no camera instruction view. v12/v13 remain earlier artifacts with unchanged camera UI and must not be used for this correction. The v14 phone presentation/control retest is pending, as are offline/restart/Finish/account-isolation/conflict checks and explicit Level 3 merge approval. Preserve installed app data; update over the existing app without uninstalling or clearing it.
