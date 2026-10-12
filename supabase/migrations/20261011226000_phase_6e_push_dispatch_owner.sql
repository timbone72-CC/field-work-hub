-- Phase 6E trusted worker only: bounded issue evaluation and delivery lease.
-- Not activated by this migration. A separate verified cron/VAPID/worker gate
-- must explicitly enable private.admin_push_runtime.worker_ready.
alter table private.admin_alert_issues add column version_at timestamptz
 not null default clock_timestamp();
alter table private.admin_notification_outbox add column worker_id uuid;
alter table private.admin_notification_outbox add constraint admin_push_lease_pair_chk
 check((worker_id is null and lease_until is null)
    or (worker_id is not null and lease_until is not null));
create or replace function private.admin_alert_sync_fact(p_wo uuid,p_run uuid,
 p_type text,p_discriminator text,p_version text)
returns uuid language plpgsql security definer set search_path='' as $fact$
declare w public.work_orders%rowtype; key text; rev text; issue uuid;
begin
 select * into w from public.work_orders where id=p_wo;
 if w.id is null then raise exception 'Missing alert work fact' using errcode='42501';end if;
 key:=encode(sha256(convert_to(w.organization_id::text||':'||p_wo::text||':'||
   p_type||':'||p_discriminator,'UTF8')),'hex');
 rev:=encode(sha256(convert_to(coalesce(p_version,'')||':'||p_type,'UTF8')),'hex');
 insert into private.admin_alert_issues(
  organization_id,work_order_id,run_id,alert_type,issue_key,version_key)
 values(w.organization_id,p_wo,p_run,p_type,key,rev)
 on conflict(organization_id,issue_key) do update set
  run_id=excluded.run_id,version_at=case
   when private.admin_alert_issues.version_key is distinct from excluded.version_key
     or private.admin_alert_issues.resolved_at is not null
   then clock_timestamp() else private.admin_alert_issues.version_at end,
  version_key=excluded.version_key,
  resolved_at=null,last_at=clock_timestamp() returning id into issue;
 return issue;
end;$fact$;

-- A trusted service evaluator may derive job facts without impersonating a
-- human session. User-facing mutation still requires private.can_work_order.
create or replace function private.admin_alert_reconcile_wo(p_wo uuid,p_org uuid)
returns void language plpgsql security definer set search_path='' as $reconcile$
declare w public.work_orders%rowtype; run public.work_order_runs%rowtype;
 assignment public.work_order_assignments%rowtype;
 org_timezone text; active_keys text[]:='{}'; k uuid;
 pending_photos int;received_photos int;pack_status text;
 package_row record; is_ready boolean;
