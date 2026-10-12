-- Phase 6C: explicit grouped issues belong to the same durable correction
-- draft, actor and revision. Changes invalidate every earlier preview hash.
alter table private.admin_correction_drafts add column issues jsonb not null
  default '[]'::jsonb check(jsonb_typeof(issues)='array' and jsonb_array_length(issues)<=50);

create function private.admin_save_correction_issues(
 p_wo uuid,p_expected_revision uuid,p_issues jsonb
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $issues$
declare b jsonb; w public.work_orders%rowtype; d private.admin_correction_drafts%rowtype;
 issue jsonb; pid uuid; iid uuid;
begin
 if p_expected_revision is null or p_issues is null or jsonb_typeof(p_issues)<>'array'
    or jsonb_array_length(p_issues)>50
 then raise exception 'Bounded saved correction issues required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();
 b:=private.admin_correction_basis(p_wo);
 select * into w from public.work_orders where id=p_wo for update;
 select * into d from private.admin_correction_drafts
   where work_order_id=p_wo and origin_run_id=w.current_run_id for update;
 if d.id is null or d.status<>'DRAFT'
   or d.revision is distinct from p_expected_revision
   or d.expected_wo_updated_at is distinct from w.updated_at
 then raise exception 'Correction draft changed; reload before saving issues'
   using errcode='40001';end if;
 for issue in select value from jsonb_array_elements(p_issues) loop
   if jsonb_typeof(issue)<>'object'
     or (select count(*) from jsonb_object_keys(issue))<>4
     or not (issue ? 'photo_id' and issue ? 'item_id' and issue ? 'reason' and issue ? 'requested_count')
     or jsonb_typeof(issue->'photo_id') not in ('string','null')
     or jsonb_typeof(issue->'item_id') not in ('string','null')
     or jsonb_typeof(issue->'reason')<>'string'
     or char_length(btrim(issue->>'reason')) not between 1 and 1000
     or jsonb_typeof(issue->'requested_count')<>'number'
     or (issue->>'requested_count')!~'^[1-9][0-9]{0,2}$'
     or (issue->>'requested_count')::int>1000
   then raise exception 'Every correction issue needs a reason, count and exact photo/item'
     using errcode='22023';end if;
   pid:=nullif(issue->>'photo_id','')::uuid;
   iid:=nullif(issue->>'item_id','')::uuid;
   if pid is null and iid is null then
     raise exception 'Correction issue needs photo or requirement item UUID'
       using errcode='22023';end if;
   if pid is not null and not exists(
     select 1 from public.photos p
       join private.photo_transfers t on t.photo_id=p.id and t.run_id=p.run_id
       join private.photo_transfer_receipts r on r.photo_id=t.photo_id
         and r.transfer_version=t.version
     where p.id=pid and p.work_order_id=p_wo and t.state='RECEIVED')
   then raise exception 'Issue references unavailable or cross-work-order photo'
     using errcode='42501';end if;
   if iid is not null and not exists(
     select 1 from jsonb_array_elements(b->'release_requirements'->'items') v
      where v.value->>'id'=iid::text)
   then raise exception 'Issue references unknown original release goal'
     using errcode='42501';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_issues) v
   group by v.value->>'photo_id',v.value->>'item_id' having count(*)>1)
 then raise exception 'Duplicate affected photo/goal issue' using errcode='22023';end if;
 update private.admin_correction_drafts set issues=p_issues,revision=gen_random_uuid(),
   saved_by=auth.uid(),updated_at=clock_timestamp() where id=d.id returning * into d;
 return jsonb_build_object('work_order_id',p_wo,'draft_id',d.id,
   'revision',d.revision,'issues',d.issues);
