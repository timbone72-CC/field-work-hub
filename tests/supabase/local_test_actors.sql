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
