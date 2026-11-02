-- Phase 6F: an invited ADMIN activates only their own exact BOUND Auth
-- invitation, in its original team and reserved seat. No Auth user created here.
alter table private.scoped_admin_invitation_reservations
  drop constraint scoped_admin_invitation_state_valid;
alter table private.scoped_admin_invitation_reservations
  add constraint scoped_admin_invitation_state_valid
  check (state in ('RESERVED','ISSUING','BOUND','PROBLEM','RELEASED','CONSUMED'));
alter table private.scoped_admin_invitation_reservations
  add column activated_at timestamptz;
alter table private.scoped_admin_invitation_reservations
  drop constraint scoped_admin_invitation_lifecycle_valid;
alter table private.scoped_admin_invitation_reservations
  add constraint scoped_admin_invitation_lifecycle_valid check (
    (state='RESERVED' and issuing_at is null and bound_at is null
      and problem_at is null and released_at is null and activated_at is null
      and auth_user_id is null)
    or (state='ISSUING' and issuing_at is not null and bound_at is null
      and problem_at is null and released_at is null and activated_at is null
      and auth_user_id is null)
    or (state='BOUND' and issuing_at is not null and bound_at is not null
      and problem_at is null and released_at is null and activated_at is null
      and auth_user_id is not null)
    or (state='PROBLEM' and issuing_at is not null and bound_at is null
      and problem_at is not null and released_at is null and activated_at is null)
    or (state='RELEASED' and issuing_at is null and bound_at is null
      and problem_at is null and released_at is not null and activated_at is null
      and auth_user_id is null)
    or (state='CONSUMED' and issuing_at is not null and bound_at is not null
      and problem_at is null and released_at is null and activated_at is not null
      and auth_user_id is not null)
  );
-- Historical consumed actions cannot be invited again. Active Auth UUID/email
-- authority is checked before any new seat reservation.
create function public.complete_scoped_admin_invitation_activation()
returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $activate$
declare
  inv private.scoped_admin_invitation_reservations%rowtype;
  seat private.office_seat_reservations%rowtype;
  existing private.account_work_access%rowtype;
begin
  if not private.current_identity_valid() then
    raise exception 'Verified current invitation session required' using errcode='42501';
  end if;
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() then
    raise exception 'Current Auth session changed' using errcode='42501';
  end if;
  select * into inv from private.scoped_admin_invitation_reservations i
    where i.auth_user_id=auth.uid() for update;
  if not found or inv.state not in ('BOUND','CONSUMED') then
    raise exception 'Exact accepted Admin invitation required' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users u
    where u.id=auth.uid() and u.deleted_at is null
      and u.email_confirmed_at is not null
      and lower(btrim(u.email))=inv.invite_email
      and u.raw_app_meta_data->>'organization_id'=inv.organization_id::text
      and u.raw_app_meta_data->>'role'='ADMIN'
      and u.raw_user_meta_data->>'scoped_admin_invitation_id'=inv.action_id::text)
  then raise exception 'Current verified Admin identity mismatched invitation'
    using errcode='42501';end if;
  if inv.state='CONSUMED' then
    -- A historical idempotent retry NEVER re-enables disabled work.
    return jsonb_build_object('status',
      case when exists(select 1 from private.account_work_access a
        where a.organization_id=inv.organization_id and a.user_id=auth.uid()
          and a.work_role='ADMIN' and a.active and a.disabled_at is null
          and a.suspension_authority is null)
        then 'ALREADY_ACTIVATED' else 'WORK_DISABLED' end,
      'action_id',inv.action_id);
  end if;
  select * into seat from private.office_seat_reservations
    where action_id=inv.action_id and organization_id=inv.organization_id for update;
  if not found or seat.requested_role<>'ADMIN'
    or seat.state<>'RESERVED' or seat.actor_id<>inv.actor_id then
    raise exception 'Exact reserved Admin seat unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.admin_teams t
    where t.organization_id=inv.organization_id and t.id=inv.team_id and t.active) then
    raise exception 'Invited team no longer active' using errcode='42501';
  end if;
  if not (
    exists(select 1 from private.platform_owner_capabilities c
      join auth.users u on u.id=c.user_id where c.user_id=inv.actor_id
      and c.active and c.environment=inv.environment
      and u.deleted_at is null and u.email_confirmed_at is not null)
    or private.team_capability_for_user(
      inv.actor_id,inv.organization_id,inv.team_id,'MANAGE_ADMIN')
  ) then raise exception 'Original inviter no longer authorized'
    using errcode='42501';end if;
  if exists(select 1 from private.account_work_access a
    where a.user_id=auth.uid()) then
    raise exception 'Invited identity already holds a work account'
      using errcode='42501';
  end if;
  insert into private.account_work_access(
    organization_id,user_id,work_role,active)
  values(inv.organization_id,auth.uid(),'ADMIN',true);
  insert into private.admin_team_memberships(
    organization_id,team_id,user_id,active)
  values(inv.organization_id,inv.team_id,auth.uid(),true);
  update private.office_seat_reservations set state='CONSUMED'
    where action_id=inv.action_id and state='RESERVED';
  if not found then
    raise exception 'Reserved office seat changed during activation'
      using errcode='40001';end if;
  update private.scoped_admin_invitation_reservations
    set state='CONSUMED',activated_at=clock_timestamp()
    where action_id=inv.action_id and state='BOUND';
  if not found then
    raise exception 'Auth invitation changed during activation'
      using errcode='40001';end if;
  return jsonb_build_object('status','ACCEPTED','action_id',inv.action_id,
    'organization_id',inv.organization_id,'team_id',inv.team_id);
end;
$activate$;
revoke all on function public.complete_scoped_admin_invitation_activation()
  from public,anon;
grant execute on function public.complete_scoped_admin_invitation_activation()
  to authenticated,service_role;