begin
 if p_org is null or p_wo is null or
   (auth.role() is distinct from 'service_role' and not private.can_work_order(p_wo))
 then raise exception 'Current scoped alert work required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo and organization_id=p_org;
 if w.id is null then raise exception 'Work outside alert organization' using errcode='42501';end if;
 select * into run from public.work_order_runs where id=w.current_run_id;
 select * into assignment from public.work_order_assignments
  where run_id=w.current_run_id and assignment_ended_at is null
  order by assignment_started_at desc limit 1;
 select timezone into org_timezone from private.admin_alert_organization_config
  where organization_id=p_org;
 if w.field_status='ASSIGNED' and assignment.id is not null
  and assignment.acknowledgment_received_at is null then
   k:=private.admin_alert_sync_fact(w.id,run.id,'ASSIGNMENT_NEEDS_ACCEPT',
      assignment.id::text,assignment.id::text);
   active_keys:=array_append(active_keys,k::text);
   k:=private.admin_alert_sync_fact(w.id,run.id,'ACCEPT_REMINDER',
      assignment.id::text,assignment.assignment_started_at::text);
   active_keys:=array_append(active_keys,k::text);
 end if;
 if org_timezone is not null and w.field_status in ('ASSIGNED','IN_PROGRESS')
   and (clock_timestamp() at time zone org_timezone)::date>w.due_date then
   k:=private.admin_alert_sync_fact(w.id,run.id,'OVERDUE',run.id::text,
      w.due_date::text||':'||org_timezone);
   active_keys:=array_append(active_keys,k::text);
 end if;
 if w.field_status='FIELD_COMPLETE' and run.field_completed_at is not null then
   select count(*) into pending_photos from public.photos ph where ph.run_id=run.id;
   select count(*) into received_photos from private.photo_transfers t
     join private.photo_transfer_receipts receipt on receipt.photo_id=t.photo_id
       and receipt.transfer_version=t.version
     where t.run_id=run.id and t.state='RECEIVED';
   select status into pack_status from private.client_packages p
     where p.run_id=run.id order by created_at desc limit 1;
   is_ready:=pending_photos=received_photos and
     coalesce(pack_status,'DRAFT')='DRAFT';
   if is_ready then
     k:=private.admin_alert_sync_fact(w.id,run.id,
       case when run.run_sequence>1 then 'FOLLOWUP_READY_FOR_REVIEW'
         else 'READY_FOR_REVIEW' end,run.id::text,
       run.field_completed_at::text||':'||received_photos::text);
     active_keys:=array_append(active_keys,k::text);
   end if;
 end if;
 -- Upload and unknown offline sync states do NOT become incidents without
 -- a trusted persistent heartbeat or explicit accepted failure report.
 if exists(select 1 from private.client_packages p
  where p.work_order_id=w.id and p.status in ('FAILED','UNCERTAIN')) then
   k:=private.admin_alert_sync_fact(w.id,run.id,'DELIVERY_PROBLEM',run.id::text,
      'FAILED_OR_UNCERTAIN');
   active_keys:=array_append(active_keys,k::text);
 end if;
 for package_row in select p.id,p.run_id,p.approved_sha256
  from private.client_packages p
  join private.client_delivery_final_receipts r on r.package_id=p.id
  where p.work_order_id=w.id and p.status='DELIVERED'
 loop
   k:=private.admin_alert_sync_fact(w.id,package_row.run_id,
     'CLIENT_DELIVERED',package_row.id::text,package_row.approved_sha256);
   active_keys:=array_append(active_keys,k::text);
 end loop;
 update private.admin_alert_issues i set resolved_at=clock_timestamp()
 where i.work_order_id=w.id and i.organization_id=p_org and i.resolved_at is null
   and not (i.id::text=any(active_keys))
   and i.alert_type<>'APP_OR_SYNC_PROBLEM';
end;$reconcile$;

-- Current authorization for a trusted worker, never a passed JWT/user role.
create function private.service_admin_alert_user_scope(p_user uuid,p_wo uuid)
returns boolean language sql stable security definer set search_path='' as $scope$
 select exists(
  select 1 from public.work_orders w
   join private.account_work_access access on access.organization_id=w.organization_id
     and access.user_id=p_user and access.active and access.disabled_at is null
     and access.suspension_authority is null and access.work_role in ('ADMIN','SUPERVISOR')
   join auth.users u on u.id=p_user and u.deleted_at is null
     and u.email_confirmed_at is not null
     and (u.banned_until is null or u.banned_until<=now())
     and u.raw_app_meta_data->>'organization_id'=w.organization_id::text
     and u.raw_app_meta_data->>'role'=access.work_role
   join public.admin_teams t on t.id=w.responsible_team_id and t.active
   where w.id=p_wo and (
     (access.work_role='ADMIN' and exists(
        select 1 from private.admin_team_memberships m
        where m.user_id=p_user and m.organization_id=w.organization_id
          and m.team_id=t.id and m.active))
     or (access.work_role='SUPERVISOR'
       and exists(select 1 from private.org_work_settings setting
         where setting.organization_id=w.organization_id and setting.supervisor_work_ready)
       and exists(select 1 from private.supervisor_grants g
        where g.user_id=p_user and g.organization_id=w.organization_id
          and g.active and (g.tier=3 or exists(
             select 1 from private.supervisor_team_scopes scope
               where scope.user_id=p_user and scope.organization_id=w.organization_id
                 and scope.team_id=t.id))))
   ))
