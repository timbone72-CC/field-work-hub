-- Phase 5A/5D: Admin may stage one strictly INACTIVE, UNVERIFIED client destination.
-- This is NOT Google verification, client Send, a credential vault or worker activation.
-- The independent trusted provider owner must prove identity, correct company root and
-- remote create/readback before a separate governed service-only activation exists.
create table private.client_delivery_destination_proposals (
 action_id uuid primary key,
 destination_id uuid not null unique references private.client_delivery_destinations(id) on delete restrict,
 organization_id uuid not null,
 company_id uuid not null,
 actor_id uuid not null,
 expected_provider_identity text not null,
 expected_root_folder_id text not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key (organization_id,company_id)
   references private.client_companies(organization_id,id) on delete restrict
);
create trigger client_destination_proposal_immutable
 before update or delete on private.client_delivery_destination_proposals
 for each row execute function private.protect_photo_transfer_ledger();
alter table private.client_delivery_destination_proposals enable row level security;
revoke all on private.client_delivery_destination_proposals
 from public,anon,authenticated,service_role;

-- A client root is not an interchangeable shared company bucket. Disallow even
-- unverified proposals for the same root, including across tenants/companies.
create unique index client_delivery_destinations_exclusive_root
 on private.client_delivery_destinations(root_folder_id);

create function public.admin_propose_client_delivery_destination(
 p_action uuid,p_company uuid,p_workspace_email text,p_root_folder_id text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $proposal$
declare c private.client_companies%rowtype;
 prior private.client_delivery_destination_proposals%rowtype;
 d private.client_delivery_destinations%rowtype;
 account_email text:=lower(btrim(coalesce(p_workspace_email,'')));
 root_id text:=coalesce(p_root_folder_id,'');
begin
 if p_action is null or p_company is null
   or account_email !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$'
   or length(account_email)>254
   or root_id !~ '^[A-Za-z0-9_-]{10,160}$'
 then raise exception 'Exact client destination proposal required' using errcode='22023';end if;

 -- Follow the existing trusted account/role scope owner. No owner/contractor
 -- escalation and no trust in browser-submitted organization identifiers.
 perform private.lock_account_lifecycle();
 if not private.current_identity_valid() then
  raise exception 'Active Admin identity required' using errcode='42501';end if;
 select * into c from private.client_companies where id=p_company for key share;
 if c.id is null or not c.active or
   not private.phase_5_admin_can_configure_folder_layout(c.organization_id) then
  raise exception 'Authorized active client company required' using errcode='42501';end if;

 -- Serialize identical action UUIDs across devices; never create a second root
 -- because the first response was lost.
 perform pg_advisory_xact_lock(hashtextextended('fwh.client.destination.proposal.'||p_action::text,0));
 select * into prior from private.client_delivery_destination_proposals
  where action_id=p_action;
 if prior.action_id is not null then
  if prior.actor_id is distinct from auth.uid()
   or prior.company_id is distinct from p_company
   or prior.expected_provider_identity is distinct from account_email
   or prior.expected_root_folder_id is distinct from root_id then
   raise exception 'Destination proposal action conflict' using errcode='40001';end if;
  select * into d from private.client_delivery_destinations where id=prior.destination_id;
  return jsonb_build_object('destination_id',d.id,'company_id',d.company_id,
   'verified',d.verified,'active',d.active,'revision',d.revision,'replayed',true);
 end if;
 if exists(select 1 from private.client_delivery_destinations
   where root_folder_id=root_id) then
   raise exception 'Client destination root already reserved' using errcode='23505';end if;
 insert into private.client_delivery_destinations
  (organization_id,company_id,provider,provider_identity,root_folder_id,verified,active)
 values(c.organization_id,c.id,'GOOGLE_DRIVE',account_email,root_id,false,false)
 returning * into d;
 insert into private.client_delivery_destination_proposals
  (action_id,destination_id,organization_id,company_id,actor_id,
   expected_provider_identity,expected_root_folder_id)
 values(p_action,d.id,c.organization_id,c.id,auth.uid(),account_email,root_id);
 return jsonb_build_object('destination_id',d.id,'company_id',d.company_id,
  'verified',false,'active',false,'revision',d.revision,'replayed',false);
end;
$proposal$;
revoke all on function public.admin_propose_client_delivery_destination(uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_propose_client_delivery_destination(uuid,uuid,text,text)
 to authenticated;
