# Field Work Hub — Contractor-Owned Property Profile Photos

**Design revision:** 0.1, 2026-10-16  
**Status:** IMPLEMENTATION DESIGN **FOR OPERATOR REVIEW**. The user-approved *experience* is binding; the Level 3 backend/persistence design below is **proposed and not yet separately approved**. This file authorizes no migration, Storage bucket, private image read, release, app runtime change or public APK publication.  
**Scope:** Android Package B under the approved [Android UI/UX implementation plan](fwh-android-ui-ux-implementation-plan.md) and linked Phase 6 roadmap presentation adjunct. One implementation owner: existing Phase 5/6 PR #40, `feat/phase-5-6-dashboard-workflow`, only after its storage/authorization and versioning gates are reconciled.  
**Protected baseline:** Current latest tested visual runtime `c35f17c3b15e5ea8fae88f1b87468ae6561838b1`; versioned internal candidate/recovery 26/27, Room 5. **Do not alter or invalidate that pending UI phone candidate to start Package B.**

## 1. Approved product behavior, not a new job photo

- The contractor can assign an **optional** property profile image once and see it at the top of the **opened** job for that property on this and future visits.
- This image follows the **verified property identity**, not a work-order number, run, contractor assignment instance, printed address, photo item/category or Google Drive folder.
- A contractor owns **their personal choice**. Contractor A changing their picture does not change Contractor B's picture for the same property.
- Any work type or separate WO correctly linked to the same verified property can reuse that contractor's image. No thumbnail gallery in the main Work Orders list (the list stays lightweight and searchable).
- Contractor can replace/remove the selection; never require a profile picture to Accept, Start, photograph or Finish.
- The profile copy lives **outside** ordinary job-photo requirements, protected originals, final customer delivery and ordinary authorized job-photo cleanup. It never counts toward a photo minimum, Photo Requirements Total, private holding receipt or client package.
- No visible `Set property photo` button until real backing selection + persistence is verified. No fake photo placeholder claiming a permanently assigned image.

## 2. Current source audit — what we must NOT mistake for property identity

Examined the authoritative PR #40 source:

| Existing object | Actual meaning | Why it cannot own a persistent property photo |
|---|---|---|
| `public.work_orders.id` / `work_order_runs` / `assignment_instance_id` | exact work order, follow-up run and accepted assignment identity | different WOs can visit the same property; old/new runs must remain distinct |
| `public.work_orders.property_address` | editable presentation text | normal address corrections would orphan or falsely merge images |
| `public.work_orders.client_company_id` | client-company scope (server/dashboard) | necessary protection, **not** a property identity |
| `private.client_packages.folder_address_key` and `client_delivery_parent_maps` | frozen delivery-package address snapshots and destination/company-revision-scoped Google folder mappings | deliberately specific to Drive delivery and not mutable with address corrections; not a property/person profile |
| `private.client_delivery_geography` | work-order-geography verification in gated provider path | geographic location is not an explicit persistent building/property UUID |
| `SupabaseApi.WorkOrder`, `CachedWorkOrder` and current `field_assignments` output | job/run/assignment and display address; Android currently does **not** receive a verified property UUID or company UUID in its WorkOrder model | neither UI-side address matching nor speculative client-side property grouping is safe |

**Conclusion:** No demonstrated reusable property UUID exists in the current contractor work-order contract. Server-assigned verified identity is needed before safely reusing images across unrelated WO UUIDs. An address key, Google Drive ID, or client string cannot be promoted silently.

## 3. Proposed minimal property and personal-photo identity

**Proposal (requires approval):** Add an organization-scoped, client-company-scoped **property registry** with opaque UUID `property_id` and reviewed WO→property association. Each property retains its identity when its displayed address is corrected. A property and its association are never determined by contractor-chosen raw address alone.

- Registry key: `(organization_id, client_company_id, property_id)`. Each bound WO refers to exactly one such verified property. Immutable organization/company boundaries must be constrained server-side, not supplied by Android.
- At Admin dashboard dispatch/edit: create a new property identity by default; if the server finds an eligible existing property candidate within the exact company, **suggest** a match but require explicit verified association where there is risk of confusion. A confirmed association should be naturally reusable for subsequent assignments, without requiring every contractor to repeat a manual photo choice.
- Ambiguous/multiple units, same street address in different towns, corrected spellings, moved client companies, or different real properties at the same address: no silent merge; unresolved items stay **unlinked** or independently linked with an ordinary usable WO and no profile-photo inheritance until reviewed.
- An address correction changes a display field, **not** a property UUID. An actual property reassociation requires a separate audited admin correction and must not silently move another contractor's thumbnail.
- Server-authored `property_id` and `client_company_id` become *additive* optional fields in authorized assignment snapshots and the scoped Room record. Existing phone rows without a verified property remain usable; no synthetic or guessed backfill.
- **Personal profile record** scoped to `(organization_id, client_company_id, property_id, owner_user_id)` with separate immutable image revision/object ID. Only that user's latest authorized revision can be displayed or replaced; company admin/customer access to the contractor's personal choice is not implicit.

**Cross-company choice to confirm:** Default is *no sharing* across different client companies, even for the same physical street address. The same contractor can choose the same picture independently if authorized. Cross-company identity/photo linking would require a distinct privacy decision, not address normalization.

## 4. Source, storage, and lifecycle (proposed)

