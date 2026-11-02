-- Source-only repair for the Auth-session / guarded-work lock inversion.
-- Preserve every lock mode, authorization predicate, grant and timeout.
-- Hosted parity before applying must match the reviewed legacy helper.
do $parity$
begin
  if (select md5(prosrc) from pg_proc
      where oid='private.lock_legacy_work_authority()'::regprocedure)
      is distinct from 'd8dc334409f900382a820a228602ffe0' then
    raise exception 'Auth lock-order repair stopped: legacy authority source drift';
  end if;
  if has_function_privilege('anon','private.lock_legacy_work_authority()','EXECUTE')
    or has_function_privilege('authenticated','private.lock_legacy_work_authority()','EXECUTE')
    or not has_function_privilege('service_role','private.lock_legacy_work_authority()','EXECUTE') then
    raise exception 'Auth lock-order repair stopped: legacy authority grant drift';
  end if;
end;
$parity$;

create or replace function private.lock_legacy_work_authority() returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  lock table private.photo_recovery_grants in row exclusive mode;
  -- The observed Auth writer holds sessions before updating users. Wait for
  -- sessions BEFORE taking a users ShareLock, so it can finish without a cycle.
  lock table auth.sessions,auth.users,private.account_work_access,private.admin_team_memberships,
    private.contractor_team_memberships,private.supervisor_grants,private.supervisor_team_scopes,
    private.org_work_settings,public.admin_teams,public.contractor_invitations in share mode;
end; $$;

-- CREATE OR REPLACE retains the existing ACL. Do not add a client grant.
