-- Phase 6E per-user alert receipts and opt-in subscription enrollment.
-- The subscription endpoint and keys never leave the private table.
create function private.admin_configure_alert_timezone(
 p_action uuid,p_expected_revision uuid,p_timezone text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $tz$
declare org uuid; record private.admin_alert_organization_config%rowtype;
 prior private.admin_alert_actions%rowtype; result jsonb; fp text; fresh uuid;
begin
 if p_action is null or p_timezone is null or
  not exists(select 1 from pg_catalog.pg_timezone_names z
    where z.name=p_timezone and z.name like '%/%')
 then raise exception 'Explicit organization IANA timezone required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();org:=private.admin_alert_current_org();
 -- Org timezone is an organization setting; ordinary Admin has only own
 -- scoped work. Require an explicit org-wide approved Supervisor tier 3
 -- or an Admin whose membership covers every active org team.
 if not (
   private.current_work_role(org)='SUPERVISOR'
   and exists(select 1 from private.supervisor_grants g
     where g.user_id=auth.uid() and g.organization_id=org and g.active and g.tier=3)
 ) and exists(select 1 from public.admin_teams t where t.organization_id=org
   and t.active and not private.has_team_capability(org,t.id,'WORK'))
 then raise exception 'Organization-wide timezone authority required' using errcode='42501';end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(p_expected_revision,p_timezone)::text,'UTF8')),'hex');
 select * into prior from private.admin_alert_actions where action_id=p_action;
 if prior.action_id is not null then
   if row(prior.user_id,prior.organization_id,prior.operation,prior.request_sha256)
    is distinct from row(auth.uid(),org,'ORG_TIMEZONE',fp)
    then raise exception 'Changed timezone action replay' using errcode='40001';end if;
   return prior.result;end if;
 select * into record from private.admin_alert_organization_config
   where organization_id=org for update;
 if record.revision is distinct from p_expected_revision
 then raise exception 'Organization timezone changed; reload' using errcode='40001';end if;
 fresh:=gen_random_uuid();
 insert into private.admin_alert_organization_config(organization_id,timezone,revision)
 values(org,p_timezone,fresh)
 on conflict(organization_id) do update set timezone=excluded.timezone,
   revision=excluded.revision,changed_at=clock_timestamp();
 result:=jsonb_build_object('organization_id',org,'timezone',p_timezone,'revision',fresh);
 insert into private.admin_alert_actions(action_id,user_id,organization_id,operation,request_sha256,result)
 values(p_action,auth.uid(),org,'ORG_TIMEZONE',fp,result);
 return result;