1. When an authenticated contractor opens an authorized job with a verified property UUID, show their current image, if any. If none, use a neutral property graphic **without** claiming a saved profile exists.
2. Nonintrusive selection option: **Set property photo** from one of the contractor's own already-saved photos belonging to the currently authorized property/job. Display a preview and explicit **Use for property profile** confirmation. Neither the underlying photo UUID nor its category, minimum count, original bytes or protected file status changes. A future separate-camera option requires reuse of the *existing* single CameraX owner and a separate guarded design; it is not implicit in this first implementation.
3. Create a bounded downscaled JPEG derivative (e.g. width 640 pixels or less, EXIF location stripped, maximum 300 KB); store independently of `ProtectedPhoto` and client delivery. Image-copy failure leaves the original intact and the existing profile unchanged. Use app-private local storage; no external gallery/Drive write path.
4. Authenticate and validate the exact current owner, organization, company/property binding, assigned access and revision on every relevant online write/read via a narrowly granted server endpoint/RPC. Use a private Storage bucket/path for personal profile derivatives, separate from photo holding/delivery/recovery. No service-role key in Android, public object URL, unscoped list/download, or credentials delegated to contractors. Server-side ACL validates live authority, not merely stale JWT claims.
5. Offline: after explicit selection, show **Saved on this phone — profile sync pending**, not `Profile saved to account`. Persist a protected local intent+derivative; retry is idempotent, tied to exact owner/property/revision. A network failure or uncertain reply never deletes the old confirmed choice or reports online success without a verified receipt.
6. Once a matching server revision is confirmed, downloaded/future same-account device assignments can show the profile only while that contractor currently has access. Different account/company/contractor receives no previous user's bytes; sign-out clears decrypted UI/cache exposure. An app reinstall/new phone requires authenticated reconnection to restore the personal server-backed choice. Retained local originals/job-photo cleanup cannot delete the independent profile.
7. Replace/remove is an explicit per-owner action with revision checks; remove affects only the profile derivative/record under separately approved retention rules. It does not discard a job photo, change field requirements, alter review/delivery or delete anyone else's profile. Uninstall vs sign-out vs suspended access vs business retention must be specified before implementing the cleanup path.
8. A revoked contractor may not read the old thumbnail while unauthorized. Policy for retaining a dormant private thumbnail until reauthorization/deletion is a **separate privacy/retention approval**, never an implicit right to see customer property imagery after work access ends.

## 5. UI and operational boundary

- Opened selected-job screen: property image in the approved upper-position/sizing; address, WO, due, work type/status and one principal next action remain visible; secondary but relevant controls remain accessible (Accept is distinct from Start, Photos, Finish, both consent pairs).
- Existing Photos/Requirements screen remains the evidence workflow: any-order selection, Extra, captured counts, saved-image review/eligible discard and camera. An optional **Use for property profile** on eligible saved-photo review is a separately testable UI action, not a replacement for **Keep** or **Discard**.
- The main Work Orders list stays without property photos, preserving fast scroll/search and per-WO identity even at duplicate addresses.
- Loading, empty profile, local pending, confirmed, removed, forbidden and stale/mismatched property states are distinct. No spinner or retry can block primary field work or hide photo recovery.
- Photo/profile actions must be disabled for missing/unverified property bindings without falsely claiming the user can configure them; report a narrow property-linking need through the office as appropriate.

## 6. Required Level 3 tests, deployment and rollback plan

**Test-first matrix:** same property with two unrelated WOs and a follow-up; contractor A vs B; company A vs B at same address; corrected address; multiple units; missing/unreviewed/mistaken linking; reassignment and work disablement; same-owner switch account, sign-out/reinstall/phone replacement; offline provisional copy, uncertain upload, concurrent edits and explicit remove; archived/completed job, client photo Send and eligible original cleanup; interrupted profile derivative read/write; access to every metadata/object path via stale JWT, direct Storage and RPC. Check denial paths are fail-closed and no job-photo byte/record/count/remote-ID changes.

**Additive source gates:** new versioned migration and RLS/private Storage rules; authorized assignment additions; safe schema/Room migration from existing verified Room v5 and current installed internal v24; protected-photo and update/recovery APK version compatibility; owner-scoped tests and actual authorization/RLS denial. Keep tested v26/v27 **Package A visual candidate frozen** until its single UI device checkpoint, because a Room migration would require a **different** versioned release candidate and device-preservation proof.

**External gates:** Use controlled disposable property/WO/photos, not actual customer photos. Verify only chosen new private test bucket/metadata in FWH TEST; zero production provider destinations, no delivery workers or Send enablement, and zero changes in FPP. Do not turn on restricted storage/roles or expand client photo delivery as a consequence of the profile feature. Record provider retention/cost for user-approved long-term storage before expanding users.

**Release/rollback:** explicit Level 3 approval and per-change live/CI parity; no merge without separate premerge approval and real device identity/thumbnail continuity. Revert app/UI actions without deleting profile records or protected originals. A rollback must not reinstall an older Room version or orphan confirmed profile photos; keep servers capable of old clients during staggered release.

## 7. Decisions to resolve before Package B runtime

1. **Cross-company photos:** recommended default separate per client company; never auto-share.
2. **Restore on new phone:** recommended account-backed private storage, not local-only; confirms what “stays” means across devices.
3. **Choose a picture:** recommended first release selects an already-saved authorized job photo and copies a derivative; dedicated capture mode can follow only with separate camera-owner design.
4. **Property linking:** recommended server-side UUID and explicit safe Admin association, with candidate suggestions but no address-only automatic merge.
5. **Retention:** dormant profile after lost work access is inaccessible; determine retention/removal schedule and rights separately before live storage.
6. **Size/cost:** recommended small JPEG derivative with strict per-user/property quota and deletion accounting to preserve low running cost.

The foregoing are **recommendations for operator design review**, not silent decisions or permission for database/storage changes. Once confirmed, document the approved revision/rollback/evidence and implement one coherent Level 3 package after Package A's pending device UI gate. No new menu controls, tables, migrations or photo writes are included in this document-only step.
