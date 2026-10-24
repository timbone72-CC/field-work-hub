-- Phase 6E disposable native PostgreSQL; never contacts live push providers.
begin;
do $phase6e$
declare org uuid:='00000000-0000-0000-0000-000000000001';
 office uuid:='00000000-0000-0000-0000-000000000010';
 worker uuid:='00000000-0000-0000-0000-000000000011';
 w uuid; current_run uuid; act uuid; settings jsonb; saved jsonb;
 feed jsonb; issue_id uuid; receipt jsonb; denied boolean;
 cfg jsonb; token text;
begin
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
   'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 token:=jsonb_build_object('sub',office,'session_id',office,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text;
 perform set_config('request.jwt.claims',token,true);execute 'set local role authenticated';
 settings:=public.admin_notification_settings();
 if jsonb_array_length(settings->'types')<>9
   or settings->>'push_ready'<>'false'
   or exists(select 1 from jsonb_array_elements(settings->'types') x
      where x.value->>'dashboard'<>'true'
        or x.value->>'phone'<>'false'
        or x.value->>'computer'<>'false')
 then raise exception '9 default per-user dashboard On and push Off options missing';end if;
 select (v->>'work_order_id')::uuid into w from
    public.admin_create_work_order_v4(false,'ALERT-'||gen_random_uuid(),
      'Synthetic Alert Work Address','CHECK','',current_date,worker,cfg) v;
 select current_run_id into current_run from public.work_orders where id=w;
 feed:=public.admin_alert_list(25,null,null);
 select (x.value->>'id')::uuid into issue_id
   from jsonb_array_elements(feed->'alerts') x
   where x.value->>'work_order_id'=w::text
    and x.value->>'type'='ASSIGNMENT_NEEDS_ACCEPT' limit 1;
 if issue_id is null then raise exception 'New, unacknowledged assignment lacks alert';end if;
 if exists(select 1 from jsonb_array_elements(feed->'alerts') a
     where a.value->>'work_order_id'=w::text and a.value->>'type'='ACCEPT_REMINDER')
 then raise exception '24 hour reminder fired immediately without delay';end if;
 act:=gen_random_uuid();
 saved:=public.admin_set_notification_preferences(act,'ASSIGNMENT_NEEDS_ACCEPT',
    null,false,false,false,1440,null,null,null);
 if saved->>'dashboard'<>'false'
    or public.admin_set_notification_preferences(act,'ASSIGNMENT_NEEDS_ACCEPT',
      null,false,false,false,1440,null,null,null) is distinct from saved
 then raise exception 'Preference idempotency or channel Off invalid';end if;
 feed:=public.admin_alert_list(25,null,null);
 if exists(select 1 from jsonb_array_elements(feed->'alerts') a
   where a.value->>'id'=issue_id::text)
 then raise exception 'Disabled dashboard channel still interrupts list';end if;
 saved:=public.admin_set_notification_preferences(gen_random_uuid(),
    'ASSIGNMENT_NEEDS_ACCEPT',(saved->>'revision')::uuid,true,false,false,
    1440,'America/Chicago','21:00','07:00');
 if saved->>'dashboard'<>'true' then raise exception 'Quiet-hour preference failed';end if;
 feed:=public.admin_alert_list(25,null,null);
 if not exists(select 1 from jsonb_array_elements(feed->'alerts') a
   where a.value->>'id'=issue_id::text)
 then raise exception 'Reenabled current issue disappeared';end if;
 receipt:=public.admin_alert_receipt_action(gen_random_uuid(),issue_id,
   null,'SNOOZE',clock_timestamp()+interval '4 hours');
 if receipt->>'mode'<>'SNOOZE' then raise exception 'Snooze receipt unavailable';end if;
 receipt:=public.admin_alert_receipt_action(gen_random_uuid(),issue_id,
   (receipt->>'revision')::uuid,'ACKNOWLEDGE',null);
 if receipt->>'acknowledged'<>'true'
 then raise exception 'Read receipt not confirmed';end if;
 feed:=public.admin_alert_list(25,null,null);
 if not exists(select 1 from jsonb_array_elements(feed->'alerts') a
   where a.value->>'id'=issue_id::text
     and a.value->>'current'='true' and a.value->>'acknowledged'='true')
 then raise exception 'Acknowledgment falsely resolved active server work problem';end if;
 denied:=false;
 begin perform public.admin_set_notification_preferences(gen_random_uuid(),
   'ASSIGNMENT_NEEDS_ACCEPT',null,false,true,true,1440,null,null,null);
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale settings CAS permitted mutation';end if;
 denied:=false;
 begin perform public.admin_enroll_push(gen_random_uuid(),gen_random_uuid(),
   'PHONE','https://127.0.0.1/private',repeat('A',65),repeat('B',22),null);
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Private endpoint SSRF enrollment allowed';end if;
 denied:=false;
 begin perform public.admin_enroll_push(gen_random_uuid(),gen_random_uuid(),
   'PHONE','http://fcm.googleapis.com/fcm/send/xyz',repeat('A',65),repeat('B',22),null);
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Insecure endpoint enrollment allowed';end if;
 -- A normal office session has no direct subscription or raw endpoint
 -- table permission; verifying table emptiness occurs after RESET ROLE.
 execute 'reset role';
 if exists(select 1 from private.admin_push_subscriptions where user_id=office)
   or exists(select 1 from private.admin_notification_outbox where user_id=office)
 then raise exception 'Dashboard automatically enrolled or queued push';end if;
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub',worker,'session_id',worker,'app_metadata',jsonb_build_object(
     'role','CONTRACTOR','organization_id',org))::text,true);
 execute 'set local role authenticated';
 denied:=false;
 begin perform public.admin_notification_settings();
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor read office preferences';end if;
 denied:=false;
 begin perform public.admin_alert_receipt_action(gen_random_uuid(),issue_id,null,
   'ACKNOWLEDGE',null);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor marked office issue read';end if;
 execute 'reset role';
 -- The worker has no subscription to send to by default; deliberately
 -- unconfigured push runtime cannot produce or claim outgoing notifications.
 perform set_config('request.jwt.claims',
   jsonb_build_object('role','service_role')::text,true);
 execute 'set local role service_role';
 if not private.service_admin_alert_user_scope(office,w)
    or private.service_admin_alert_user_scope(worker,w)
 then raise exception 'Trusted scope evaluator allowed contractor or denied Admin';end if;
 saved:=public.service_prepare_admin_push(null,50);
 if (saved->>'processed_work_orders')::int<1
    or (saved->>'new_jobs')::int<>0
 then raise exception 'Unactivated push runtime enqueued work';end if;
 saved:=public.service_claim_admin_push(gen_random_uuid());
 if saved->>'claimed'<>'false' then
   raise exception 'No valid trusted enrollment produced a push claim';end if;
 execute 'reset role';
 if has_table_privilege('authenticated','private.admin_push_subscriptions','SELECT')
  or has_table_privilege('authenticated','private.admin_alert_issues','UPDATE')
  or has_function_privilege('anon',
   'public.admin_notification_settings()','EXECUTE')
 then raise exception 'Private alert credential/data authority leaked';end if;
 raise notice '6E default channels, pending ACK, delayed reminder, preferences CAS, snooze, isolation and endpoint protection PASS';
