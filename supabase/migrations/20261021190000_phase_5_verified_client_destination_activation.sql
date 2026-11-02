-- Phase 5A/5D: complete the existing verified-client-root staging contract.
-- An authorized current Admin chooses a layout while the proof-verified root
-- is still INACTIVE. A separate service_role-only, audited action may activate
-- that EXACT same proposed and independently proven provider identity/root.
-- Source-only until the canonical TEST migration gate. No data backfill, Drive
-- operation, scheduler, worker readiness or Send on migration install.
--
-- Rollback before any activation: revert this one migration and UI changes
-- from PR #40, do not remove or rewrite stored provider proofs. After activation
-- or any approved manifest, pause new Send/worker and preserve all immutable
-- receipts, IDs and action journals: never blindly roll this DDL backwards.

-- Existing current-Admin list now includes proven inactive roots so a layout
-- can be configured without first granting client Send authority.
create or replace function public.admin_list_client_folder_destinations()
returns jsonb language plpgsql stable security definer set search_path='' as $list$
declare actor_org uuid; results jsonb;
begin
 select organization_id into actor_org
  from private.account_work_access a
  where a.user_id=auth.uid() and a.active and a.work_role='ADMIN'
    and a.suspension_authority is null and a.disabled_at is null;
 if actor_org is null or not private.phase_5_admin_can_configure_folder_layout(actor_org) then
   raise exception 'Current authorized Admin required' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'destination_id',d.id,'company_id',d.company_id,'company_name',c.name,
   'root_folder_id',d.root_folder_id,'layout',coalesce(l.layout,'ADDRESS_WORK_ORDER'),
   'layout_configured',l.destination_id is not null,'revision',l.revision,
   'active',d.active,'verified',d.verified)
   order by c.name,d.id),'[]'::jsonb)
 into results
 from private.client_delivery_destinations d
 join private.client_companies c on c.id=d.company_id and c.organization_id=d.organization_id
 left join private.client_delivery_folder_layouts l on l.destination_id=d.id
 where d.organization_id=actor_org and d.verified
   and (d.active or
       (d.verification_receipt is not null and exists(
         select 1 from private.client_destination_provider_proof_receipts r
           where r.destination_id=d.id
             and r.proof_folder_id=d.verification_receipt->>'proof_folder_id')));
 return jsonb_build_object('destinations',results);
end;
$list$;

