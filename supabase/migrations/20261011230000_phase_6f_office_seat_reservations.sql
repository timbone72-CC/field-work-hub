-- Phase 6F: bounded owner-only office seat reservation foundation.
-- No Auth invitation, external email or new work entitlement is created.
create table private.office_seat_reservations (
 action_id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 requested_role text not null check(requested_role in ('ADMIN','SUPERVISOR')),
 actor_id uuid not null references auth.users(id) on delete restrict,
 state text not null default 'RESERVED' check(state in ('RESERVED','RELEASED','CONSUMED')),
 reason text not null check(char_length(btrim(reason)) between 1 and 1000),
 created_at timestamptz not null default clock_timestamp()
);
create index office_seat_reservations_capacity_idx
 on private.office_seat_reservations(organization_id,requested_role,state);
alter table private.office_seat_reservations enable row level security;
revoke all on private.office_seat_reservations from public,anon,authenticated,service_role;
grant select,insert,update on private.office_seat_reservations to service_role;

create function public.owner_reserve_office_seat(
 p_action uuid,p_org uuid,p_role text,p_reason text,p_environment text
) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 quota private.org_office_allowances%rowtype;
 prior private.office_seat_reservations%rowtype;
 active_count bigint;
 reserved_count bigint;
 seat_limit integer;
begin
 if p_action is null or p_org is null or p_role is null or p_role not in ('ADMIN','SUPERVISOR')
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000
    or p_environment is null or p_environment not in ('TEST','PRODUCTION') then
   raise exception 'Invalid office seat reservation' using errcode='22023';
 end if;
 if not private.is_current_platform_owner(p_environment) then
   raise exception 'Verified Product Owner required' using errcode='42501';
 end if;
 perform private.lock_account_lifecycle();
 if not private.is_current_platform_owner(p_environment) then
   raise exception 'Product Owner authorization changed' using errcode='42501';
 end if;
 select * into prior from private.office_seat_reservations where action_id=p_action;
 if found then
   if row(prior.organization_id,prior.requested_role,prior.actor_id,prior.reason)
      is distinct from row(p_org,p_role,auth.uid(),btrim(p_reason)) then
     raise exception 'Reservation action reused with different inputs' using errcode='22023';
   end if;
   if prior.state<>'RESERVED' then
     raise exception 'Reservation no longer active' using errcode='42501';
   end if;
   return prior.action_id;
 end if;
 select * into quota from private.org_office_allowances where organization_id=p_org for update;
 if not found then
   raise exception 'Office allowance not configured' using errcode='42501';
 end if;
 if p_role='ADMIN' then
   seat_limit:=quota.admin_limit;
   select count(*) into active_count from private.account_work_access a
    where a.organization_id=p_org and a.work_role='ADMIN' and a.active
      and a.disabled_at is null;
 else
   seat_limit:=quota.supervisor_limit;
   select count(*) into active_count from private.account_work_access a
    join private.supervisor_grants g on g.organization_id=a.organization_id and g.user_id=a.user_id
    where a.organization_id=p_org and a.work_role='SUPERVISOR' and a.active
      and a.disabled_at is null and g.active;
 end if;
 select count(*) into reserved_count from private.office_seat_reservations s
   where s.organization_id=p_org and s.requested_role=p_role and s.state='RESERVED';
 if active_count+reserved_count>=seat_limit then
   raise exception 'Office seat allowance exhausted' using errcode='23514';
 end if;
 insert into private.office_seat_reservations(action_id,organization_id,requested_role,actor_id,reason)
 values(p_action,p_org,p_role,auth.uid(),btrim(p_reason));
 return p_action;
end;
$$;
revoke all on function public.owner_reserve_office_seat(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.owner_reserve_office_seat(uuid,uuid,text,text,text) to authenticated,service_role;
