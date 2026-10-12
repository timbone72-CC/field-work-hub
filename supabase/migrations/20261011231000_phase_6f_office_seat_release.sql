-- Phase 6F reservation lifecycle: audited owner cancellation without user creation.
-- Explicit final state prevents replay from reinstating a released seat.
create function public.owner_release_office_seat(
 p_action uuid,p_org uuid,p_reason text,p_environment text
) returns text
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 reservation private.office_seat_reservations%rowtype;
begin
 if p_action is null or p_org is null or p_reason is null
    or char_length(btrim(p_reason)) not between 1 and 1000
    or p_environment is null or p_environment not in ('TEST','PRODUCTION') then
   raise exception 'Invalid seat release request' using errcode='22023';
 end if;
 if not private.is_current_platform_owner(p_environment) then
   raise exception 'Verified Product Owner required' using errcode='42501';
 end if;
 perform private.lock_account_lifecycle();
 if not private.is_current_platform_owner(p_environment) then
   raise exception 'Product Owner authorization changed' using errcode='42501';
 end if;
 select * into reservation from private.office_seat_reservations
   where action_id=p_action and organization_id=p_org for update;
 if not found then
   raise exception 'Exact seat reservation unavailable' using errcode='42501';
 end if;
 if reservation.state='CONSUMED' then
   raise exception 'Consumed seat cannot be cancelled' using errcode='42501';
 end if;
 if reservation.state='RELEASED' then return 'RELEASED'; end if;
 update private.office_seat_reservations set state='RELEASED'
   where action_id=p_action and organization_id=p_org and state='RESERVED';
 if not found then raise exception 'Reservation changed' using errcode='40001'; end if;
 return 'RELEASED';
end;
$$;
revoke all on function public.owner_release_office_seat(uuid,uuid,text,text)
 from public,anon;
grant execute on function public.owner_release_office_seat(uuid,uuid,text,text)
 to authenticated,service_role;

-- Owner-only metadata; no customer work or photo rows returned.
create function public.owner_office_capacity_status(p_org uuid,p_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.org_office_allowances%rowtype; a bigint; s bigint; ra bigint; rs bigint;
begin
 if p_org is null or p_environment not in ('TEST','PRODUCTION')
   or not private.is_current_platform_owner(p_environment) then
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
 'admin_limit',q.admin_limit,'admin_active',a,'admin_reserved',ra,
 'admin_available',greatest(0,q.admin_limit-a-ra),
 'supervisor_limit',q.supervisor_limit,'supervisor_active',s,'supervisor_reserved',rs,
 'supervisor_available',greatest(0,q.supervisor_limit-s-rs));
end;$$;
revoke all on function public.owner_office_capacity_status(uuid,text) from public,anon;
grant execute on function public.owner_office_capacity_status(uuid,text) to authenticated,service_role;

-- Paginated owner-only Supervisor grant metadata; never photo or customer work.
create function public.owner_supervisor_grant_list(
  p_org uuid,p_environment text,p_after uuid default null,p_limit integer default 25
) returns table(user_id uuid,tier smallint,grant_active boolean,grant_revision uuid,
   work_active boolean,team_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if p_org is null or p_limit not between 1 and 50 or p_limit is null
   or p_environment not in ('TEST','PRODUCTION')
   or not private.is_current_platform_owner(p_environment)
   or not exists(select 1 from private.org_office_allowances a where a.organization_id=p_org)
 then raise exception 'Verified office owner required' using errcode='42501';end if;
 return query select g.user_id,g.tier,g.active,g.revision,
   (a.active and a.disabled_at is null),(
    select count(*) from private.supervisor_team_scopes s
    where s.organization_id=g.organization_id and s.user_id=g.user_id)
 from private.supervisor_grants g
 join private.account_work_access a
   on a.organization_id=g.organization_id and a.user_id=g.user_id
 where g.organization_id=p_org and (p_after is null or g.user_id>p_after)
 order by g.user_id limit p_limit;
end;$$;
revoke all on function public.owner_supervisor_grant_list(uuid,text,uuid,integer) from public,anon;
grant execute on function public.owner_supervisor_grant_list(uuid,text,uuid,integer) to authenticated,service_role;

-- Exact configured organization team choices for the Product Owner.
-- No job data, assignment, customer address or photo access.
create function public.owner_office_team_list(
 p_org uuid,p_environment text,p_after uuid default null,p_limit integer default 25)
returns table(team_id uuid,team_name text,active boolean,revision uuid,admin_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if p_org is null or p_limit is null or p_limit not between 1 and 50
  or p_environment not in ('TEST','PRODUCTION')
  or not private.is_current_platform_owner(p_environment)
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
revoke all on function public.owner_office_team_list(uuid,text,uuid,integer) from public,anon;
grant execute on function public.owner_office_team_list(uuid,text,uuid,integer) to authenticated,service_role;
