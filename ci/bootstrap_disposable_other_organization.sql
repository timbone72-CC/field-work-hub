-- One-shot, operator-only DATA fixture. Not a migration, RPC, Auth bootstrap,
-- invitation, WO mapping, or ongoing way to create tenant authority.
-- Execute only against the verified FWH TEAM TEST database as postgres.
-- No user/role/permissions/other-organization/photo/provider state is touched.
do $fwh_disposable_setup$
declare
  target_org uuid;
  new_team uuid;
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'Operator-only database session required' using errcode = '42501';
  end if;
  if (select count(*) from public.organizations) <> 2 or
     (select count(*) from public.organizations
      where name = 'TEST OTHER ORGANIZATION - DISPOSABLE') <> 1 then
    raise exception 'Reviewed two-organization TEST inventory changed' using errcode = '40001';
  end if;
  select id into target_org from public.organizations
    where name = 'TEST OTHER ORGANIZATION - DISPOSABLE' for update;
  if target_org is null or
     (select count(*) from private.platform_owner_capabilities c
      join auth.users u on u.id = c.user_id
      where c.environment = 'TEST' and c.active and c.verified_at is not null
        and u.email_confirmed_at is not null and u.deleted_at is null) <> 1 or
     (select count(*) from public.work_orders w
      where w.organization_id = target_org) <> 1 or
     exists(select 1 from public.work_orders w
       where w.organization_id = target_org and w.responsible_team_id is not null) or
     exists(select 1 from public.work_order_assignments a
       where a.organization_id = target_org) or
     exists(select 1 from public.photos p join public.work_orders w
       on w.id = p.work_order_id where w.organization_id = target_org) or
     exists(select 1 from public.admin_teams t
       where t.organization_id = target_org) or
     exists(select 1 from private.org_work_settings s
       where s.organization_id = target_org) or
     exists(select 1 from private.org_office_allowances s
       where s.organization_id = target_org) or
     exists(select 1 from private.initial_access_bootstrap s
       where s.organization_id = target_org) or
     exists(select 1 from private.account_work_access a
       where a.organization_id = target_org) or
     exists(select 1 from private.admin_team_memberships m
       where m.organization_id = target_org) or
     exists(select 1 from private.contractor_team_memberships m
       where m.organization_id = target_org) or
     exists(select 1 from private.office_seat_reservations r
       where r.organization_id = target_org) or
     exists(select 1 from private.scoped_admin_invitation_reservations r
       where r.organization_id = target_org) or
     exists(select 1 from public.contractor_invitations i
       where i.organization_id = target_org) or
     exists(select 1 from auth.users u
       where u.raw_app_meta_data->>'organization_id' = target_org::text) then
    raise exception 'Disposable organization preflight failed; no partial setup'
      using errcode = '40001';
  end if;

  insert into public.admin_teams(organization_id, name)
    values(target_org, 'Disposable TEST Admin Team') returning id into new_team;
  insert into private.org_work_settings(organization_id, supervisor_work_ready)
    values(target_org, false);
  insert into private.org_office_allowances(organization_id, admin_limit, supervisor_limit)
    values(target_org, 1, 0);

  if not exists(select 1 from public.admin_teams t
       where t.id = new_team and t.organization_id = target_org and t.active)
     or not exists(select 1 from private.org_office_allowances a
       where a.organization_id = target_org and a.admin_limit = 1
         and a.supervisor_limit = 0) then
    raise exception 'Atomic TEST office setup was not confirmed'
      using errcode = '40001';
  end if;
  raise notice 'FWH disposable other-organization office initialized. No Auth account, invitation, membership, WO binding or photo access created.';
end;
$fwh_disposable_setup$;
