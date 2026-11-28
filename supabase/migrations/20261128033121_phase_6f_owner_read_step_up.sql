-- Phase 6F: valid verified Owner reads are independent of recent-auth mutation authority.
-- Preserve private.is_current_platform_owner and all existing mutation checks unchanged.
create function private.has_current_platform_owner(p_environment text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(p_environment in ('TEST','PRODUCTION') and private.current_identity_valid() and exists(
    select 1 from private.platform_owner_capabilities c
    where c.user_id=auth.uid() and c.active and c.environment=p_environment
  ), false)
$$;
revoke all on function private.has_current_platform_owner(text) from public,anon,authenticated,service_role;

create or replace function public.owner_office_capacity_status(p_org uuid,p_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.org_office_allowances%rowtype; a bigint; s bigint; ra bigint; rs bigint;
begin
 if p_org is null or p_environment not in ('TEST','PRODUCTION')
   or not private.has_current_platform_owner(p_environment) then
   raise exception 'Verified Product Owner required' using errcode='42501';
 end if;
 select * into q from private.org_office_allowances where organization_id=p_org;
 if not found then raise exception 'Office limits unavailable' using errcode='42501';end if;
 select count(*) filter(where w.work_role='ADMIN'),
        count(*) filter(where w.work_role='SUPERVISOR' and g.active)
 into a,s from private.account_work_access w
 left join private.supervisor_grants g
   on g.organization_id=w.organization_id and g.user_id=w.user_id
 where w.organization_id=p_org and w.active and w.disabled_at is null;
 select count(*) filter(where requested_role='ADMIN'),
        count(*) filter(where requested_role='SUPERVISOR')
 into ra,rs from private.office_seat_reservations
 where organization_id=p_org and state='RESERVED';
 return jsonb_build_object('organization_id',p_org,'revision',q.revision,
 'recent_authentication',private.is_current_platform_owner(p_environment),
 'admin_limit',q.admin_limit,'admin_active',a,'admin_reserved',ra,
 'admin_available',greatest(0,q.admin_limit-a-ra),
 'supervisor_limit',q.supervisor_limit,'supervisor_active',s,'supervisor_reserved',rs,
 'supervisor_available',greatest(0,q.supervisor_limit-s-rs));
end;$$;

create or replace function public.owner_supervisor_grant_list(
  p_org uuid,p_environment text,p_after uuid default null,p_limit integer default 25
) returns table(user_id uuid,account_email text,tier smallint,grant_active boolean,grant_revision uuid,
   work_active boolean,team_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if p_org is null or p_limit not between 1 and 50 or p_limit is null
   or p_environment not in ('TEST','PRODUCTION')
   or not private.has_current_platform_owner(p_environment)
   or not exists(select 1 from private.org_office_allowances a where a.organization_id=p_org)
 then raise exception 'Verified office owner required' using errcode='42501';end if;
 return query select g.user_id,u.email::text,g.tier,g.active,g.revision,
   (a.active and a.disabled_at is null),(
    select count(*) from private.supervisor_team_scopes s
    where s.organization_id=g.organization_id and s.user_id=g.user_id)
 from private.supervisor_grants g
 join private.account_work_access a
   on a.organization_id=g.organization_id and a.user_id=g.user_id
 join auth.users u on u.id=g.user_id
 where g.organization_id=p_org and (p_after is null or g.user_id>p_after)
 order by g.user_id limit p_limit;
end;$$;

create or replace function public.owner_office_team_list(
 p_org uuid,p_environment text,p_after uuid default null,p_limit integer default 25)
returns table(team_id uuid,team_name text,active boolean,revision uuid,admin_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if p_org is null or p_limit is null or p_limit not between 1 and 50
  or p_environment not in ('TEST','PRODUCTION')
  or not private.has_current_platform_owner(p_environment)
  or not exists(select 1 from private.org_office_allowances a where a.organization_id=p_org)
 then raise exception 'Verified office owner required' using errcode='42501';end if;
 return query select t.id,t.name,t.active,t.revision,(
   select count(*) from private.admin_team_memberships m
   join private.account_work_access a on a.organization_id=m.organization_id
     and a.user_id=m.user_id
   where m.organization_id=t.organization_id and m.team_id=t.id and m.active
     and a.work_role='ADMIN' and a.active and a.disabled_at is null)
 from public.admin_teams t
 where t.organization_id=p_org and (p_after is null or t.id>p_after)
 order by t.id limit p_limit;
end;$$;

create or replace function public.owner_supervisor_team_scope_list(
 p_org uuid,p_user uuid,p_environment text)
returns table(team_id uuid)
language plpgsql security definer set search_path='' as $$
begin
 if p_org is null or p_user is null
   or p_environment not in ('TEST','PRODUCTION')
   or not private.has_current_platform_owner(p_environment)
   or not exists(select 1 from private.org_office_allowances o where o.organization_id=p_org)
   or not exists(select 1 from private.supervisor_grants g
       where g.organization_id=p_org and g.user_id=p_user)
 then raise exception 'Verified owner and existing Supervisor required' using errcode='42501';end if;
 return query select s.team_id from private.supervisor_team_scopes s
   where s.organization_id=p_org and s.user_id=p_user
   order by s.team_id;
end;$$;

create or replace function public.owner_office_people_list(
 p_org uuid,p_environment text,p_after uuid default null,p_limit integer default 50)
returns table(user_id uuid,account_email text,work_role text,work_active boolean,
 access_revision uuid,identity_ready boolean,roster_team_id uuid,roster_revision uuid)
language plpgsql security definer set search_path='' as $$
begin
 if p_org is null or p_limit is null or p_limit not between 1 and 50
   or p_environment not in ('TEST','PRODUCTION')
   or not private.has_current_platform_owner(p_environment)
   or not exists(select 1 from private.org_office_allowances s where s.organization_id=p_org)
 then raise exception 'Verified Product Owner required' using errcode='42501';end if;
 return query
   select a.user_id,u.email::text,a.work_role,
     (a.active and a.disabled_at is null),a.revision,
     private.account_identity_ready(a.organization_id,a.user_id,a.work_role),
     case when a.work_role='CONTRACTOR' and m.active then m.team_id else null end,
     case when a.work_role='CONTRACTOR' then m.revision else null end
   from private.account_work_access a
   join auth.users u on u.id=a.user_id
   left join private.contractor_team_memberships m
     on m.organization_id=a.organization_id and m.user_id=a.user_id
   where a.organization_id=p_org and (p_after is null or a.user_id>p_after)
   order by a.user_id limit p_limit;
end;$$;
