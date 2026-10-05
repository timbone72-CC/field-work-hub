# Field Work Hub — Rule Index

**Always begin with:** AGENTS.md, GOVERNANCE.md, PROJECT_PROFILE.md, RULE_INDEX.md. Read the complete relevant approved roadmap phase before runtime changes or a phase transition. Then read only the detailed rule packs needed for the work. For runtime changes, CHANGE_CONTROL_CONTRACT.md and TESTING_CONTRACT.md are universal; INTEGRATION_CONTRACT.md is required for cross-system work.

| Work surface | Required additional rules | Typical minimum |
| --- | --- | --- |
| Documentation/status only | Affected document; CHANGE_CONTROL_CONTRACT.md for scope/rollback | Level 1 |
| GitHub Actions / PR metadata / protection | CHANGE_CONTROL_CONTRACT.md, affected workflow and rollout record; TESTING_CONTRACT.md for workflow tests | Level 2; Level 3 if release/signing/trust changes |
| Takeover, overlapping PRs, supersession, durable handoff or closeout | CHANGE_CONTROL_CONTRACT.md, authoritative build-state/PR and affected phase | Underlying risk level |
| Android contractor UI / dashboard display | Relevant docs/ROADMAP.md sections, CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md | Level 2; proven purely visual may be Level 1 |
| Server work-order dispatch / reassignment / consent / receipt | Relevant roadmap, CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md, INTEGRATION_CONTRACT.md | Level 2–3; authorization changes Level 3 |
| Supabase/Auth/roles/org/seats/invitations/Edge Functions/RLS/RPC | Relevant roadmap + exact backend impact/migration record, CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md, INTEGRATION_CONTRACT.md | Level 3 when authority is changed |
| Database schema, run identity, Room and encrypted session persistence | Relevant roadmap + impact record, CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md, INTEGRATION_CONTRACT.md | Level 3 |
| Offline Start/Finish, WorkManager, recovery, conflict/retry | Relevant roadmap, CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md, INTEGRATION_CONTRACT.md | Level 3 when persisted/state authority changes |
| Camera / protected capture / preparation / photo evidence | Relevant roadmap, CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md, INTEGRATION_CONTRACT.md | Level 2–3 depending on identity/data risk |
| Server-mediated private photo holding, configurable company Drive release, UNCERTAIN or cleanup | Relevant roadmap, CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md, INTEGRATION_CONTRACT.md | Level 3 for authorization, remote identity, retry or deletion |
| Android signer/package ID, hosted deployment, Auth redirect | Approved release/identity plan, CHANGE_CONTROL_CONTRACT.md, TESTING_CONTRACT.md, INTEGRATION_CONTRACT.md | Level 3 |
| Phase boundary, physical Android or provider gate | Relevant current/next roadmap phases, TESTING_CONTRACT.md, docs/PHASE_STAGING_DOCTRINE.md, INTEGRATION_CONTRACT.md when applicable | Underlying risk level |
| Proposed FPP/FWH integration | Both projects' profiles/contracts, explicit integration design and FWH risk/verification rules | Usually Level 3 until boundaries proven |

If work crosses into another row, load its required rules and reclassify **before** implementing. Existing FWH detailed contracts retain their mandatory reread requirements; this routing index does not waive them, invent a new product rule or authorize an unplanned phase.