end;$tz$;
create function public.admin_configure_alert_timezone(p_action uuid,
 p_expected_revision uuid,p_timezone text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_configure_alert_timezone(p_action,p_expected_revision,p_timezone)
$$;

create function private.admin_alert_receipt_action(
 p_action uuid,p_issue uuid,p_expected_revision uuid,
 p_mode text,p_snoozed_until timestamptz
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $receipt$
declare org uuid; issue private.admin_alert_issues%rowtype;
 old private.admin_alert_receipts%rowtype; prior private.admin_alert_actions%rowtype;
 fp text; result jsonb; next_revision uuid:=gen_random_uuid();
begin
 if p_action is null or p_issue is null
  or p_mode not in ('ACKNOWLEDGE','SNOOZE') or
  (p_mode='SNOOZE' and (p_snoozed_until is null
    or p_snoozed_until<=clock_timestamp()
    or p_snoozed_until>clock_timestamp()+interval '30 days'))
  or (p_mode='ACKNOWLEDGE' and p_snoozed_until is not null)
 then raise exception 'Exact acknowledgment or bounded snooze required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();org:=private.admin_alert_current_org();
 select * into issue from private.admin_alert_issues where id=p_issue
   and organization_id=org;
 if issue.id is null or not private.can_work_order(issue.work_order_id)
 then raise exception 'Current scoped alert required' using errcode='42501';end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(
    p_issue,p_expected_revision,p_mode,p_snoozed_until)::text,'UTF8')),'hex');
 select * into prior from private.admin_alert_actions where action_id=p_action;
 if prior.action_id is not null then
   if row(prior.user_id,prior.organization_id,prior.operation,prior.request_sha256)
      is distinct from row(auth.uid(),org,'ALERT_'||p_mode,fp)
    then raise exception 'Changed alert receipt replay' using errcode='40001';end if;
   return prior.result;
 end if;
 select * into old from private.admin_alert_receipts
    where user_id=auth.uid() and issue_id=p_issue for update;
 if old.revision is distinct from p_expected_revision
 then raise exception 'Alert receipt revision changed; reload' using errcode='40001';end if;
 insert into private.admin_alert_receipts(user_id,organization_id,issue_id,
   version_key,acknowledged_at,snoozed_until,revision)
 values(auth.uid(),org,p_issue,issue.version_key,
   case when p_mode='ACKNOWLEDGE' then clock_timestamp() end,
   case when p_mode='SNOOZE' then p_snoozed_until end,next_revision)
 on conflict(user_id,issue_id) do update set
   version_key=excluded.version_key,
   acknowledged_at=excluded.acknowledged_at,
   snoozed_until=excluded.snoozed_until,revision=excluded.revision;
 result:=jsonb_build_object('issue_id',p_issue,'revision',next_revision,
   'version_key',issue.version_key,'mode',p_mode,
   'acknowledged',p_mode='ACKNOWLEDGE','snoozed_until',p_snoozed_until);
 insert into private.admin_alert_actions(action_id,user_id,organization_id,
   operation,request_sha256,result)
 values(p_action,auth.uid(),org,'ALERT_'||p_mode,fp,result);
 return result;
end;$receipt$;
create function public.admin_alert_receipt_action(p_action uuid,p_issue uuid,
 p_expected_revision uuid,p_mode text,p_snoozed_until timestamptz)
 returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_alert_receipt_action(p_action,p_issue,
   p_expected_revision,p_mode,p_snoozed_until)
$$;

-- Explicitly restrict web-push URLs to public HTTPS domains controlled by
-- supported browser push providers. This is not a generic URL-fetch proxy.
create function private.valid_admin_push_endpoint(p_endpoint text)
returns boolean language plpgsql immutable set search_path='' as $url$
declare hostname text;
begin
 if p_endpoint is null or length(p_endpoint) not between 20 and 2048
   or p_endpoint !~ '^https://[A-Za-z0-9.-]+(:443)?/[A-Za-z0-9_/?&=%.+~-]+$'
   or p_endpoint~*'(localhost|127[.]|169[.]254[.]|[.]local|@|#|\\)'
 then return false;end if;
 hostname:=lower(substring(p_endpoint from '^https://([^/:]+)'));
 return hostname in ('fcm.googleapis.com','updates.push.services.mozilla.com',
   'updates-autopush.stage.mozaws.net')
   or hostname like '%.notify.windows.com'
   or hostname like '%.push.apple.com';
end;$url$;
revoke all on function private.valid_admin_push_endpoint(text) from public,anon,authenticated,service_role;
grant execute on function private.valid_admin_push_endpoint(text) to service_role;

