-- Phase 5: current Admin may choose only an authorized verified client root.
-- This list is a projection, not a permission grant or an activation action.
create function public.admin_list_client_folder_destinations()
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
   'layout_configured',l.destination_id is not null,'revision',l.revision)
   order by c.name,d.id),'[]'::jsonb)
 into results
 from private.client_delivery_destinations d
 join private.client_companies c on c.id=d.company_id and c.organization_id=d.organization_id
 left join private.client_delivery_folder_layouts l on l.destination_id=d.id
 where d.organization_id=actor_org and d.active and d.verified;
 return jsonb_build_object('destinations',results);
end;
$list$;
revoke all on function public.admin_list_client_folder_destinations()
 from public,anon,authenticated,service_role;
grant execute on function public.admin_list_client_folder_destinations() to authenticated;
