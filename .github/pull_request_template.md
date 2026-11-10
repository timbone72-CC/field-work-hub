## Governance Classification

- Scope key: <!-- Stable scope ID; reuse when continuing an authoritative line -->
- Goal: <!-- Exact approved goal -->
- Affected surfaces: <!-- Paths/domains changed -->
- Change level: <!-- Level 1 | Level 2 | Level 3 -->
- Authoritative branch: <!-- Exact PR head branch -->
- Required rule packs: <!-- Applicable FWH rules from RULE_INDEX.md -->
- Protected behavior: <!-- Must remain unchanged -->
- External systems changed: <!-- None or exact affected live systems -->
- Rollback point: <!-- Exact known-good SHA -->
- Verification boundary: <!-- Focused/full CI, doc review, relevant device/provider gate -->
- Level 3 merge approval: <!-- N/A for L1/L2; PENDING or APPROVED for L3 only -->
- Acceptance gate: <!-- FWH-AC1..FWH-AC5 = delivery/feature/pilot milestone; FWH-SAFETY for linked incident; N/A for governance-only -->
- Feature ID: <!-- FWH-F01..FWH-F08, or FWH-PLATFORM for documented shared operations; N/A for governance-only -->
- Work lane: <!-- FINISH | ACTIVATE | ACCEPT | RELEASE | SAFETY | GOVERNANCE; one stage of feature delivery, not a new test -->
- Feature state before: <!-- WORKING | BUILT_INACTIVE | PARTIAL | NOT_BUILT | DEFERRED; N/A for governance-only -->
- Feature state after: <!-- WORKING | BUILT_INACTIVE | PARTIAL | NOT_BUILT | DEFERRED; N/A for governance-only -->
- Work outcome: <!-- Specific user-operable feature behavior or released capability this PR advances; include impacted FWH-F## IDs if PLATFORM -->
- Activation/rollback boundary: <!-- For ACTIVATE, exact TEST/production config switch, protected dependency and rollback; otherwise N/A -->
- Acceptance evidence reference: <!-- For ACCEPT/RELEASE or newly WORKING, exact device/provider/live evidence URL/record; otherwise N/A -->
- New physical/provider evidence: <!-- NONE, or FWH-AC#: <one genuinely unaccepted device/provider boundary>; no repeats for reassurance -->
- Safety incident URL: <!-- Required for SAFETY lane, link to genuine GitHub issue; otherwise N/A -->

## Summary

<!-- Narrow implementation description -->

## Evidence / Remaining Gates

<!-- Preserve accepted evidence and any BLOCKED/FAIL/PENDING gates; state what actually passed (or is not required), and write the exact Next checkpoint. Update the existing authoritative build-state record, not a second handoff document. -->
