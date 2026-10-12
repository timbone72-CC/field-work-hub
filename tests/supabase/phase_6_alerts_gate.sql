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
 if has_table_privilege('authenticated','private.admin_push_subscriptions','SELECT')
  or has_table_privilege('authenticated','private.admin_alert_issues','UPDATE')
  or has_function_privilege('anon',
   'public.admin_notification_settings()','EXECUTE')
 then raise exception 'Private alert credential/data authority leaked';end if;
 raise notice '6E default channels, pending ACK, delayed reminder, preferences CAS, snooze, isolation and endpoint protection PASS';
end;$phase6e$;
rollback;