end;$phase6e$;

-- Separate disposable trusted worker gate; source-only, never HTTP push.
do $push_worker_gate$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 admin_id uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011';
 wo uuid; run uuid; instance uuid; action uuid; device uuid:=gen_random_uuid();
 pref jsonb; enrollment jsonb; claim jsonb; finished jsonb; prepared jsonb;
 adminjwt text;workerjwt text;
begin
 adminjwt:=jsonb_build_object('sub',admin_id,'session_id',admin_id,
  'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text;
 workerjwt:=jsonb_build_object('sub',contractor,'session_id',contractor,
  'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text;
 perform set_config('request.jwt.claims',adminjwt,true);
 execute 'set local role authenticated';
 pref:=public.admin_notification_settings();
 select (x.value->>'revision')::uuid into action
   from jsonb_array_elements(pref->'types') x
   where x.value->>'type'='ASSIGNMENT_NEEDS_ACCEPT';
 pref:=public.admin_set_notification_preferences(gen_random_uuid(),
   'ASSIGNMENT_NEEDS_ACCEPT',action,true,true,false,1440,null,null,null);
 enrollment:=public.admin_enroll_push(gen_random_uuid(),device,'PHONE',
   'https://fcm.googleapis.com/fcm/send/synthetic-only',
   repeat('A',87),repeat('B',22),null);
 if enrollment->>'enabled'<>'true' then raise exception 'Explicit Push enrollment failed';end if;
 execute 'reset role';
 insert into private.admin_push_runtime(
   organization_id,vapid_public_key,operator_verified,worker_ready,verified_at)
 values(org,repeat('C',87),true,true,clock_timestamp());
 perform set_config('request.jwt.claims',adminjwt,true);
 execute 'set local role authenticated';
 select (x->>'work_order_id')::uuid into wo
  from public.admin_create_work_order_v4(false,'PUSH-DISPOSABLE-'||gen_random_uuid(),
   'Synthetic push job','CHECK','',current_date,contractor,
   jsonb_build_object('schema',1,'revision',gen_random_uuid(),
    'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb)) x;
 execute 'reset role';
 select current_run_id into run from public.work_orders where id=wo;
 select id into instance from public.work_order_assignments where run_id=run
   and assignment_ended_at is null;
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 execute 'set local role service_role';
 prepared:=public.service_prepare_admin_push(null,50);
 if (prepared->>'new_jobs')::int<1 then
   raise exception 'New opt-in event not enqueued by trusted bounded scanner: %',prepared;end if;
 claim:=public.service_claim_admin_push(gen_random_uuid());
 if claim->>'alert_id' is null or claim->>'vapid_public_key'<>repeat('C',87)
   or claim->>'endpoint' not like 'https://fcm.googleapis.com/%' then
   raise exception 'Trusted claim lost exact endpoint/VAPID or scope: %',claim;end if;
 finished:=public.service_finish_admin_push((claim->>'job_id')::uuid,
  (claim->>'worker_id')::uuid,(claim->>'generation')::bigint,202);
 if finished->>'state'<>'PUSH_ACCEPTED_BY_SERVICE'
  or (select state from private.admin_notification_outbox
    where id=(claim->>'job_id')::uuid)<>'PUSH_ACCEPTED_BY_SERVICE'
 then raise exception 'Push service accepted receipt became OS/human success';end if;
 -- Repeated dispatch cannot claim the exact accepted issue version.
 if exists(select 1 from private.admin_notification_outbox outbox
   where outbox.id=(claim->>'job_id')::uuid and outbox.state='QUEUED')
 then raise exception 'Accepted push was silently requeued';end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',workerjwt,true);
 execute 'set local role authenticated';
 -- Worker can verify only its own assignment projection; no direct
 -- work_order_assignments table access is granted.
 if exists(select 1 from public.field_assignments() a
    where a->>'id'=wo::text
      and a->>'acknowledgment_received_at' is not null)
 then raise exception 'Push send invented contractor human Accept';end if;
 execute 'reset role';
 if has_function_privilege('authenticated','public.service_claim_admin_push(uuid)','EXECUTE')
  or has_function_privilege('anon','public.service_prepare_admin_push(uuid,integer)','EXECUTE')
  or has_table_privilege('authenticated','private.admin_notification_outbox','SELECT')
 then raise exception 'Trusted push outbox was exposed to a browser';end if;
 raise notice '6E explicitly enrolled fake Push, exact service-only claim, provider receipt only and no invented ACK PASS';
end;$push_worker_gate$;
rollback;
