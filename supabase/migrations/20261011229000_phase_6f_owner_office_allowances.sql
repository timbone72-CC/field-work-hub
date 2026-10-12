-- Phase 6F allowance control: existing configured organization only.
-- No account creation, invitation reservation, or live Supervisor activation.
create function public.owner_set_office_allowances(
 p_org uuid,p_expected_revision uuid,p_admin_limit integer,p_supervisor_limit integer,
 p_reason text,p_environment text
) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 current_row private.org_office_allowances%rowtype;
 active_admins integer;
 active_supervisors integer;
 next_revision uuid;
begin
 if p_org is null or p_expected_revision is null or p_admin_limit is null
    or p_supervisor_limit is null or p_admin_limit<0 or p_supervisor_limit<0
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000
    or p_environment is null or p_environment not in ('TEST','PRODUCTION') then
   raise exception 'Invalid office allowance request' using errcode='22023';
 end if;
 if not private.is_current_platform_owner(p_environment) then
   raise exception 'Verified Product Owner required' using errcode='42501';
 end if;
 perform private.lock_account_lifecycle();
 if not private.is_current_platform_owner(p_environment) then
   raise exception 'Product Owner authorization changed' using errcode='42501';
 end if;
 select * into current_row from private.org_office_allowances
   where organization_id=p_org for update;
 if not found then
   raise exception 'Existing configured organization allowance required' using errcode='42501';
 end if;
 if current_row.revision is distinct from p_expected_revision then
   raise exception 'Stale allowance revision' using errcode='40001';
 end if;
 select count(*) into active_admins from private.account_work_access a
   where a.organization_id=p_org and a.work_role='ADMIN' and a.active
   and a.disabled_at is null;
 select count(*) into active_supervisors from private.account_work_access a
   join private.supervisor_grants g on g.organization_id=a.organization_id and g.user_id=a.user_id
   where a.organization_id=p_org and a.work_role='SUPERVISOR' and a.active
   and a.disabled_at is null and g.active;
 if p_admin_limit<active_admins or p_supervisor_limit<active_supervisors then
   raise exception 'Allowance below current active account count' using errcode='23514';
 end if;
 if current_row.admin_limit=p_admin_limit and current_row.supervisor_limit=p_supervisor_limit then
   return current_row.revision;
 end if;
 next_revision:=gen_random_uuid();
 update private.org_office_allowances set admin_limit=p_admin_limit,
   supervisor_limit=p_supervisor_limit,revision=next_revision
   where organization_id=p_org;
 return next_revision;
end;
$$;
revoke all on function public.owner_set_office_allowances(uuid,uuid,integer,integer,text,text)
 from public,anon;
grant execute on function public.owner_set_office_allowances(uuid,uuid,integer,integer,text,text)
 to authenticated,service_role;
