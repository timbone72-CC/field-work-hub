-- Disposable PostgreSQL fixture. Verify the exact operator-only SQL before
-- using it against the real Team TEST project. Never retain synthetic rows.
begin;
insert into public.organizations(id, name)
  values('00000000-0000-0000-0000-000000000090',
         'TEST OTHER ORGANIZATION - DISPOSABLE');
insert into public.work_orders(id, organization_id, wo_number,
  property_address, work_type, due_date)
  values('00000000-0000-0000-0000-000000000091',
         '00000000-0000-0000-0000-000000000090',
         'CI-DISPOSABLE-0001','TEST FIXTURE','TEST',current_date);
insert into private.platform_owner_capabilities(user_id,active,environment,verified_at)
  values('00000000-0000-0000-0000-000000000010',true,'TEST',now());

-- The real file rejects an ordinary authenticated caller, even a known Admin.
-- A controlled rollback-on-error keeps this disposable verification transaction live.
set local role authenticated;
\set ON_ERROR_ROLLBACK on
\set ON_ERROR_STOP off
\ir ../../ci/bootstrap_disposable_other_organization.sql
\if :ERROR
  \echo 'Expected ordinary-user bootstrap denial'
\else
  \echo 'SECURITY FAIL: authenticated caller ran operator bootstrap'
  \quit 1
\endif
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK off
reset role;

-- Execute the SAME SQL file that the operator would apply; this is DATA only.
\ir ../../ci/bootstrap_disposable_other_organization.sql

do $verify$
declare target_org uuid:='00000000-0000-0000-0000-000000000090';
  fixture_wo uuid:='00000000-0000-0000-0000-000000000091';
  team_id uuid;
begin
  select id into team_id from public.admin_teams where organization_id=target_org;
  if team_id is null or
     (select count(*) from public.admin_teams where organization_id=target_org)<>1 or
     (select count(*) from private.org_office_allowances where organization_id=target_org
       and admin_limit=1 and supervisor_limit=0)<>1 or
     (select count(*) from private.org_work_settings where organization_id=target_org
       and not supervisor_work_ready)<>1 or
     (select count(*) from auth.users)<>3 or
     (select count(*) from private.account_work_access)<>3 or
     (select count(*) from private.admin_team_memberships)<>1 or
     (select count(*) from public.work_orders where organization_id=target_org
       and id=fixture_wo and responsible_team_id is null)<>1 or
     (select count(*) from public.admin_teams where organization_id=
        '00000000-0000-0000-0000-000000000001')<>1 or
     (select count(*) from private.org_office_allowances where organization_id=
        '00000000-0000-0000-0000-000000000001')<>0 then
    raise exception 'Disposable bootstrap altered work/roles or wrong tenant';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub','00000000-0000-0000-0000-000000000010',
    'session_id','00000000-0000-0000-0000-000000000010')::text, true);
  if private.has_team_capability(target_org,team_id,'WORK') or
     private.can_work_order(fixture_wo) then
    raise exception 'Product Owner or first-org Admin gained other-org work access';
  end if;
  raise notice 'Disposable other-org bootstrap atomicity, owner isolation and bounded seat PASS';
end;
$verify$;
-- A second execution cannot create a second team, seat, or membership.
\set ON_ERROR_ROLLBACK on
\set ON_ERROR_STOP off
\ir ../../ci/bootstrap_disposable_other_organization.sql
\if :ERROR
  \echo 'Expected one-shot bootstrap replay denial'
\else
  \echo 'SECURITY FAIL: one-shot bootstrap accepted replay'
  \quit 1
\endif
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK off
rollback;
