-- Phase 6E provider activation is a separate trusted infrastructure gate.
-- No public RPC can set this READY, install a private signing key or enroll
-- a device for another authenticated user.
create table private.admin_push_runtime(
 organization_id uuid primary key references public.organizations(id) on delete restrict,
 vapid_public_key text not null
   check(vapid_public_key~'^[A-Za-z0-9_-]{86,90}$'),
 operator_verified boolean not null default false,
 worker_ready boolean not null default false,
 verified_at timestamptz,changed_at timestamptz not null default clock_timestamp(),
 check(not (worker_ready and operator_verified) or verified_at is not null)
);
alter table private.admin_push_runtime enable row level security;
revoke all on private.admin_push_runtime from public,anon,authenticated,service_role;
grant select on private.admin_push_runtime to service_role;

create or replace function private.admin_notification_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $settings$
declare org uuid; prefs jsonb; devices jsonb; zone text; zone_revision uuid;
 pubkey text; ready boolean:=false;
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
 select timezone,revision into zone,zone_revision
   from private.admin_alert_organization_config where organization_id=org;
 select r.vapid_public_key,coalesce(r.operator_verified and r.worker_ready,false)
   into pubkey,ready from private.admin_push_runtime r where r.organization_id=org;
 return jsonb_build_object('organization_id',org,'types',prefs,
  'devices',devices,'organization_timezone',zone,
  'organization_timezone_revision',zone_revision,
  'push_ready',coalesce(ready,false),
  'vapid_public_key',case when ready then pubkey else null end);
end;$settings$;
-- The existing public security-invoker wrapper remains unchanged.
