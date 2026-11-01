-- Operator-only FWH TEAM TEST data reconciliation, not a schema migration.
-- Existing Phase 5 verified initial-access mapping is authoritative. Never
-- derive owner/team authority from an email, business name, address or JWT.
-- Restore ONLY currently occupied capacity: Admin 1, Supervisor 0.
-- No extra seat, account, invitation, new team, role, scope, photo or WO edit.
-- This file intentionally has no automatic reset or repeat/UPSERT behavior.
-- Review exact TEST preflight and run once as postgres; it fails closed on drift.
begin;
set local lock_timeout = '5s';
do $fwh_phase6f_existing_office$
declare
  target_org uuid;
  trusted_owner uuid;
  matched integer;
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'Trusted postgres operator required' using errcode='42501';
  end if;

  -- Serialize with the existing account-lifecycle write authority.
  perform private.lock_account_lifecycle();
  lock table private.org_office_allowances in share row exclusive mode;

  if (select count(*) from private.initial_access_bootstrap) <> 1
     or (select count(*) from public.organizations) <> 2
     or (select count(*) from private.org_office_allowances) <> 1
     or (select count(*) from private.platform_owner_capabilities
         where active and environment='TEST' and verified_at is not null) <> 1 then
    raise exception 'Reviewed TEAM TEST initial inventory changed' using errcode='40001';
  end if;

  select b.organization_id,c.user_id into target_org,trusted_owner
  from private.initial_access_bootstrap b
  join private.platform_owner_capabilities c
    on c.user_id=(b.manifest->>'owner_id')::uuid
   and c.environment='TEST' and c.active and c.verified_at is not null
  join auth.users u on u.id=c.user_id
  where c.user_id=(b.manifest->>'admin_id')::uuid
    and b.manifest->>'environment'='TEST'
    and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
    and u.raw_app_meta_data->>'organization_id'=b.organization_id::text
    and u.raw_app_meta_data->>'role'='ADMIN';

  if target_org is null or trusted_owner is null
     or exists(select 1 from private.org_office_allowances
               where organization_id=target_org)
     or (select count(*) from public.admin_teams t
         where t.organization_id=target_org and t.active) <> 1
     or (select count(*) from private.admin_team_memberships m
         where m.organization_id=target_org and m.user_id=trusted_owner and m.active) <> 1
     or (select count(*) from private.account_work_access a
         where a.organization_id=target_org and a.user_id=trusted_owner
           and a.work_role='ADMIN' and a.active and a.disabled_at is null) <> 1
     or (select count(*) from private.account_work_access a
         where a.organization_id=target_org and a.work_role='ADMIN'
           and a.active and a.disabled_at is null) <> 1
     or (select count(*) from auth.users u
         where u.raw_app_meta_data->>'organization_id'=target_org::text
           and u.raw_app_meta_data->>'role'='ADMIN' and u.deleted_at is null) <> 1
     or exists(select 1 from private.account_work_access a
         where a.organization_id=target_org and a.work_role='SUPERVISOR'
           and a.active and a.disabled_at is null)
     or not exists(select 1 from private.org_work_settings w
         where w.organization_id=target_org and not w.supervisor_work_ready)
     or exists(select 1 from private.office_seat_reservations r
         where r.organization_id=target_org)
     or exists(select 1 from private.scoped_admin_invitation_reservations r
         where r.organization_id=target_org)
     or exists(select 1 from public.work_orders w
         where w.organization_id=target_org and w.responsible_team_id is null) then
    raise exception 'Owner, team, active seats or reservation inventory changed; no setup'
      using errcode='40001';
  end if;

  -- Exactly the existing verified active count; no invitation capacity added.
  insert into private.org_office_allowances
    (organization_id,admin_limit,supervisor_limit)
  values (target_org,1,0);
  get diagnostics matched = row_count;
  if matched <> 1
     or not exists(select 1 from private.org_office_allowances a
        where a.organization_id=target_org
          and a.admin_limit=1 and a.supervisor_limit=0) then
    raise exception 'Exact TEST allowance insert not confirmed' using errcode='40001';
  end if;
  raise notice 'FWH TEST verified existing office capacity reconciled: 1 occupied Admin, 0 Supervisor; no available new seat.';
end;
$fwh_phase6f_existing_office$;
commit;