create function private.admin_enroll_push(
 p_action uuid,p_device uuid,p_class text,p_endpoint text,p_p256dh text,
 p_auth_secret text,p_expected_revision uuid
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $enroll$
declare org uuid; prior private.admin_alert_actions%rowtype;
 existing private.admin_push_subscriptions%rowtype;
 fp text;endpoint_hash text;new_revision uuid:=gen_random_uuid();result jsonb;
begin
 if p_action is null or p_device is null or p_class not in ('PHONE','COMPUTER')
    or not private.valid_admin_push_endpoint(p_endpoint)
    or length(coalesce(p_p256dh,'')) not between 40 and 300
    or translate(p_p256dh,'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-','')<>''
    or length(coalesce(p_auth_secret,'')) not between 10 and 200
    or translate(p_auth_secret,'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-','')<>''
 then raise exception 'Valid HTTPS browser push device/keys required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();org:=private.admin_alert_current_org();
 endpoint_hash:=encode(sha256(convert_to(p_endpoint,'UTF8')),'hex');
 fp:=encode(sha256(convert_to(jsonb_build_array(
   p_device,p_class,endpoint_hash,p_p256dh,p_auth_secret,p_expected_revision)::text,'UTF8')),'hex');
 select * into prior from private.admin_alert_actions where action_id=p_action;
 if prior.action_id is not null then
    if row(prior.user_id,prior.organization_id,prior.operation,prior.request_sha256)
      is distinct from row(auth.uid(),org,'ENROLL',fp)
    then raise exception 'Changed push enrollment replay' using errcode='40001';end if;
    return prior.result;end if;
 select * into existing from private.admin_push_subscriptions
   where user_id=auth.uid() and organization_id=org and device_id=p_device for update;
 if existing.revision is distinct from p_expected_revision
 then raise exception 'Push device changed; reload' using errcode='40001';end if;
 if exists(select 1 from private.admin_push_subscriptions s
   where s.endpoint_fingerprint=endpoint_hash and
     (s.organization_id<>org or s.user_id<>auth.uid() or s.device_id<>p_device))
 then raise exception 'Push endpoint already enrolled to another identity; revoke first'
    using errcode='40001';end if;
 insert into private.admin_push_subscriptions(user_id,organization_id,device_id,
   device_class,endpoint,p256dh,auth_secret,endpoint_fingerprint,revision)
 values(auth.uid(),org,p_device,p_class,p_endpoint,p_p256dh,p_auth_secret,
   endpoint_hash,new_revision)
 on conflict(user_id,organization_id,device_id) do update set
  device_class=excluded.device_class,endpoint=excluded.endpoint,
  p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,
  endpoint_fingerprint=excluded.endpoint_fingerprint,enabled=true,revoked_at=null,
  updated_at=clock_timestamp(),revision=excluded.revision;
 result:=jsonb_build_object('device_id',p_device,'device_class',p_class,
   'enabled',true,'revision',new_revision);
 insert into private.admin_alert_actions(action_id,user_id,organization_id,operation,
   request_sha256,result) values(p_action,auth.uid(),org,'ENROLL',fp,result);
 return result;
end;$enroll$;
create function public.admin_enroll_push(
 p_action uuid,p_device uuid,p_class text,p_endpoint text,p_p256dh text,
 p_auth_secret text,p_expected_revision uuid
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_enroll_push(p_action,p_device,p_class,p_endpoint,
   p_p256dh,p_auth_secret,p_expected_revision)
$$;

create function private.admin_disable_push(p_action uuid,p_device uuid,
 p_expected_revision uuid)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $disable$
declare org uuid; sub private.admin_push_subscriptions%rowtype;
 prior private.admin_alert_actions%rowtype;fp text;result jsonb;next_revision uuid:=gen_random_uuid();
begin
 if p_action is null or p_device is null then raise exception 'Exact device required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();org:=private.admin_alert_current_org();
 fp:=encode(sha256(convert_to(jsonb_build_array(p_device,p_expected_revision)::text,'UTF8')),'hex');
 select * into prior from private.admin_alert_actions where action_id=p_action;
 if prior.action_id is not null then
   if row(prior.user_id,prior.organization_id,prior.operation,prior.request_sha256)
     is distinct from row(auth.uid(),org,'DISABLE_PUSH',fp)
   then raise exception 'Changed disable replay' using errcode='40001';end if;
   return prior.result;end if;
 select * into sub from private.admin_push_subscriptions
  where user_id=auth.uid() and organization_id=org and device_id=p_device for update;
 if sub.device_id is null or sub.revision is distinct from p_expected_revision
 then raise exception 'Push device unavailable or changed' using errcode='40001';end if;
 update private.admin_push_subscriptions set enabled=false,
   revoked_at=clock_timestamp(),revision=next_revision,
   updated_at=clock_timestamp()
 where user_id=auth.uid() and organization_id=org and device_id=p_device;
 update private.admin_notification_outbox set state='CANCELLED',changed_at=clock_timestamp()
 where user_id=auth.uid() and organization_id=org and device_id=p_device
   and state='QUEUED';
 result:=jsonb_build_object('device_id',p_device,'enabled',false,'revision',next_revision);
 insert into private.admin_alert_actions(action_id,user_id,organization_id,
   operation,request_sha256,result) values(p_action,auth.uid(),org,'DISABLE_PUSH',fp,result);
 return result;
end;$disable$;
create function public.admin_disable_push(p_action uuid,p_device uuid,
 p_expected_revision uuid)
 returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_disable_push(p_action,p_device,p_expected_revision)
$$;
revoke all on function private.admin_configure_alert_timezone(uuid,uuid,text),
 public.admin_configure_alert_timezone(uuid,uuid,text),
 private.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 public.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 private.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 public.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 private.admin_disable_push(uuid,uuid,uuid),
 public.admin_disable_push(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_configure_alert_timezone(uuid,uuid,text),
 public.admin_configure_alert_timezone(uuid,uuid,text),
 private.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 public.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 private.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 public.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 private.admin_disable_push(uuid,uuid,uuid),
 public.admin_disable_push(uuid,uuid,uuid)
 to authenticated,service_role;

    or length(coalesce(p_auth_secret,'')) not between 10 and 200
    or p_auth_secret !~ '^[A-Za-z0-9_-]+
 then raise exception 'Valid HTTPS browser push device/keys required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();org:=private.admin_alert_current_org();
 endpoint_hash:=encode(sha256(convert_to(p_endpoint,'UTF8')),'hex');
 fp:=encode(sha256(convert_to(jsonb_build_array(
   p_device,p_class,endpoint_hash,p_p256dh,p_auth_secret,p_expected_revision)::text,'UTF8')),'hex');
 select * into prior from private.admin_alert_actions where action_id=p_action;
 if prior.action_id is not null then
    if row(prior.user_id,prior.organization_id,prior.operation,prior.request_sha256)
      is distinct from row(auth.uid(),org,'ENROLL',fp)
    then raise exception 'Changed push enrollment replay' using errcode='40001';end if;
    return prior.result;end if;
 select * into existing from private.admin_push_subscriptions
   where user_id=auth.uid() and organization_id=org and device_id=p_device for update;
 if existing.revision is distinct from p_expected_revision
 then raise exception 'Push device changed; reload' using errcode='40001';end if;
 if exists(select 1 from private.admin_push_subscriptions s
   where s.endpoint_fingerprint=endpoint_hash and
     (s.organization_id<>org or s.user_id<>auth.uid() or s.device_id<>p_device))
 then raise exception 'Push endpoint already enrolled to another identity; revoke first'
    using errcode='40001';end if;
 insert into private.admin_push_subscriptions(user_id,organization_id,device_id,
   device_class,endpoint,p256dh,auth_secret,endpoint_fingerprint,revision)
 values(auth.uid(),org,p_device,p_class,p_endpoint,p_p256dh,p_auth_secret,
   endpoint_hash,new_revision)
 on conflict(user_id,organization_id,device_id) do update set
  device_class=excluded.device_class,endpoint=excluded.endpoint,
  p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,
  endpoint_fingerprint=excluded.endpoint_fingerprint,enabled=true,revoked_at=null,
  updated_at=clock_timestamp(),revision=excluded.revision;
 result:=jsonb_build_object('device_id',p_device,'device_class',p_class,
   'enabled',true,'revision',new_revision);
 insert into private.admin_alert_actions(action_id,user_id,organization_id,operation,
   request_sha256,result) values(p_action,auth.uid(),org,'ENROLL',fp,result);
 return result;
end;$enroll$;
create function public.admin_enroll_push(
 p_action uuid,p_device uuid,p_class text,p_endpoint text,p_p256dh text,
 p_auth_secret text,p_expected_revision uuid
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_enroll_push(p_action,p_device,p_class,p_endpoint,
   p_p256dh,p_auth_secret,p_expected_revision)
$$;

create function private.admin_disable_push(p_action uuid,p_device uuid,
 p_expected_revision uuid)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $disable$
declare org uuid; sub private.admin_push_subscriptions%rowtype;
 prior private.admin_alert_actions%rowtype;fp text;result jsonb;next_revision uuid:=gen_random_uuid();
begin
 if p_action is null or p_device is null then raise exception 'Exact device required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();org:=private.admin_alert_current_org();
 fp:=encode(sha256(convert_to(jsonb_build_array(p_device,p_expected_revision)::text,'UTF8')),'hex');
 select * into prior from private.admin_alert_actions where action_id=p_action;
 if prior.action_id is not null then
   if row(prior.user_id,prior.organization_id,prior.operation,prior.request_sha256)
     is distinct from row(auth.uid(),org,'DISABLE_PUSH',fp)
   then raise exception 'Changed disable replay' using errcode='40001';end if;
   return prior.result;end if;
 select * into sub from private.admin_push_subscriptions
  where user_id=auth.uid() and organization_id=org and device_id=p_device for update;
 if sub.device_id is null or sub.revision is distinct from p_expected_revision
 then raise exception 'Push device unavailable or changed' using errcode='40001';end if;
 update private.admin_push_subscriptions set enabled=false,
   revoked_at=clock_timestamp(),revision=next_revision,
   updated_at=clock_timestamp()
 where user_id=auth.uid() and organization_id=org and device_id=p_device;
 update private.admin_notification_outbox set state='CANCELLED',changed_at=clock_timestamp()
 where user_id=auth.uid() and organization_id=org and device_id=p_device
   and state='QUEUED';
 result:=jsonb_build_object('device_id',p_device,'enabled',false,'revision',next_revision);
 insert into private.admin_alert_actions(action_id,user_id,organization_id,
   operation,request_sha256,result) values(p_action,auth.uid(),org,'DISABLE_PUSH',fp,result);
 return result;
end;$disable$;
create function public.admin_disable_push(p_action uuid,p_device uuid,
 p_expected_revision uuid)
 returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_disable_push(p_action,p_device,p_expected_revision)
$$;
revoke all on function private.admin_configure_alert_timezone(uuid,uuid,text),
 public.admin_configure_alert_timezone(uuid,uuid,text),
 private.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 public.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 private.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 public.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 private.admin_disable_push(uuid,uuid,uuid),
 public.admin_disable_push(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_configure_alert_timezone(uuid,uuid,text),
 public.admin_configure_alert_timezone(uuid,uuid,text),
 private.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 public.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 private.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 public.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 private.admin_disable_push(uuid,uuid,uuid),
 public.admin_disable_push(uuid,uuid,uuid)
 to authenticated,service_role;

 then raise exception 'Valid HTTPS browser push device/keys required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();org:=private.admin_alert_current_org();
 endpoint_hash:=encode(sha256(convert_to(p_endpoint,'UTF8')),'hex');
 fp:=encode(sha256(convert_to(jsonb_build_array(
   p_device,p_class,endpoint_hash,p_p256dh,p_auth_secret,p_expected_revision)::text,'UTF8')),'hex');
 select * into prior from private.admin_alert_actions where action_id=p_action;
 if prior.action_id is not null then
    if row(prior.user_id,prior.organization_id,prior.operation,prior.request_sha256)
      is distinct from row(auth.uid(),org,'ENROLL',fp)
    then raise exception 'Changed push enrollment replay' using errcode='40001';end if;
    return prior.result;end if;
 select * into existing from private.admin_push_subscriptions
   where user_id=auth.uid() and organization_id=org and device_id=p_device for update;
 if existing.revision is distinct from p_expected_revision
 then raise exception 'Push device changed; reload' using errcode='40001';end if;
 if exists(select 1 from private.admin_push_subscriptions s
   where s.endpoint_fingerprint=endpoint_hash and
     (s.organization_id<>org or s.user_id<>auth.uid() or s.device_id<>p_device))
 then raise exception 'Push endpoint already enrolled to another identity; revoke first'
    using errcode='40001';end if;
 insert into private.admin_push_subscriptions(user_id,organization_id,device_id,
   device_class,endpoint,p256dh,auth_secret,endpoint_fingerprint,revision)
 values(auth.uid(),org,p_device,p_class,p_endpoint,p_p256dh,p_auth_secret,
   endpoint_hash,new_revision)
 on conflict(user_id,organization_id,device_id) do update set
  device_class=excluded.device_class,endpoint=excluded.endpoint,
  p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,
  endpoint_fingerprint=excluded.endpoint_fingerprint,enabled=true,revoked_at=null,
  updated_at=clock_timestamp(),revision=excluded.revision;
 result:=jsonb_build_object('device_id',p_device,'device_class',p_class,
   'enabled',true,'revision',new_revision);
 insert into private.admin_alert_actions(action_id,user_id,organization_id,operation,
   request_sha256,result) values(p_action,auth.uid(),org,'ENROLL',fp,result);
 return result;
end;$enroll$;
create function public.admin_enroll_push(
 p_action uuid,p_device uuid,p_class text,p_endpoint text,p_p256dh text,
 p_auth_secret text,p_expected_revision uuid
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_enroll_push(p_action,p_device,p_class,p_endpoint,
   p_p256dh,p_auth_secret,p_expected_revision)
$$;

create function private.admin_disable_push(p_action uuid,p_device uuid,
 p_expected_revision uuid)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $disable$
declare org uuid; sub private.admin_push_subscriptions%rowtype;
 prior private.admin_alert_actions%rowtype;fp text;result jsonb;next_revision uuid:=gen_random_uuid();
begin
 if p_action is null or p_device is null then raise exception 'Exact device required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();org:=private.admin_alert_current_org();
 fp:=encode(sha256(convert_to(jsonb_build_array(p_device,p_expected_revision)::text,'UTF8')),'hex');
 select * into prior from private.admin_alert_actions where action_id=p_action;
 if prior.action_id is not null then
   if row(prior.user_id,prior.organization_id,prior.operation,prior.request_sha256)
     is distinct from row(auth.uid(),org,'DISABLE_PUSH',fp)
   then raise exception 'Changed disable replay' using errcode='40001';end if;
   return prior.result;end if;
 select * into sub from private.admin_push_subscriptions
  where user_id=auth.uid() and organization_id=org and device_id=p_device for update;
 if sub.device_id is null or sub.revision is distinct from p_expected_revision
 then raise exception 'Push device unavailable or changed' using errcode='40001';end if;
 update private.admin_push_subscriptions set enabled=false,
   revoked_at=clock_timestamp(),revision=next_revision,
   updated_at=clock_timestamp()
 where user_id=auth.uid() and organization_id=org and device_id=p_device;
 update private.admin_notification_outbox set state='CANCELLED',changed_at=clock_timestamp()
 where user_id=auth.uid() and organization_id=org and device_id=p_device
   and state='QUEUED';
 result:=jsonb_build_object('device_id',p_device,'enabled',false,'revision',next_revision);
 insert into private.admin_alert_actions(action_id,user_id,organization_id,
   operation,request_sha256,result) values(p_action,auth.uid(),org,'DISABLE_PUSH',fp,result);
 return result;
end;$disable$;
create function public.admin_disable_push(p_action uuid,p_device uuid,
 p_expected_revision uuid)
 returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_disable_push(p_action,p_device,p_expected_revision)
$$;
revoke all on function private.admin_configure_alert_timezone(uuid,uuid,text),
 public.admin_configure_alert_timezone(uuid,uuid,text),
 private.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 public.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 private.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 public.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 private.admin_disable_push(uuid,uuid,uuid),
 public.admin_disable_push(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_configure_alert_timezone(uuid,uuid,text),
 public.admin_configure_alert_timezone(uuid,uuid,text),
 private.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 public.admin_alert_receipt_action(uuid,uuid,uuid,text,timestamptz),
 private.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 public.admin_enroll_push(uuid,uuid,text,text,text,text,uuid),
 private.admin_disable_push(uuid,uuid,uuid),
 public.admin_disable_push(uuid,uuid,uuid)
 to authenticated,service_role;