end;$issues$;
create function public.admin_save_correction_issues(
 p_wo uuid,p_expected_revision uuid,p_issues jsonb
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_save_correction_issues(p_wo,p_expected_revision,p_issues)
$$;
revoke all on function private.admin_save_correction_issues(uuid,uuid,jsonb),
 public.admin_save_correction_issues(uuid,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_save_correction_issues(uuid,uuid,jsonb),
 public.admin_save_correction_issues(uuid,uuid,jsonb)
 to authenticated,service_role;

-- Retain the identical existing office authority and exact-preview/dispatch
-- owners; only augment the frozen versioned summary with issue provenance.
create or replace function private.admin_correction_state(p_wo uuid)
returns jsonb language plpgsql security definer set search_path='' as $state$
declare b jsonb; d private.admin_correction_drafts%rowtype;
begin
 b:=private.admin_correction_basis(p_wo);
 -- The draft's org is compared with the original WO, not the client company.
 select * into d from private.admin_correction_drafts
   where work_order_id=p_wo and origin_run_id=(b->>'origin_run_id')::uuid;
 if d.id is not null and d.organization_id is distinct from
   (select w.organization_id from public.work_orders w where w.id=p_wo)
 then raise exception 'Correction draft organization conflict' using errcode='42501';end if;
 return b||jsonb_build_object('draft',case when d.id is null then null else
   jsonb_build_object('id',d.id,'revision',d.revision,'status',d.status,
     'origin_run_id',d.origin_run_id,'expected_wo_updated_at',d.expected_wo_updated_at,
     'kind',d.kind,'reason',d.reason,'reference_photos',to_jsonb(d.reference_photos),
     'assigned_user_id',d.assigned_user_id,'due_date',d.due_date,
     'instructions',d.instructions,'capture_requirements',d.capture_requirements,
     'issues',d.issues,'item_mapping',d.item_mapping,'release_requirements',d.release_requirements,
     'dispatched_result',d.dispatched_result) end);
end;$state$;

create or replace function private.admin_preview_correction_draft(
 p_wo uuid,p_revision uuid
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $preview$
declare d private.admin_correction_drafts%rowtype; b jsonb;
 content jsonb; digest text;
begin
 if p_revision is null then raise exception 'Saved draft revision required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();
 b:=private.admin_correction_basis(p_wo);
 select * into d from private.admin_correction_drafts
   where work_order_id=p_wo and origin_run_id=(b->>'origin_run_id')::uuid for update;
 if d.id is null or d.revision is distinct from p_revision or
    d.status<>'DRAFT' or d.origin_run_id is distinct from (b->>'origin_run_id')::uuid
    or d.expected_wo_updated_at is distinct from (b->>'expected_wo_updated_at')::timestamptz
    or d.kind is distinct from b->>'kind'
 then raise exception 'Correction draft stale; reload before preview' using errcode='40001';end if;
 perform private.validate_correction_mapping(
    d.capture_requirements,b->'release_requirements',
    d.release_requirements,d.item_mapping);
 content:=jsonb_build_object(
    'work_order_id',d.work_order_id,'wo_number',b->>'client_wo_number',
    'company_id',b->>'client_company_id','origin_run_id',d.origin_run_id,
    'expected_wo_updated_at',d.expected_wo_updated_at,
    'kind',d.kind,'reason',d.reason,'reference_photos',to_jsonb(d.reference_photos),
    'assigned_user_id',d.assigned_user_id,'due_date',d.due_date,
    'instructions',d.instructions,'capture_requirements',d.capture_requirements,
    'issues',d.issues,'item_mapping',d.item_mapping,'release_requirements',d.release_requirements,
    'draft_revision',d.revision);
 digest:=encode(sha256(convert_to(content::text,'UTF8')),'hex');
 insert into private.admin_correction_previews(
    draft_id,revision,actor_id,manifest_sha256)
 values(d.id,d.revision,auth.uid(),digest) on conflict do nothing;
 return jsonb_build_object('draft_revision',d.revision,
  'preview_sha256',digest,'summary',content);
end;$preview$;

create or replace function private.admin_dispatch_correction_draft(
 p_action uuid,p_wo uuid,p_revision uuid,p_preview_sha256 text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $dispatch$
declare d private.admin_correction_drafts%rowtype; result jsonb;
 b jsonb; preview jsonb; digest text;
begin
 if p_action is null or p_wo is null or p_revision is null or
   p_preview_sha256 is null or p_preview_sha256!~'^[a-f0-9]{64}$'
 then raise exception 'Explicit approved correction preview required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();
 -- Avoid manufacturing a successful retry while a new run has replaced the
 -- original one; only the exact originally dispatched action can replay.
 if not private.current_identity_valid() or not private.can_work_order(p_wo)
 then raise exception 'Current scoped office correction authority required' using errcode='42501';end if;
 select * into d from private.admin_correction_drafts
   where work_order_id=p_wo and revision=p_revision for update;
 if d.id is null or d.revision is distinct from p_revision then
   raise exception 'Correction draft revision changed' using errcode='40001';end if;
 if d.status='DISPATCHED' then
   if d.dispatched_action_id is distinct from p_action
      or d.dispatched_by is distinct from auth.uid()
      or d.dispatched_preview_sha256 is distinct from p_preview_sha256
   then raise exception 'Correction already dispatched by a different action/actor; reload its result' using errcode='40001';end if;
   return d.dispatched_result;
 end if;
 b:=private.admin_correction_basis(p_wo);
 if d.origin_run_id is distinct from (b->>'origin_run_id')::uuid
  or d.expected_wo_updated_at is distinct from (b->>'expected_wo_updated_at')::timestamptz
  or d.kind is distinct from b->>'kind'
 then raise exception 'Current WO changed; reload correction draft' using errcode='40001';end if;
 preview:=jsonb_build_object(
    'work_order_id',d.work_order_id,'wo_number',b->>'client_wo_number',
    'company_id',b->>'client_company_id','origin_run_id',d.origin_run_id,
    'expected_wo_updated_at',d.expected_wo_updated_at,
    'kind',d.kind,'reason',d.reason,'reference_photos',to_jsonb(d.reference_photos),
    'assigned_user_id',d.assigned_user_id,'due_date',d.due_date,
    'instructions',d.instructions,'capture_requirements',d.capture_requirements,
    'issues',d.issues,'item_mapping',d.item_mapping,'release_requirements',d.release_requirements,
    'draft_revision',d.revision);
 digest:=encode(sha256(convert_to(preview::text,'UTF8')),'hex');
 if digest is distinct from p_preview_sha256
   or not exists(select 1 from private.admin_correction_previews v
       where v.draft_id=d.id and v.revision=d.revision
         and v.actor_id=auth.uid() and v.manifest_sha256=digest)
 then raise exception 'This account must preview the exact saved correction first'
     using errcode='42501';end if;
 result:=private.admin_create_followup(
   p_action,p_wo,d.origin_run_id,d.expected_wo_updated_at,d.kind,
   d.reason,d.reference_photos,d.assigned_user_id,d.due_date,
   d.instructions,d.capture_requirements,d.item_mapping,d.release_requirements);
 update private.admin_correction_drafts
 set status='DISPATCHED',dispatched_action_id=p_action,dispatched_by=auth.uid(),
     dispatched_preview_sha256=digest,dispatched_result=result,
     updated_at=clock_timestamp()
 where id=d.id;
 return result;
end;$dispatch$;