-- Keep the already tested same-user/organization/team, revision and replay
-- controls. Accept VERIFIED INACTIVE ONLY when its immutable provider receipt
-- is still bound to the exact destination; never accept an unverified proposal.
create or replace function public.admin_set_client_folder_layout(
 p_action uuid,p_destination uuid,p_expected_revision uuid,p_layout text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $save$
declare d private.client_delivery_destinations%rowtype;
 old private.client_delivery_folder_layouts%rowtype;
 prior private.client_delivery_folder_layout_actions%rowtype;
 next_revision uuid;
begin
 if p_action is null or p_destination is null or
   p_layout not in ('ADDRESS_WORK_ORDER','STATE_CITY_ADDRESS','STATE_COUNTY_CITY_ADDRESS')
 then raise exception 'Exact folder layout action required' using errcode='22023';end if;
 select * into d from private.client_delivery_destinations where id=p_destination for update;
 if d.id is null or not private.phase_5_admin_can_configure_folder_layout(d.organization_id)
   or not d.verified
   or (not d.active and (d.verification_receipt is null or not exists(
      select 1 from private.client_destination_provider_proof_receipts r
      where r.destination_id=d.id
        and r.proof_folder_id=d.verification_receipt->>'proof_folder_id')))
 then raise exception 'Verified authorized client destination required' using errcode='42501';end if;
 select * into prior from private.client_delivery_folder_layout_actions where action_id=p_action;
 if prior.action_id is not null then
   if prior.destination_id is distinct from p_destination
    or prior.actor_id is distinct from auth.uid()
    or prior.expected_revision is distinct from p_expected_revision
    or prior.selected_layout is distinct from p_layout then
     raise exception 'Folder layout action conflict' using errcode='40001';end if;
   return jsonb_build_object('destination_id',p_destination,
     'company_id',prior.company_id,'layout',prior.selected_layout,
     'revision',prior.resulting_revision,'replayed',true);
 end if;
 select * into old from private.client_delivery_folder_layouts
   where destination_id=p_destination for update;
 if old.destination_id is null then
   if p_expected_revision is not null then
     raise exception 'Folder layout selection revision conflict' using errcode='40001';end if;
 else
   if old.organization_id is distinct from d.organization_id
    or old.company_id is distinct from d.company_id
    or old.revision is distinct from p_expected_revision then
     raise exception 'Folder layout selection revision conflict' using errcode='40001';end if;
 end if;
 next_revision:=gen_random_uuid();
 insert into private.client_delivery_folder_layouts
  (destination_id,organization_id,company_id,layout,revision,configured_by)
 values(d.id,d.organization_id,d.company_id,p_layout,next_revision,auth.uid())
 on conflict(destination_id) do update
  set layout=excluded.layout, revision=excluded.revision,
      configured_at=clock_timestamp(),configured_by=excluded.configured_by;
 insert into private.client_delivery_folder_layout_actions
  (action_id,destination_id,organization_id,company_id,actor_id,
   expected_revision,selected_layout,resulting_revision)
 values(p_action,d.id,d.organization_id,d.company_id,auth.uid(),
    p_expected_revision,p_layout,next_revision);
 return jsonb_build_object('destination_id',d.id,'company_id',d.company_id,
  'layout',p_layout,'revision',next_revision,'replayed',false);
end;
$save$;
revoke all on function public.admin_list_client_folder_destinations(),
 public.admin_set_client_folder_layout(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_list_client_folder_destinations(),
 public.admin_set_client_folder_layout(uuid,uuid,uuid,text) to authenticated;

-- The activation journal is immutable, once per exact action UUID. Pausing
-- is likewise a separate audited service-only action; it may never erase
-- an approved package, remote-ID plan, outbox or protected photo.
create table private.client_destination_activation_actions (
 action_id uuid primary key,
 destination_id uuid not null references private.client_delivery_destinations(id) on delete restrict,
 organization_id uuid not null,
 company_id uuid not null,
 expected_revision uuid not null,
 expected_layout_revision uuid,
 expected_root_folder_id text not null,
 expected_provider_identity text not null,
 expected_proof_folder_id text not null,
 requested_active boolean not null,
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(organization_id,company_id)
   references private.client_companies(organization_id,id) on delete restrict
);
create trigger client_destination_activation_action_immutable
 before update or delete on private.client_destination_activation_actions
 for each row execute function private.protect_photo_transfer_ledger();
alter table private.client_destination_activation_actions enable row level security;
revoke all on private.client_destination_activation_actions
 from public,anon,authenticated,service_role;

-- Provider-trusted operator-controlled switch, never callable by an Admin
-- browser. Positive activation needs the original proposal, independent GET
-- preflight, confirmed reserved Google folder and explicit Admin layout.
-- This operation alone never starts a worker or sends a photo.
create function private.service_set_client_destination_active(
 p_action uuid,p_destination uuid,p_expected_revision uuid,
 p_expected_layout_revision uuid,p_expected_provider_identity text,
 p_expected_root_folder_id text,p_expected_proof_folder_id text,
 p_active boolean)
returns jsonb language plpgsql security definer set search_path=''
 set lock_timeout='5s' as $set$
declare d private.client_delivery_destinations%rowtype;
 prior private.client_destination_activation_actions%rowtype;
 p private.client_delivery_destination_proposals%rowtype;
 pf private.client_delivery_destination_preflights%rowtype;
 reservation private.client_destination_provider_proof_reservations%rowtype;
 proof private.client_destination_provider_proof_receipts%rowtype;
 layout private.client_delivery_folder_layouts%rowtype;
begin
 if p_action is null or p_destination is null or p_expected_revision is null
   or p_active is null or p_expected_provider_identity is null
   or p_expected_root_folder_id is null or p_expected_proof_folder_id is null
   or (p_active and p_expected_layout_revision is null)
 then raise exception 'Exact provider destination activation action required' using errcode='22023';end if;

 select * into d from private.client_delivery_destinations where id=p_destination for update;
 if d.id is null or d.revision is distinct from p_expected_revision
  or d.provider<>'GOOGLE_DRIVE'
  or d.provider_identity is distinct from p_expected_provider_identity
  or d.root_folder_id is distinct from p_expected_root_folder_id
  or d.verification_receipt->>'proof_folder_id' is distinct from p_expected_proof_folder_id
 then raise exception 'Destination identity or revision changed' using errcode='42501';end if;

 select * into prior from private.client_destination_activation_actions where action_id=p_action;
 if prior.action_id is not null then
  if prior.destination_id is distinct from p_destination
    or prior.organization_id is distinct from d.organization_id
    or prior.company_id is distinct from d.company_id
    or prior.expected_revision is distinct from p_expected_revision
    or prior.expected_layout_revision is distinct from p_expected_layout_revision
    or prior.expected_provider_identity is distinct from p_expected_provider_identity
    or prior.expected_root_folder_id is distinct from p_expected_root_folder_id
    or prior.expected_proof_folder_id is distinct from p_expected_proof_folder_id
    or prior.requested_active is distinct from p_active then
    raise exception 'Destination activation action conflict' using errcode='40001';end if;
  return jsonb_build_object('destination_id',d.id,'active',d.active,
    'verified',d.verified,'replayed',true);
 end if;

 if d.active is not distinct from p_active then
  raise exception 'Destination already at requested activation state; use original action to reconcile'
    using errcode='40001';end if;

 -- A pause must be possible even when a remote delivery is unresolved.
 if p_active then
   select * into p from private.client_delivery_destination_proposals
      where destination_id=d.id;
   select * into reservation from private.client_destination_provider_proof_reservations
      where destination_id=d.id;
   select * into proof from private.client_destination_provider_proof_receipts
      where destination_id=d.id;
   select * into pf from private.client_delivery_destination_preflights
      where action_id=reservation.preflight_action_id;
   select * into layout from private.client_delivery_folder_layouts
      where destination_id=d.id;
   if not d.verified or d.verified_at is null
     or d.verification_receipt->>'type' is distinct from 'CLIENT_ROOT_DISPOSABLE_FOLDER_GET_LIST_V1'
     or p.action_id is null or reservation.action_id is null
     or proof.action_id is null or pf.action_id is null
     or p.organization_id is distinct from d.organization_id
     or p.company_id is distinct from d.company_id
     or p.expected_provider_identity is distinct from d.provider_identity
     or p.expected_root_folder_id is distinct from d.root_folder_id
     or reservation.organization_id is distinct from d.organization_id
     or reservation.company_id is distinct from d.company_id
     or reservation.expected_revision is distinct from d.revision
     or reservation.provider_identity is distinct from d.provider_identity
     or reservation.root_folder_id is distinct from d.root_folder_id
     or reservation.proof_folder_id is distinct from proof.proof_folder_id
     or reservation.drive_id is distinct from proof.proof_drive_id
     or proof.proof_folder_id is distinct from p_expected_proof_folder_id
     or pf.destination_id is distinct from d.id
     or pf.expected_revision is distinct from d.revision
     or pf.organization_id is distinct from d.organization_id
     or pf.company_id is distinct from d.company_id
     or pf.provider_identity is distinct from d.provider_identity
     or pf.root_folder_id is distinct from d.root_folder_id
     or pf.shared_drive_id is distinct from proof.proof_drive_id
     or d.verification_receipt->>'root_folder_id' is distinct from d.root_folder_id
     or d.verification_receipt->>'provider_identity' is distinct from d.provider_identity
     or d.verification_receipt->>'shared_drive_id' is distinct from proof.proof_drive_id
     or layout.destination_id is null
     or layout.organization_id is distinct from d.organization_id
     or layout.company_id is distinct from d.company_id
     or layout.revision is distinct from p_expected_layout_revision
   then raise exception 'Original provider proof and explicit client layout required'
     using errcode='42501';end if;
 end if;

 insert into private.client_destination_activation_actions(
  action_id,destination_id,organization_id,company_id,expected_revision,
  expected_layout_revision,expected_root_folder_id,expected_provider_identity,
  expected_proof_folder_id,requested_active)
 values(p_action,d.id,d.organization_id,d.company_id,d.revision,
  p_expected_layout_revision,d.root_folder_id,d.provider_identity,
  p_expected_proof_folder_id,p_active);
 update private.client_delivery_destinations set active=p_active
  where id=d.id and revision=d.revision and active<>p_active;
 if not found then raise exception 'Destination activation conflict' using errcode='40001';end if;
 return jsonb_build_object('destination_id',d.id,'active',p_active,
   'verified',d.verified,'replayed',false);
end;
$set$;
create function public.service_set_client_destination_active(
 p_action uuid,p_destination uuid,p_expected_revision uuid,
 p_expected_layout_revision uuid,p_expected_provider_identity text,
 p_expected_root_folder_id text,p_expected_proof_folder_id text,p_active boolean)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_set_client_destination_active(
 p_action,p_destination,p_expected_revision,p_expected_layout_revision,
 p_expected_provider_identity,p_expected_root_folder_id,p_expected_proof_folder_id,p_active)
$wrap$;
revoke all on function
 private.service_set_client_destination_active(uuid,uuid,uuid,uuid,text,text,text,boolean),
 public.service_set_client_destination_active(uuid,uuid,uuid,uuid,text,text,text,boolean)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_set_client_destination_active(uuid,uuid,uuid,uuid,text,text,text,boolean),
 public.service_set_client_destination_active(uuid,uuid,uuid,uuid,text,text,text,boolean)
 to service_role;
