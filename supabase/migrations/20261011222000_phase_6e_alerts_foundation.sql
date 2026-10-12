-- Approved Phase 6E: private, current-authority-scoped optional office alerts.
-- Source only; no subscriptions or scheduled dispatch activate in hosted Team.
-- One issue/evidence owner; no second job, photo or provider state.
create table private.admin_alert_settings(
 user_id uuid not null references auth.users(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 alert_type text not null check(alert_type in (
  'READY_FOR_REVIEW','FOLLOWUP_READY_FOR_REVIEW','ASSIGNMENT_NEEDS_ACCEPT',
  'ACCEPT_REMINDER','OVERDUE','UPLOAD_PROBLEM','APP_OR_SYNC_PROBLEM',
  'DELIVERY_PROBLEM','CLIENT_DELIVERED')),
 dashboard_enabled boolean not null default true,
 phone_enabled boolean not null default false,
 computer_enabled boolean not null default false,
 reminder_minutes integer not null default 1440 check(reminder_minutes between 1 and 40320),
 quiet_timezone text,quiet_start time,quiet_end time,
 revision uuid not null default gen_random_uuid(),
 changed_at timestamptz not null default clock_timestamp(),
 primary key(user_id,organization_id,alert_type),
 check((quiet_timezone is null and quiet_start is null and quiet_end is null)
    or (quiet_timezone is not null and quiet_start is not null and quiet_end is not null)),
 check(quiet_start is distinct from quiet_end or quiet_start is null)
);
create table private.admin_alert_organization_config(
 organization_id uuid primary key references public.organizations(id) on delete restrict,
 timezone text not null,revision uuid not null default gen_random_uuid(),
 changed_at timestamptz not null default clock_timestamp()
);
create table private.admin_alert_issues(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 run_id uuid references public.work_order_runs(id) on delete restrict,
 alert_type text not null,
 issue_key text not null check(issue_key~'^[a-f0-9]{64}$'),
 version_key text not null check(version_key~'^[a-f0-9]{64}$'),
 first_at timestamptz not null default clock_timestamp(),
 last_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 unique(organization_id,issue_key)
);
create index admin_alert_issues_work_idx on private.admin_alert_issues(work_order_id,alert_type,resolved_at);
create table private.admin_alert_receipts(
 user_id uuid not null references auth.users(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 issue_id uuid not null references private.admin_alert_issues(id) on delete restrict,
 version_key text not null,
 acknowledged_at timestamptz,snoozed_until timestamptz,
 revision uuid not null default gen_random_uuid(),
 primary key(user_id,issue_id)
);
create table private.admin_push_subscriptions(
 user_id uuid not null references auth.users(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 device_id uuid not null,
 device_class text not null check(device_class in ('PHONE','COMPUTER')),
 endpoint text not null check(length(endpoint) between 20 and 2048),
 p256dh text not null check(length(p256dh) between 40 and 300),
 auth_secret text not null check(length(auth_secret) between 10 and 200),
 endpoint_fingerprint text not null check(endpoint_fingerprint~'^[a-f0-9]{64}$'),
 enabled boolean not null default true,
 revoked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 revision uuid not null default gen_random_uuid(),
 primary key(user_id,organization_id,device_id),
 unique(endpoint_fingerprint),
 check((enabled and revoked_at is null) or not enabled)
);
create table private.admin_notification_outbox(
 id uuid primary key default gen_random_uuid(),
 issue_id uuid not null references private.admin_alert_issues(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 device_id uuid not null,
 version_key text not null,
 state text not null default 'QUEUED' check(state in (
   'QUEUED','LEASED','PUSH_ACCEPTED_BY_SERVICE','FAILED','EXPIRED','CANCELLED')),
 attempts integer not null default 0 check(attempts between 0 and 20),
 next_attempt_at timestamptz not null default clock_timestamp(),
 lease_generation bigint not null default 0,
 lease_until timestamptz,
 last_http_status integer,
 changed_at timestamptz not null default clock_timestamp(),
 unique(issue_id,user_id,device_id,version_key),
 foreign key(user_id,organization_id,device_id)
   references private.admin_push_subscriptions(user_id,organization_id,device_id)
   on delete restrict
);
create table private.admin_alert_actions(
 action_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 operation text not null,
 request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 result jsonb not null,
 recorded_at timestamptz not null default clock_timestamp()
);
do $lockdown$
declare name text;
begin
 foreach name in array array[
 'admin_alert_settings','admin_alert_organization_config','admin_alert_issues',
 'admin_alert_receipts','admin_push_subscriptions','admin_notification_outbox',
 'admin_alert_actions'] loop
 execute format('alter table private.%I enable row level security',name);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',name);
 execute format('grant select on private.%I to service_role',name);
 end loop;
end;$lockdown$;
create trigger admin_alert_actions_immutable before update or delete
  on private.admin_alert_actions for each row
  execute function private.protect_photo_transfer_ledger();

-- All frontend mutations derive org from current verified server work
-- entitlement; a caller cannot choose arbitrary org/team or device owner.
create function private.admin_alert_current_org() returns uuid
language plpgsql stable security definer set search_path='' as $org$
declare org uuid;
begin
 if not private.current_identity_valid() then
   raise exception 'Verified current work session required' using errcode='42501';end if;
 select a.organization_id into org from private.account_work_access a
   where a.user_id=auth.uid() and a.active and a.disabled_at is null
     and a.suspension_authority is null
     and a.work_role in ('ADMIN','SUPERVISOR')
     and private.current_work_role(a.organization_id) in ('ADMIN','SUPERVISOR')
   order by a.organization_id limit 1;
 if org is null or not exists(select 1 from public.admin_teams t
   where t.organization_id=org and private.has_team_capability(org,t.id,'WORK'))
 then raise exception 'Current scoped Admin or Supervisor required' using errcode='42501';end if;
 return org;
end;$org$;
revoke all on function private.admin_alert_current_org() from public,anon,authenticated,service_role;
grant execute on function private.admin_alert_current_org() to service_role;

create function private.admin_notification_types() returns text[]
language sql immutable set search_path='' as $$
 select array[
  'READY_FOR_REVIEW','FOLLOWUP_READY_FOR_REVIEW','ASSIGNMENT_NEEDS_ACCEPT',
  'ACCEPT_REMINDER','OVERDUE','UPLOAD_PROBLEM','APP_OR_SYNC_PROBLEM',
  'DELIVERY_PROBLEM','CLIENT_DELIVERED']::text[]
$$;
-- Settings read avoids returning any sensitive Push endpoint/auth key.
create function private.admin_notification_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $settings$
declare org uuid; prefs jsonb; devices jsonb; zone text;
begin
 org:=private.admin_alert_current_org();
 select coalesce(jsonb_agg(jsonb_build_object(
  'type',t.kind,'dashboard',coalesce(s.dashboard_enabled,true),
  'phone',coalesce(s.phone_enabled,false),
  'computer',coalesce(s.computer_enabled,false),
  'reminder_minutes',coalesce(s.reminder_minutes,1440),
  'quiet_timezone',s.quiet_timezone,
  'quiet_start',s.quiet_start,'quiet_end',s.quiet_end,
  'revision',s.revision) order by t.kind),'[]'::jsonb) into prefs
 from unnest(private.admin_notification_types()) t(kind)
 left join private.admin_alert_settings s on s.user_id=auth.uid()
  and s.organization_id=org and s.alert_type=t.kind;
 select coalesce(jsonb_agg(jsonb_build_object(
  'device_id',sub.device_id,'device_class',sub.device_class,
  'enabled',sub.enabled,'revision',sub.revision)
  order by sub.device_id),'[]'::jsonb) into devices
 from private.admin_push_subscriptions sub
 where sub.organization_id=org and sub.user_id=auth.uid();
 select timezone into zone from private.admin_alert_organization_config
 where organization_id=org;
 return jsonb_build_object('organization_id',org,'types',prefs,
  'devices',devices,'organization_timezone',zone,
  'push_ready',false);
end;$settings$;
create function public.admin_notification_settings()
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_notification_settings()
$$;
create function private.admin_set_notification_preferences(
 p_action uuid,p_type text,p_expected_revision uuid,p_dashboard boolean,
 p_phone boolean,p_computer boolean,p_reminder_minutes integer,
 p_quiet_timezone text,p_quiet_start time,p_quiet_end time
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $save$
declare org uuid; old private.admin_alert_settings%rowtype;
 prior private.admin_alert_actions%rowtype; fp text; result jsonb;
begin
 if p_action is null or p_type is null
   or not p_type=any(private.admin_notification_types())
   or p_dashboard is null or p_phone is null or p_computer is null
   or p_reminder_minutes not between 1 and 40320
   or ((p_quiet_timezone is null) is distinct from (p_quiet_start is null))
   or ((p_quiet_timezone is null) is distinct from (p_quiet_end is null))
   or (p_quiet_start is not null and p_quiet_start=p_quiet_end)
   or (p_quiet_timezone is not null and not exists(
     select 1 from pg_catalog.pg_timezone_names z
     where z.name=p_quiet_timezone and z.name like '%/%'))
 then raise exception 'Valid exact notification settings required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();
 org:=private.admin_alert_current_org();
 fp:=encode(sha256(convert_to(jsonb_build_array(p_type,p_expected_revision,
   p_dashboard,p_phone,p_computer,p_reminder_minutes,p_quiet_timezone,
   p_quiet_start,p_quiet_end)::text,'UTF8')),'hex');
 select * into prior from private.admin_alert_actions where action_id=p_action;
 if prior.action_id is not null then
   if row(prior.user_id,prior.organization_id,prior.operation,prior.request_sha256)
      is distinct from row(auth.uid(),org,'PREFERENCE',fp) then
     raise exception 'Changed notification action replay' using errcode='40001';end if;
   return prior.result;
 end if;
 select * into old from private.admin_alert_settings
   where user_id=auth.uid() and organization_id=org and alert_type=p_type for update;
 if old.revision is distinct from p_expected_revision
 then raise exception 'Notification settings changed; reload' using errcode='40001';end if;
 insert into private.admin_alert_settings(user_id,organization_id,alert_type,
   dashboard_enabled,phone_enabled,computer_enabled,reminder_minutes,
   quiet_timezone,quiet_start,quiet_end)
 values(auth.uid(),org,p_type,p_dashboard,p_phone,p_computer,p_reminder_minutes,
   p_quiet_timezone,p_quiet_start,p_quiet_end)
 on conflict(user_id,organization_id,alert_type) do update set
   dashboard_enabled=excluded.dashboard_enabled,phone_enabled=excluded.phone_enabled,
   computer_enabled=excluded.computer_enabled,reminder_minutes=excluded.reminder_minutes,
   quiet_timezone=excluded.quiet_timezone,quiet_start=excluded.quiet_start,
   quiet_end=excluded.quiet_end,revision=gen_random_uuid(),
   changed_at=clock_timestamp()
 returning revision into p_expected_revision;
 result:=jsonb_build_object('type',p_type,'revision',p_expected_revision,
   'dashboard',p_dashboard,'phone',p_phone,'computer',p_computer);
 insert into private.admin_alert_actions(action_id,user_id,organization_id,operation,
   request_sha256,result) values(p_action,auth.uid(),org,'PREFERENCE',fp,result);
 return result;
end;$save$;
create function public.admin_set_notification_preferences(
 p_action uuid,p_type text,p_expected_revision uuid,p_dashboard boolean,
 p_phone boolean,p_computer boolean,p_reminder_minutes integer,
 p_quiet_timezone text,p_quiet_start time,p_quiet_end time
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_set_notification_preferences(p_action,p_type,p_expected_revision,
  p_dashboard,p_phone,p_computer,p_reminder_minutes,
  p_quiet_timezone,p_quiet_start,p_quiet_end)
$$;
revoke all on function private.admin_notification_settings(),
 public.admin_notification_settings(),
 private.admin_set_notification_preferences(uuid,text,uuid,boolean,boolean,boolean,integer,text,time,time),
 public.admin_set_notification_preferences(uuid,text,uuid,boolean,boolean,boolean,integer,text,time,time)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_notification_settings(),
 public.admin_notification_settings(),
 private.admin_set_notification_preferences(uuid,text,uuid,boolean,boolean,boolean,integer,text,time,time),
 public.admin_set_notification_preferences(uuid,text,uuid,boolean,boolean,boolean,integer,text,time,time)
 to authenticated,service_role;
