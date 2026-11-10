# Phase 5D — two literal APPROVED FWH TEST pins, all worker mutations OFF

**Status:** SOURCE-ONLY / PR REVIEW PENDING. This is not a hosted deployment or provider approval.
**Scope key:** `phase5d-two-approved-test-pins-off-20261110`; Level 3 because trusted server delivery scope is being configured, even though disabled.
**Authoritative branch:** `feat/phase5d-two-approved-test-pins-off-20261110` from main `658c33ac546bc5037974f6c7c4491fa4e9a18feb`.
**Parent authority:** Approved Phase 5 plan and November 1 package-permit amendment; prior deployed migration 132 and all-OFF hosted `client-delivery` v61 unchanged.

## Source change and live TEST proof

In the existing `supabase/functions/client-delivery/index.ts` only, replace the empty `twoPackageTestPins:[]` with these two *fixed literal* pin objects (not environment/caller-selected). Slots use the same active verified TEST Google Drive destination and root:

| Slot | Work order | Approved package UUID | Approved manifest SHA-256 |
| --- | --- | --- | --- |
| 1 | `TEST-P5D-SECOND-001` | `e18463b2-9afe-41b8-9700-721738839b22` | `c473b310c9b6af2c365847165ff2d21282fc5a8e760984ca3e7df5886d2ca3a3` |
| 2 | `TEST-P4-REVISION-1005-D` | `e690b8c4-708f-44c2-b6f3-4da01dc07ac4` | `f2cfff92e19c57e1b0ecdcb0a3490e5157ad3f46a3d3828c99b7798b920edbc6` |

Both live packages are `APPROVED`, one selected APPROVED privately received photo apiece; no outbox or package permits. Both use organization `494154a6-2a7a-4c98-a0a8-2143443fec0e`, TEST company `8e964c9f-906b-40be-8fa5-e58e3b650596`, active verified destination `06f157eb-230c-44b5-b3d4-a7508110bfd7`, and root `1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK`. Current DB dispatch `enabled=false`, hosted v61 all modes OFF. These are existing Admin-approved package identities, not two newly created rows: slot 1 preexisted as a draft; slot 2 was created in the approved TEST UI.

## Containment, verification and next gate

**Zero activation:** Keep `enabled:false`, `pinnedTestEnabled:false`, `testRecoveryEnabled:false`, `twoPackageTestEnabled:false`; retired one-package pins remain empty, no queue schedule, no general Send, Google provider call, SQL migration, Android/APK/FPP change or photo deletion. Hard-coded package IDs are data scoped to disposable FWH TEST, not customer credentials. Existing secret-only worker authentication, exact frozen SQL claim/lease/parent fencing, caps and read-only preflight are unchanged.

**Test owner:** Extend `tests/functions/client-delivery-hosted-cutover-off.test.mjs` to demand exactly these two pins, deny retired/package or environment-selected escape, and prove disabled handler still refuses every command even with pins present. Existing full Admin/Node, Database and Android CI on exact PR head remain required. Recheck read-only package/manifest/destination/outbox/permit parity before any future hosted action.

**Failure domain:** One ambiguous package preserves its own journal, IDs and state while a second may progress only if its own owner and shared parent/root checks pass. A shared root or provider permission failure can affect both. Do not reassign identities, blindly retry, reset legacy HELD permit or reinterpret historical `FPP-000003` final receipt. Worker stays fail-closed and no Admin success is implied by a source literal.

**Rollback:** Before merge revert this branch/PR. If separately deployed later, retain disabled worker entry and all DB/provider receipt history; remove/disable pins through a reviewed compatible artifact, **never** blindly redeploy old v60 with active one-package path. No current live rollback is needed.

**Pending gates:** Review exact source diff + required PR CI. Level-3 **explicit operator approval before merge**. Separate TEST hosted deployment authorization, fresh independent read-only provider/root proof and any slot enablement or one-step provider call/Send each require their own approved boundary. Do not repeat already accepted field capture or one-photo delivery.
