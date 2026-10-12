-- Phase 6E: evaluated only from accepted server facts; browser refresh is a
-- bounded reconciliation, never proof that a phone is offline/failed.
-- No historical backlog is enqueued for Web Push by these read owners.
create function private.admin_alert_sync_fact(p_wo uuid,p_run uuid,p_type text,
 p_discriminator text,p_version text)
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
  run_id=excluded.run_id,version_key=excluded.version_key,
  resolved_at=null,last_at=clock_timestamp() returning id into issue;
 return issue;
end;$fact$;
revoke all on function private.admin_alert_sync_fact(uuid,uuid,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_alert_sync_fact(uuid,uuid,text,text,text) to service_role;

-- Reconcile one selected authorized job, all issue types against current
-- persisted truth, without silently inventing app/network failure.
create function private.admin_alert_reconcile_wo(p_wo uuid,p_org uuid)
returns void language plpgsql security definer set search_path='' as $reconcile$
declare w public.work_orders%rowtype; run public.work_order_runs%rowtype;
 assignment public.work_order_assignments%rowtype;
 org_timezone text; active_keys text[]:='{}'; k uuid;
 pending_photos int;received_photos int;pack_status text;
 package_row record; matching text; is_ready boolean;
begin
 if p_org is null or p_wo is null or not private.can_work_order(p_wo)
 then raise exception 'Current scoped alert work required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo and organization_id=p_org;
 if w.id is null then raise exception 'Work outside alert organization' using errcode='42501';end if;
 select * into run from public.work_order_runs where id=w.current_run_id;
 select * into assignment from public.work_order_assignments
  where run_id=w.current_run_id and assignment_ended_at is null
  order by assignment_started_at desc limit 1;
 select timezone into org_timezone from private.admin_alert_organization_config
  where organization_id=p_org;
 -- Materialized issue rows always reference the current run and immutable
 -- assignment ID. No fabricated human acceptance from download/Start.
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
   select count(*) into pending_photos from public.photos ph
      where ph.run_id=run.id;
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
 -- Do not invent "No recent upload progress": the private transfer
 -- ledger currently has WAITING/RECEIVED only, with no authoritative
 -- persisted upload heartbeat. UPLOAD_PROBLEM will be enabled only after a
 -- server-known STARTED/last-progress fact is available.
 if exists(select 1 from private.client_packages p
   where p.work_order_id=w.id and p.status in ('FAILED','UNCERTAIN')) then
   k:=private.admin_alert_sync_fact(w.id,run.id,'DELIVERY_PROBLEM',run.id::text,
      'FAILED_OR_UNCERTAIN');
   active_keys:=array_append(active_keys,k::text);
 end if;
 -- Earlier confirmed deliveries stay informational facts, each package has
 -- its own immutable event key and never changes earlier provider receipts.
 for package_row in select p.id,p.run_id,p.approved_sha256,r.confirmed_at
  from private.client_packages p
  join private.client_delivery_final_receipts r on r.package_id=p.id
  where p.work_order_id=w.id and p.status='DELIVERED'
 loop
   k:=private.admin_alert_sync_fact(w.id,package_row.run_id,'CLIENT_DELIVERED',
     package_row.id::text,package_row.approved_sha256);
   active_keys:=array_append(active_keys,k::text);
 end loop;
 -- Keep acknowledged informational receipts in history; resolving an issue
 -- must never erase its original incident/delivery truth.
 update private.admin_alert_issues i set resolved_at=clock_timestamp()
 where i.work_order_id=w.id and i.organization_id=p_org and i.resolved_at is null
   and not (i.id::text=any(active_keys))
   and i.alert_type<>'APP_OR_SYNC_PROBLEM';
end;$reconcile$;
revoke all on function private.admin_alert_reconcile_wo(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.admin_alert_reconcile_wo(uuid,uuid) to service_role;

-- Scoped worklist is evaluated once per visible bounded page; informational
-- delivery events from before this feature are dashboard history, not a push
-- enrollment backlog. Page counts are not falsely called global.
create function private.admin_alert_list(p_limit integer default 25,
 p_after_created timestamptz default null,p_after_issue uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $list$
declare org uuid; rowrecord record; alerts jsonb; more boolean;
begin
 if p_limit not in (25,50) or
  ((p_after_created is null) is distinct from (p_after_issue is null)) then
   raise exception 'Bounded alert page cursor required' using errcode='22023';end if;
 org:=private.admin_alert_current_org();
 for rowrecord in select w.id from public.work_orders w
   where w.organization_id=org and private.can_work_order(w.id)
   order by w.updated_at desc,w.id desc limit 50
 loop
   perform private.admin_alert_reconcile_wo(rowrecord.id,org);
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',i.id,'type',i.alert_type,'work_order_id',i.work_order_id,
   'run_id',i.run_id,'first_at',i.first_at,'last_at',i.last_at,
   'version_key',i.version_key,
   'acknowledged',coalesce(rec.acknowledged_at is not null and
      rec.version_key=i.version_key,false),
   'snoozed_until',case when rec.version_key=i.version_key
     then rec.snoozed_until else null end,
   'current',i.resolved_at is null)
   order by i.first_at desc,i.id desc)
     filter(where i.id is not null),'[]'::jsonb) into alerts
 from (select i.* from private.admin_alert_issues i
   join public.work_orders w on w.id=i.work_order_id
   where i.organization_id=org and private.can_work_order(i.work_order_id)
     and (p_after_created is null or i.first_at<p_after_created or
       (i.first_at=p_after_created and i.id<p_after_issue))
   order by i.first_at desc,i.id desc limit p_limit) i
 left join private.admin_alert_receipts rec on rec.issue_id=i.id
   and rec.user_id=auth.uid() and rec.organization_id=org
 left join private.admin_alert_settings prefs on prefs.user_id=auth.uid()
   and prefs.organization_id=org and prefs.alert_type=i.alert_type
 where coalesce(prefs.dashboard_enabled,true)
   and i.resolved_at is null
   and (i.alert_type<>'ACCEPT_REMINDER' or exists(
     select 1 from public.work_order_assignments assign
     where assign.run_id=i.run_id and assign.assignment_ended_at is null
       and assign.acknowledgment_received_at is null
       and assign.assignment_started_at<=clock_timestamp()-
         make_interval(mins=>coalesce(prefs.reminder_minutes,1440))))
   and not (i.alert_type='CLIENT_DELIVERED'
     and rec.acknowledged_at is not null and rec.version_key=i.version_key);
 select exists(select 1 from private.admin_alert_issues i
  where i.organization_id=org and private.can_work_order(i.work_order_id)
    and (p_after_created is null or i.first_at<p_after_created or
      (i.first_at=p_after_created and i.id<p_after_issue)))
 into more;
 return jsonb_build_object('organization_id',org,'alerts',alerts,
   'bounded_evaluation_jobs',50,'has_more_unverified',false,
   'evaluation_scope','MOST_RECENT_50_SCOPED_WORK_ORDERS',
   'next_cursor',case when jsonb_array_length(alerts)=p_limit then
       jsonb_build_object('at',alerts->(p_limit-1)->>'first_at',
       'issue_id',alerts->(p_limit-1)->>'id') else null end);
end;$list$;
create function public.admin_alert_list(p_limit integer default 25,
 p_after_created timestamptz default null,p_after_issue uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_alert_list(p_limit,p_after_created,p_after_issue)
$$;
revoke all on function private.admin_alert_list(integer,timestamptz,uuid),
 public.admin_alert_list(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function private.admin_alert_list(integer,timestamptz,uuid),
 public.admin_alert_list(integer,timestamptz,uuid) to authenticated,service_role;
