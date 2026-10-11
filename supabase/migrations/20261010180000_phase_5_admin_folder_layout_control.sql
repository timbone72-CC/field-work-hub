-- Candidate Phase 5A/5D authenticated Admin-only folder layout selection.
-- No Drive writes, folder reservations, UI activation, or delivery enablement.
-- Keep historical package manifests immutable; revisions apply forward only.
create table private.client_delivery_folder_layout_actions (
 action_id uuid primary key,
 destination_id uuid not null references private.client_delivery_destinations(id),
 organization_id uuid not null,
 company_id uuid not null,
 actor_id uuid not null,
 expected_revision uuid,
 selected_layout text not null,
 resulting_revision uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(destination_id,resulting_revision)
);
alter table private.client_delivery_folder_layout_actions enable row level security;
revoke all on private.client_delivery_folder_layout_actions from public,anon,authenticated,service_role;

create function private.phase_5_admin_can_configure_folder_layout(p_org uuid)
returns boolean language sql stable security definer set search_path='' as $auth$
 select private.current_work_role(p_org)='ADMIN' and exists(
   select 1 from private.admin_team_memberships m
    join public.admin_teams t on t.id=m.team_id and t.organization_id=m.organization_id
   where m.organization_id=p_org and m.user_id=auth.uid()
     and m.active and t.active);
$auth$;
revoke all on function private.phase_5_admin_can_configure_folder_layout(uuid)
 from public,anon,authenticated,service_role;

create function public.admin_get_client_folder_layout(p_destination uuid)
returns jsonb language plpgsql security definer set search_path='' as $get$
declare d private.client_delivery_destinations%rowtype; selection jsonb;
begin
 select * into d from private.client_delivery_destinations where id=p_destination;
 if d.id is null or not private.phase_5_admin_can_configure_folder_layout(d.organization_id)
 then raise exception 'Admin client destination access required' using errcode='42501';end if;
 selection:=private.phase_5_current_folder_layout(d.id,d.organization_id,d.company_id);
 return selection||jsonb_build_object('destination_id',d.id,
  'company_id',d.company_id,'verified',d.verified,'active',d.active);
end;
$get$;

create function public.admin_set_client_folder_layout(
 p_action uuid,p_destination uuid,p_expected_revision uuid,p_layout text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $save$
declare d private.client_delivery_destinations%rowtype;
 old private.client_delivery_folder_layouts%rowtype;
 prior private.client_delivery_folder_layout_actions%rowtype;
 next_revision uuid; result jsonb;
begin
 if p_action is null or p_destination is null or
   p_layout not in ('ADDRESS_WORK_ORDER','STATE_CITY_ADDRESS','STATE_COUNTY_CITY_ADDRESS')
 then raise exception 'Exact folder layout action required' using errcode='22023';end if;
 select * into d from private.client_delivery_destinations where id=p_destination for update;
 if d.id is null or not private.phase_5_admin_can_configure_folder_layout(d.organization_id)
   or not d.active or not d.verified then
   raise exception 'Verified authorized client destination required' using errcode='42501';end if;
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
revoke all on function public.admin_get_client_folder_layout(uuid),
 public.admin_set_client_folder_layout(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_get_client_folder_layout(uuid),
 public.admin_set_client_folder_layout(uuid,uuid,uuid,text) to authenticated;
