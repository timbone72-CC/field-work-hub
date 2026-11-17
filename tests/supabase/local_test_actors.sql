-- Synthetic accepted actors in the disposable CI database only; no real PII.
insert into public.organizations(id,name) values ('00000000-0000-0000-0000-000000000001','FWH CI TEST');
insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000010','admin@example.invalid','{"role":"ADMIN","organization_id":"00000000-0000-0000-0000-000000000001"}',now()),
 ('00000000-0000-0000-0000-000000000011','a@example.invalid','{"role":"CONTRACTOR","organization_id":"00000000-0000-0000-0000-000000000001"}',now()),
 ('00000000-0000-0000-0000-000000000012','b@example.invalid','{"role":"CONTRACTOR","organization_id":"00000000-0000-0000-0000-000000000001"}',now());

-- Explicit Phase 5 authority for the existing synthetic actors, never hosted setup.
insert into public.admin_teams(id,organization_id,name) values
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','CI INITIAL TEAM');
insert into auth.sessions(id,user_id) select id,id from auth.users;
insert into private.account_work_access(organization_id,user_id,work_role,active)
 select (raw_app_meta_data->>'organization_id')::uuid,id,raw_app_meta_data->>'role',true from auth.users;
insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010',true);
insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000011',true),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000012',true);

-- CI-only historical fixture builders. These keep pre-company job scenarios
-- meaningful after old company-less creation RPCs are retired. Never migrate
-- this schema to hosted FWH. Current creation/ACL is tested through drafts.
create schema fwh_test_fixtures;
grant usage on schema fwh_test_fixtures to authenticated;
do $fixtures$
declare name text; definition text; signature text;
begin
 foreach name in array array['admin_create_work_order','admin_create_work_order_v4'] loop
  select pg_get_functiondef(p.oid),pg_get_function_identity_arguments(p.oid)
   into definition,signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=name;
  definition:=replace(definition,'public.'||name||'(', 'fwh_test_fixtures.legacy_create_work_order'||case when name like '%v4' then '_v4' else '' end||'(');
  execute definition;
  execute 'alter function fwh_test_fixtures.legacy_create_work_order'||case when name like '%v4' then '_v4' else '' end||'('||signature||') security definer';
  execute 'revoke all on function fwh_test_fixtures.legacy_create_work_order'||case when name like '%v4' then '_v4' else '' end||'('||signature||') from public,anon';
  execute 'grant execute on function fwh_test_fixtures.legacy_create_work_order'||case when name like '%v4' then '_v4' else '' end||'('||signature||') to authenticated';
 end loop;
end;$fixtures$;