$$;
revoke all on function private.service_admin_alert_user_scope(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_admin_alert_user_scope(uuid,uuid) to service_role;

-- One periodic call processes at most 50 WOs after an explicit cursor,
-- then queues only issues first observed/changed AFTER device enrollment.
create function private.service_prepare_admin_push(p_after uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $prepare$
declare w record; next_cursor uuid; processed int:=0; produced int:=0;
begin
 if auth.role() is distinct from 'service_role' or p_limit not between 1 and 50
 then raise exception 'Trusted bounded evaluator required' using errcode='42501';end if;
 for w in select x.id,x.organization_id from public.work_orders x
   where p_after is null or x.id>p_after order by x.id limit p_limit
 loop
   next_cursor:=w.id;processed:=processed+1;
   perform private.admin_alert_reconcile_wo(w.id,w.organization_id);
 end loop;
 insert into private.admin_notification_outbox(issue_id,user_id,organization_id,
   device_id,version_key)
 select distinct issue.id,sub.user_id,issue.organization_id,sub.device_id,issue.version_key
 from private.admin_alert_issues issue
 join private.admin_push_subscriptions sub
  on sub.organization_id=issue.organization_id and sub.enabled
    and sub.created_at<=issue.version_at
 join private.admin_push_runtime runtime
  on runtime.organization_id=issue.organization_id and runtime.worker_ready
    and runtime.operator_verified
 left join private.admin_alert_settings pref
  on pref.organization_id=sub.organization_id and pref.user_id=sub.user_id
   and pref.alert_type=issue.alert_type
 left join private.admin_alert_receipts rec
  on rec.issue_id=issue.id and rec.user_id=sub.user_id
 where issue.resolved_at is null
   and issue.id in (select active.id from private.admin_alert_issues active
    join public.work_orders wo on wo.id=active.work_order_id
    where (p_after is null or wo.id>p_after)
       and (next_cursor is null or wo.id<=next_cursor))
   and case sub.device_class when 'PHONE' then coalesce(pref.phone_enabled,false)
     else coalesce(pref.computer_enabled,false) end
   and (rec.issue_id is null or rec.version_key<>issue.version_key
     or (rec.acknowledged_at is null and
       (rec.snoozed_until is null or rec.snoozed_until<=clock_timestamp())))
   and (issue.alert_type<>'ACCEPT_REMINDER' or exists(
     select 1 from public.work_order_assignments assign
     where assign.run_id=issue.run_id and assign.assignment_ended_at is null
       and assign.acknowledgment_received_at is null
       and assign.assignment_started_at<=clock_timestamp()-
          make_interval(mins=>coalesce(pref.reminder_minutes,1440))))
   and private.service_admin_alert_user_scope(sub.user_id,issue.work_order_id)
 on conflict(issue_id,user_id,device_id,version_key) do nothing;
 get diagnostics produced=row_count;
 return jsonb_build_object('processed_work_orders',processed,'new_jobs',produced,
    'next_cursor',case when processed=p_limit then next_cursor else null end);
end;$prepare$;
create function public.service_prepare_admin_push(p_after uuid,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$
 select private.service_prepare_admin_push(p_after,p_limit)
$$;
revoke all on function private.service_prepare_admin_push(uuid,integer),
 public.service_prepare_admin_push(uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function private.service_prepare_admin_push(uuid,integer),
 public.service_prepare_admin_push(uuid,integer) to service_role;

-- Claim one exact (user,device,issue version) only after current scope,
-- quiet hours and snooze have been rechecked at send time.
create function private.service_claim_admin_push(p_worker uuid)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $claim$
declare job private.admin_notification_outbox%rowtype;
 sub private.admin_push_subscriptions%rowtype;
 issue private.admin_alert_issues%rowtype;
 settings private.admin_alert_settings%rowtype; rec private.admin_alert_receipts%rowtype;
 local_time time; quiet boolean; pushready boolean;
begin
 if auth.role() is distinct from 'service_role' or p_worker is null
 then raise exception 'Trusted worker required' using errcode='42501';end if;
 for job in select * from private.admin_notification_outbox o
  where o.state in ('QUEUED','FAILED')
    and o.next_attempt_at<=clock_timestamp()
    and o.attempts<5
  order by o.next_attempt_at,o.id limit 40 for update skip locked
 loop
  select * into sub from private.admin_push_subscriptions s
    where s.user_id=job.user_id and s.organization_id=job.organization_id
      and s.device_id=job.device_id;
  select * into issue from private.admin_alert_issues i where i.id=job.issue_id;
  select * into settings from private.admin_alert_settings p
    where p.user_id=job.user_id and p.organization_id=job.organization_id
      and p.alert_type=issue.alert_type;
  select * into rec from private.admin_alert_receipts r
    where r.issue_id=issue.id and r.user_id=job.user_id;
  select coalesce(r.worker_ready and r.operator_verified,false) into pushready
    from private.admin_push_runtime r where r.organization_id=job.organization_id;
  if not coalesce(pushready,false) or sub.enabled is distinct from true
    or issue.resolved_at is not null or issue.version_key is distinct from job.version_key
    or not private.service_admin_alert_user_scope(job.user_id,issue.work_order_id)
    or (case sub.device_class when 'PHONE'
       then coalesce(settings.phone_enabled,false)
       else coalesce(settings.computer_enabled,false) end) is false
    or (rec.version_key=issue.version_key and
       (rec.acknowledged_at is not null or rec.snoozed_until>clock_timestamp()))
  then
   update private.admin_notification_outbox set state='CANCELLED',
      changed_at=clock_timestamp() where id=job.id;
   continue;
  end if;
  if settings.quiet_timezone is not null then
   local_time:=(clock_timestamp() at time zone settings.quiet_timezone)::time;
   quiet:=case when settings.quiet_start<settings.quiet_end then
    local_time>=settings.quiet_start and local_time<settings.quiet_end
    else local_time>=settings.quiet_start or local_time<settings.quiet_end end;
   if quiet then continue;end if;
  end if;
  update private.admin_notification_outbox set state='LEASED',worker_id=p_worker,
    lease_generation=lease_generation+1,attempts=attempts+1,
    lease_until=clock_timestamp()+interval '2 minutes',
    changed_at=clock_timestamp()
  where id=job.id returning * into job;
  return jsonb_build_object('job_id',job.id,'worker_id',p_worker,
    'generation',job.lease_generation,'issue_id',issue.id,
    'endpoint',sub.endpoint,'p256dh',sub.p256dh,'auth',sub.auth_secret,
    'alert_id',issue.id,'device_id',sub.device_id,'device_class',sub.device_class,
    'vapid_public_key',(select runtime.vapid_public_key from private.admin_push_runtime runtime
       where runtime.organization_id=job.organization_id));
 end loop;
 return jsonb_build_object('claimed',false);
end;$claim$;
create function public.service_claim_admin_push(p_worker uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.service_claim_admin_push(p_worker)
$$;

create function private.service_finish_admin_push(
 p_job uuid,p_worker uuid,p_generation bigint,p_http_status integer
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $finish$
declare job private.admin_notification_outbox%rowtype;result text;
begin
 if auth.role() is distinct from 'service_role'
   or p_job is null or p_worker is null
   or p_http_status not between 100 and 599
 then raise exception 'Trusted provider result required' using errcode='42501';end if;
 select * into job from private.admin_notification_outbox where id=p_job for update;
 if job.id is null or job.state<>'LEASED' or job.worker_id<>p_worker
   or job.lease_generation<>p_generation or job.lease_until<=clock_timestamp()
 then raise exception 'Stale push lease; reconcile without blind success'
  using errcode='40001';end if;
 result:=case
   when p_http_status in (200,201,202) then 'PUSH_ACCEPTED_BY_SERVICE'
   when p_http_status in (404,410) then 'EXPIRED'
   when p_http_status in (429,500,502,503,504) and job.attempts<5 then 'FAILED'
   else 'EXPIRED' end;
 update private.admin_notification_outbox set state=result,
   worker_id=null,lease_until=null,last_http_status=p_http_status,
   next_attempt_at=case when result='FAILED'
     then clock_timestamp()+make_interval(mins=>least(240,5*job.attempts*job.attempts))
     else next_attempt_at end,changed_at=clock_timestamp()
 where id=job.id;
 if p_http_status in (404,410) then
   update private.admin_push_subscriptions set enabled=false,
     revoked_at=clock_timestamp(),updated_at=clock_timestamp(),
     revision=gen_random_uuid()
   where user_id=job.user_id and device_id=job.device_id
     and organization_id=job.organization_id;
 end if;
 return jsonb_build_object('job_id',job.id,'state',result);
end;$finish$;
create function public.service_finish_admin_push(
 p_job uuid,p_worker uuid,p_generation bigint,p_http_status integer)
returns jsonb language sql security invoker set search_path='' as $$
 select private.service_finish_admin_push(p_job,p_worker,p_generation,p_http_status)
$$;
revoke all on function private.service_claim_admin_push(uuid),
 public.service_claim_admin_push(uuid),
 private.service_finish_admin_push(uuid,uuid,bigint,integer),
 public.service_finish_admin_push(uuid,uuid,bigint,integer)
 from public,anon,authenticated,service_role;
grant execute on function private.service_claim_admin_push(uuid),
 public.service_claim_admin_push(uuid),
 private.service_finish_admin_push(uuid,uuid,bigint,integer),
 public.service_finish_admin_push(uuid,uuid,bigint,integer)
 to service_role;
