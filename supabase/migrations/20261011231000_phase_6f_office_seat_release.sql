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
