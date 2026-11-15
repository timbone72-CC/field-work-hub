-- 6A-T01: read-only office projection. No new field state or release authority.
-- Public invoker wrapper; current session/team capability remains authoritative.
create function private.admin_work_order_facts(p_wo uuid,p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $facts$
declare
 w public.work_orders%rowtype; run public.work_order_runs%rowtype;
 k private.client_packages%rowtype; assignment public.work_order_assignments%rowtype;
 accepted boolean; pending_photos bigint; retained boolean; closed boolean;
 complete boolean:=false; problem boolean; delivery_problem boolean; following boolean;
 overdue boolean:=false; ready boolean:=false; approval boolean:=false;
 manifest jsonb; zone text; primary_state text; flags jsonb;
begin
 select * into w from public.work_orders where id=p_wo;
 select * into run from public.work_order_runs where id=w.current_run_id;
 select * into assignment from public.work_order_assignments
 where run_id=w.current_run_id and assigned_user_id=w.assigned_user_id
   and assignment_ended_at is null order by assignment_started_at desc,id limit 1;
 select * into k from private.client_packages where work_order_id=w.id
   and run_id=w.current_run_id and status<>'SUPERSEDED'
   order by created_at desc,id desc limit 1;
 select timezone into zone from private.admin_alert_organization_config
   where organization_id=w.organization_id;
 overdue:=coalesce(zone is not null and w.field_status in ('ASSIGNED','IN_PROGRESS')
   and (p_now at time zone zone)::date>w.due_date,false);
 accepted:=exists(select 1 from public.photo_finish_sets fs
   join public.field_actions a on a.finish_set_id=fs.id
   where fs.run_id=w.current_run_id and fs.work_order_id=w.id
    and fs.organization_id=w.organization_id and a.action_kind='COMPLETE'
    and a.accepted_at is not null and a.result->>'outcome' in ('APPLIED','ALREADY_APPLIED')
    and a.assignment_instance_id=fs.assignment_instance_id
    and a.requirement_revision is not distinct from fs.requirement_revision
    and a.finish_digest=fs.digest
    and a.actor_user_id=fs.actor_user_id and a.run_id=fs.run_id
    and a.work_order_id=fs.work_order_id and a.organization_id=fs.organization_id);
 -- Verify each accepted run's privately retained frozen evidence. Metadata,
 -- a receipt for an older content version, or a removed object is insufficient.
 select count(*) into pending_photos from (
   select ph.id::text as photo_id from public.photos ph
     join public.work_order_runs wr on wr.id=ph.run_id
     where ph.work_order_id=w.id and wr.field_status='FIELD_COMPLETE'
   union
   select image->>'id' from public.photo_finish_sets fs
     cross join lateral jsonb_array_elements(case when jsonb_typeof(fs.photos)='array'
       then fs.photos else '[]'::jsonb end) image
     where fs.work_order_id=w.id and exists(select 1 from public.field_actions a
       where a.finish_set_id=fs.id and a.run_id=fs.run_id and a.action_kind='COMPLETE'
         and a.result->>'outcome' in ('APPLIED','ALREADY_APPLIED') and a.accepted_at is not null)
 ) expected left join public.photos ph on ph.id::text=expected.photo_id
 where ph.id is null or not exists(select 1 from private.photo_transfers t
     join private.photo_transfer_receipts r on r.photo_id=t.photo_id
       and r.transfer_version=t.version and r.observed_sha256=t.prepared_sha256
       and r.observed_size=t.prepared_size and r.owner_user_id=t.captured_by
       and r.bucket=t.bucket and r.object_key=t.object_key
     join storage.objects ob on ob.id=r.object_id and ob.version=r.object_version
       and ob.bucket_id=r.bucket and ob.name=r.object_key
       and ob.owner_id=r.owner_user_id::text and ob.archived_at is null
       and not coalesce(ob.is_delete_marker,false)
     where t.photo_id=ph.id and t.run_id=ph.run_id and t.work_order_id=w.id
       and t.organization_id=w.organization_id and t.captured_by=ph.captured_by
       and t.finish_set_id=ph.finish_set_id and t.assignment_instance_id=ph.assignment_instance_id
       and t.state='RECEIVED' and private.photo_has_accepted_finish(ph.id));
 retained:=accepted and pending_photos=0;
 delivery_problem:=exists(select 1 from private.client_packages pkg
   left join private.client_delivery_outbox o on o.package_id=pkg.id
   where pkg.work_order_id=w.id and
     (pkg.status in ('FAILED','UNCERTAIN') or o.state in ('FAILED','UNCERTAIN')));
 following:=run.run_sequence>1 and w.field_status in ('ASSIGNED','IN_PROGRESS');
 problem:=w.pending_assignee_user_id is not null or delivery_problem
   or (w.field_status='FIELD_COMPLETE' and not accepted)
   or (w.field_status='CANCELLED' and exists(select 1 from private.correction_obligations
     where work_order_id=w.id and status='OPEN'))
   or exists(select 1 from private.admin_alert_issues i where i.work_order_id=w.id
     and i.resolved_at is null and i.alert_type in ('APP_OR_SYNC_PROBLEM','UPLOAD_PROBLEM'));
 -- Completion is current-run delivery plus exact immutable closure/retention
 -- of every accepted finished run, without an unresolved package/correction.
 closed:=k.status='DELIVERED' and exists(
   select 1 from private.client_delivery_final_receipts r
   join private.client_delivery_outbox o on o.package_id=r.package_id
   where r.package_id=k.id and o.state='DELIVERED'
     and r.approved_sha256=k.approved_sha256 and o.approved_sha256=k.approved_sha256
     and r.destination_id=k.destination_id and o.destination_id=k.destination_id)
   and not exists(select 1 from public.photo_finish_sets fs
     join public.field_actions a on a.finish_set_id=fs.id
     where fs.work_order_id=w.id and a.action_kind='COMPLETE'
       and a.accepted_at is not null and a.result->>'outcome' in ('APPLIED','ALREADY_APPLIED')
       and a.finish_digest=fs.digest
       and a.actor_user_id=fs.actor_user_id and a.run_id=fs.run_id
       and not exists(select 1 from private.client_package_runs c
          where c.package_id=k.id and c.run_id=fs.run_id
            and c.finish_set_id=fs.id and c.finish_digest=fs.digest));
 complete:=coalesce(w.field_status='FIELD_COMPLETE' and retained and closed and not problem
   and not exists(select 1 from private.correction_obligations where work_order_id=w.id and status='OPEN')
   and not exists(select 1 from private.client_packages where work_order_id=w.id
       and id<>k.id and (status in ('QUEUED','DELIVERING','FAILED','UNCERTAIN')
         or (created_at>k.created_at and status not in ('DELIVERED','SUPERSEDED')))),false);
 -- Reuse the existing manifest eligibility owner for unsent packages only.
 -- Historical receipts are never revalidated against today's mutable manifest.
 if retained and k.status in ('DRAFT','APPROVED') then
   begin
     manifest:=private.client_package_manifest(k.id);
     approval:=k.status='DRAFT';
     ready:=k.status='APPROVED'
       and k.approved_sha256=encode(sha256(convert_to(manifest::text,'UTF8')),'hex')
       and exists(select 1 from private.client_delivery_package_dispatch_config
         where singleton and enabled and legacy_worker_off_verified)
       and exists(select 1 from private.client_delivery_runtime
         where organization_id=w.organization_id and worker_ready);
   exception when others then
     -- A package-specific eligibility failure holds only its own queue state.
     approval:=false;ready:=false;
   end;
 end if;
 problem:=coalesce(problem,false) or (k.status='DELIVERED' and not complete)
   or (k.status='APPROVED' and not ready);
 problem:=coalesce(problem,false);
 flags:=jsonb_build_object(
   'ALL',true,'ACTIVE',w.field_status<>'CANCELLED' and not complete,
   'NEEDS_ASSIGNMENT',w.field_status='ASSIGNED' and w.assigned_user_id is null,
   'AWAITING_ACK',w.field_status='ASSIGNED' and w.assigned_user_id is not null
      and assignment.acknowledgment_received_at is null,
   'IN_PROGRESS',w.field_status='IN_PROGRESS','OVERDUE',overdue,
   'PHOTOS_PENDING',w.field_status='FIELD_COMPLETE' and accepted and not retained,
   'AWAITING_REVIEW',w.field_status='FIELD_COMPLETE' and retained and not complete
      and (k.id is null or k.status='DRAFT') and not approval,
   'FOLLOWUP_PENDING',coalesce(following,false),
   'READY_FOR_APPROVAL',approval,'READY_TO_SEND',ready,
   'SENDING',coalesce(k.status in ('QUEUED','DELIVERING'),false),
   'DELIVERY_PROBLEM',delivery_problem,'COMPLETED',complete,'PROBLEMS',problem,
   'CANCELLED',w.field_status='CANCELLED');
 primary_state:=case
   when delivery_problem then 'DELIVERY_PROBLEM' when problem then 'PROBLEMS'
   when w.field_status='CANCELLED' then 'CANCELLED' when complete then 'COMPLETED'
   when k.status in ('QUEUED','DELIVERING') then 'SENDING'
   when following then 'FOLLOWUP_PENDING'
   when w.field_status='ASSIGNED' and w.assigned_user_id is null then 'NEEDS_ASSIGNMENT'
   when w.field_status='ASSIGNED' and assignment.acknowledgment_received_at is null then 'AWAITING_ACK'
   when w.field_status='ASSIGNED' then 'ACCEPTED' when w.field_status='IN_PROGRESS' then 'IN_PROGRESS'
   when not retained then 'PHOTOS_PENDING' when ready then 'READY_TO_SEND'
   when approval then 'READY_FOR_APPROVAL' when k.status='DELIVERED' then 'PROBLEMS'
   else 'AWAITING_REVIEW' end;
 return jsonb_build_object('primary',primary_state,'queues',flags,'overdue',overdue,
   'timezone_configured',zone is not null,'private_photos_pending',pending_photos,
   'current_finish_accepted',accepted,'completed',complete,'review_required',w.review_required,
   'acknowledgment_received_at',assignment.acknowledgment_received_at);
end;$facts$;

create function private.admin_work_order_page(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $page$
declare
 org uuid; result jsonb; lim integer; off integer; queue text; sort_by text;
 field text; term text; company_term text; contractor uuid; company uuid; due date; status text;
 as_of timestamptz:=statement_timestamp(); scope text;
begin
 org:=private.admin_alert_current_org();
 if p_filters is null or jsonb_typeof(p_filters)<>'object' or exists(
   select 1 from jsonb_object_keys(p_filters) key where key not in
    ('size','offset','queue','sort','searchField','search','contractor','company','companySearch','dueDate','status'))
 then raise exception 'Invalid job filters' using errcode='22023';end if;
 lim:=coalesce((p_filters->>'size')::integer,25);off:=coalesce((p_filters->>'offset')::integer,0);
 queue:=coalesce(nullif(p_filters->>'queue',''),'ALL');
 sort_by:=coalesce(p_filters->>'sort','created_at.desc');
 field:=coalesce(p_filters->>'searchField','property_address');
 term:=btrim(coalesce(p_filters->>'search',''));
 company_term:=btrim(coalesce(p_filters->>'companySearch',''));
 contractor:=nullif(p_filters->>'contractor','')::uuid;
 company:=nullif(p_filters->>'company','')::uuid;
 due:=nullif(p_filters->>'dueDate','')::date;status:=nullif(p_filters->>'status','');
 if lim not in (25,50) or off<0 or off>1000000 or char_length(term)>160
   or char_length(company_term)>100 or field not in ('property_address','wo_number')
   or sort_by not in ('created_at.desc','due_date.asc','due_date.desc')
   or (status is not null and status not in ('ASSIGNED','IN_PROGRESS','FIELD_COMPLETE','CANCELLED'))
   or queue not in ('ALL','ACTIVE','NEEDS_ASSIGNMENT','AWAITING_ACK','IN_PROGRESS','OVERDUE',
    'PHOTOS_PENDING','AWAITING_REVIEW','FOLLOWUP_PENDING','READY_FOR_APPROVAL','READY_TO_SEND',
    'SENDING','DELIVERY_PROBLEM','COMPLETED','PROBLEMS','CANCELLED')
 then raise exception 'Bounded job filters required' using errcode='22023';end if;
 select md5(org::text||':'||coalesce(string_agg(t.id::text,',' order by t.id),''))
   into scope from public.admin_teams t where t.organization_id=org
     and private.has_team_capability(org,t.id,'WORK');
 -- One statement snapshot and one authorized filtered relation own both the
 -- page and every queue count. No unbounded photo list reaches the browser.
 with eligible as materialized (
   select w.*,c.name as company_name,private.admin_work_order_facts(w.id,as_of) as facts
   from public.work_orders w left join private.client_companies c on c.id=w.client_company_id
   where w.organization_id=org and private.can_read_office_work_order(w.id)
     and (status is null or w.field_status=status)
     and (contractor is null or w.assigned_user_id=contractor)
     and (company is null or w.client_company_id=company)
     and (company_term='' or strpos(lower(c.name),lower(company_term))>0)
     and (due is null or w.due_date=due)
     and (term='' or strpos(lower(case when field='wo_number' then w.wo_number else w.property_address end),lower(term))>0)
 ), matching as materialized (
   select * from eligible where coalesce((facts->'queues'->>queue)::boolean,false)
 ), page_rows as (
   select * from matching order by
    case when sort_by='created_at.desc' then created_at end desc nulls last,
    case when sort_by='due_date.asc' then due_date end asc nulls last,
    case when sort_by='due_date.desc' then due_date end desc nulls last,id asc
   limit lim offset off
 ), counted as (
   select key,count(*) filter(where value='true'::jsonb) as n
   from eligible cross join lateral jsonb_each(facts->'queues') group by key
 ), queue_keys as (
   select unnest(array['ALL','ACTIVE','NEEDS_ASSIGNMENT','AWAITING_ACK','IN_PROGRESS','OVERDUE',
    'PHOTOS_PENDING','AWAITING_REVIEW','FOLLOWUP_PENDING','READY_FOR_APPROVAL','READY_TO_SEND',
    'SENDING','DELIVERY_PROBLEM','COMPLETED','PROBLEMS','CANCELLED']) as key
 )
 select jsonb_build_object('organization_id',org,'as_of',as_of,'scope_fingerprint',scope,
   'total',(select count(*) from matching),'offset',off,'size',lim,'queue',queue,
   'counts',(select jsonb_object_agg(q.key,coalesce(c.n,0)) from queue_keys q left join counted c using(key)),
   'rows',coalesce((select jsonb_agg(jsonb_build_object(
     'id',w.id,'organization_id',w.organization_id,'client_company_id',w.client_company_id,
     'company_name',w.company_name,'assigned_user_id',w.assigned_user_id,
     'pending_assignee_user_id',w.pending_assignee_user_id,'reassignment_requested_at',w.reassignment_requested_at,
     'assignment_received_at',w.assignment_received_at,'wo_number',w.wo_number,
     'property_address',w.property_address,'work_type',w.work_type,'instructions',w.instructions,
     'due_date',w.due_date,'field_status',w.field_status,'updated_at',w.updated_at,
     'created_at',w.created_at,'current_run_id',w.current_run_id,'operational',w.facts,
     'run',(select jsonb_build_object('requirement_snapshot',wr.requirement_snapshot,
       'assignment',coalesce((select jsonb_agg(jsonb_build_object(
          'assigned_user_id',a.assigned_user_id,'assignment_received_at',a.assignment_received_at,
          'acknowledgment_received_at',a.acknowledgment_received_at,'assignment_ended_at',a.assignment_ended_at))
          from (select * from public.work_order_assignments where run_id=wr.id
            and assignment_ended_at is null and assigned_user_id=w.assigned_user_id
            order by assignment_started_at desc,id limit 1) a),'[]'::jsonb))
        from public.work_order_runs wr where wr.id=w.current_run_id))
     order by case when sort_by='created_at.desc' then w.created_at end desc nulls last,
       case when sort_by='due_date.asc' then w.due_date end asc nulls last,
       case when sort_by='due_date.desc' then w.due_date end desc nulls last,w.id asc)
     from page_rows w),'[]'::jsonb)) into result;
 return result;
end;$page$;
create function public.admin_work_order_page(p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.admin_work_order_page(p_filters)
$$;
revoke all on function private.admin_work_order_facts(uuid,timestamptz),
 private.admin_work_order_page(jsonb),public.admin_work_order_page(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_work_order_page(jsonb),public.admin_work_order_page(jsonb)
 to authenticated;
