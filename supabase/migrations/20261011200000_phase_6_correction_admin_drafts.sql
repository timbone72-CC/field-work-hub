-- Phase 6C: one persisted, revisioned Admin correction request inside the
-- existing authorized WO/review and Phase 6B admin_create_followup authority.
-- No independent dispatch, photo mutation, transfer, or delivery owner.
create table private.admin_correction_drafts(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 work_order_id uuid not null unique references public.work_orders(id) on delete restrict,
 origin_run_id uuid not null,
 expected_wo_updated_at timestamptz not null,
 kind text not null check(kind in ('INTERNAL_CORRECTION','CLIENT_RETURN')),
 reason text not null check(char_length(btrim(reason)) between 1 and 2000),
 reference_photos uuid[] not null default '{}',
 assigned_user_id uuid not null references auth.users(id) on delete restrict,
 due_date date not null,
 instructions text not null check(char_length(instructions)<=4000),
 capture_requirements jsonb not null,
 item_mapping jsonb not null check(jsonb_typeof(item_mapping)='array'),
 release_requirements jsonb not null,
 revision uuid not null default gen_random_uuid(),
 status text not null default 'DRAFT' check(status in ('DRAFT','DISPATCHED')),
 dispatched_action_id uuid unique,
 dispatched_result jsonb,
 saved_by uuid not null references auth.users(id) on delete restrict,
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(origin_run_id,work_order_id)
   references public.work_order_runs(id,work_order_id) on delete restrict,
 check ((status='DRAFT' and dispatched_action_id is null and dispatched_result is null)
     or (status='DISPATCHED' and dispatched_action_id is not null and dispatched_result is not null))
);
create table private.admin_correction_previews(
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references private.admin_correction_drafts(id) on delete restrict,
 revision uuid not null,
 actor_id uuid not null references auth.users(id) on delete restrict,
 manifest_sha256 text not null check(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(draft_id,revision,actor_id,manifest_sha256)
);
alter table private.admin_correction_drafts enable row level security;
alter table private.admin_correction_previews enable row level security;
revoke all on private.admin_correction_drafts,private.admin_correction_previews
  from public,anon,authenticated,service_role;
grant select on private.admin_correction_drafts,private.admin_correction_previews to service_role;
create trigger admin_correction_previews_immutable before update or delete
 on private.admin_correction_previews for each row
 execute function private.protect_photo_transfer_ledger();

-- Called from all three correction endpoints, never from a public direct
-- table grant. Snapshot is the immutable original Run-1 requirements for the
-- first follow-up, then the WO's revisioned release requirements.
create function private.admin_correction_basis(p_wo uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $basis$
declare w public.work_orders%rowtype; oldrun public.work_order_runs%rowtype;
    req jsonb; kind text; refs jsonb;
begin
 if p_wo is null or not private.current_identity_valid()
   or not private.can_work_order(p_wo)
   or private.phase4_admin_org() is null
 then raise exception 'Current scoped office work required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo;
 if w.id is null or w.field_status<>'FIELD_COMPLETE'
    or w.client_company_id is null or w.responsible_team_id is null
 then raise exception 'Current completed client work required' using errcode='40001';end if;
 select * into oldrun from public.work_order_runs
    where id=w.current_run_id and work_order_id=w.id;
 if oldrun.id is null or oldrun.field_status<>'FIELD_COMPLETE'
   or oldrun.field_completed_at is null or
   not exists(select 1 from public.field_actions a where a.run_id=oldrun.id
      and a.work_order_id=w.id and a.action_kind='COMPLETE')
 then raise exception 'Accepted Finish required before correction' using errcode='40001';end if;
 if exists(select 1 from public.photos p where p.work_order_id=w.id
    and p.run_id=w.current_run_id and not exists(
       select 1 from private.photo_transfers t
       join private.photo_transfer_receipts r
         on r.photo_id=t.photo_id and r.transfer_version=t.version
       where t.photo_id=p.id and t.run_id=p.run_id and t.state='RECEIVED'))
 then raise exception 'Private photo transfers still pending' using errcode='40001';end if;
 if exists(select 1 from private.client_packages k where k.work_order_id=w.id
   and k.status in ('QUEUED','DELIVERING','FAILED','UNCERTAIN'))
 then raise exception 'Unresolved client delivery blocks correction' using errcode='40001';end if;
 req:=case when w.current_run_sequence=1 then oldrun.requirement_snapshot
    else w.release_requirement_snapshot end;
 perform private.validate_photo_requirements(req);
 kind:=case when exists(select 1 from private.client_packages k
    where k.work_order_id=w.id and k.status='DELIVERED')
    then 'CLIENT_RETURN' else 'INTERNAL_CORRECTION' end;
 return jsonb_build_object('work_order_id',w.id,'client_wo_number',w.wo_number,
   'client_company_id',w.client_company_id,'work_type',w.work_type,
   'origin_run_id',w.current_run_id,'expected_wo_updated_at',w.updated_at,
   'kind',kind,'release_requirements',req,'release_revision',w.release_requirement_revision,
   'current_assignee',w.assigned_user_id,'current_due_date',w.due_date);
end;$basis$;
revoke all on function private.admin_correction_basis(uuid) from public,anon,authenticated;
grant execute on function private.admin_correction_basis(uuid) to authenticated,service_role;

create function private.admin_correction_state(p_wo uuid)
returns jsonb language plpgsql security definer set search_path='' as $state$
declare b jsonb; d private.admin_correction_drafts%rowtype;
begin
 b:=private.admin_correction_basis(p_wo);
 -- The draft's org is compared with the original WO, not the client company.
 select * into d from private.admin_correction_drafts
   where work_order_id=p_wo;
 if d.id is not null and d.organization_id is distinct from
   (select w.organization_id from public.work_orders w where w.id=p_wo)
 then raise exception 'Correction draft organization conflict' using errcode='42501';end if;
 return b||jsonb_build_object('draft',case when d.id is null then null else
   jsonb_build_object('id',d.id,'revision',d.revision,'status',d.status,
     'origin_run_id',d.origin_run_id,'expected_wo_updated_at',d.expected_wo_updated_at,
     'kind',d.kind,'reason',d.reason,'reference_photos',to_jsonb(d.reference_photos),
     'assigned_user_id',d.assigned_user_id,'due_date',d.due_date,
     'instructions',d.instructions,'capture_requirements',d.capture_requirements,
     'item_mapping',d.item_mapping,'release_requirements',d.release_requirements,
     'dispatched_result',d.dispatched_result) end);
end;$state$;
create function public.admin_correction_state(p_wo uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_correction_state(p_wo)
$$;

create function private.admin_save_correction_draft(
 p_wo uuid,p_expected_run uuid,p_expected_wo_updated_at timestamptz,
 p_expected_revision uuid,p_reason text,p_reference_photos uuid[],
 p_assigned_user uuid,p_due_date date,p_instructions text,
 p_capture_requirements jsonb,p_item_mapping jsonb,p_release_requirements jsonb
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $save$
declare w public.work_orders%rowtype; d private.admin_correction_drafts%rowtype;
 b jsonb; org uuid; v_kind text; pid uuid;
begin
 if p_wo is null or p_expected_run is null or p_expected_wo_updated_at is null
    or coalesce(length(btrim(p_reason)) between 1 and 2000,false)=false
    or p_reference_photos is null or cardinality(p_reference_photos)>200
    or array_position(p_reference_photos,null) is not null
    or p_assigned_user is null or p_due_date is null
    or p_instructions is null or char_length(p_instructions)>4000
 then raise exception 'Complete bounded correction draft required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();
 b:=private.admin_correction_basis(p_wo);
 org:=private.phase4_admin_org();v_kind:=b->>'kind';
 select * into w from public.work_orders where id=p_wo for update;
 if w.current_run_id is distinct from p_expected_run or
    w.updated_at is distinct from p_expected_wo_updated_at
 then raise exception 'Current job changed; reload correction draft' using errcode='40001';end if;
 if not private.is_assignable_contractor(p_assigned_user,org)
  or private.contractor_current_team(p_assigned_user,org) is distinct from w.responsible_team_id
 then raise exception 'Assigned contractor lacks current team/work authority'
   using errcode='42501';end if;
 perform private.validate_correction_mapping(
   p_capture_requirements,b->'release_requirements',
   p_release_requirements,p_item_mapping);
 if exists(select 1 from unnest(p_reference_photos) photo
      group by photo having count(*)>1)
 then raise exception 'Duplicate reference photo' using errcode='22023';end if;
 foreach pid in array p_reference_photos loop
   if not exists(select 1 from public.photos ph
       join private.photo_transfers t on t.photo_id=ph.id and t.run_id=ph.run_id
       join private.photo_transfer_receipts r
         on r.photo_id=t.photo_id and r.transfer_version=t.version
       where ph.id=pid and ph.work_order_id=w.id and t.state='RECEIVED')
       or not private.photo_has_accepted_finish(pid)
   then raise exception 'Only accepted, verified work-order photos may be referenced'
       using errcode='42501';end if;
 end loop;
 select * into d from private.admin_correction_drafts where work_order_id=w.id for update;
 if d.id is null and p_expected_revision is not null
   or d.id is not null and (d.revision is distinct from p_expected_revision
      or d.status<>'DRAFT')
 then raise exception 'Draft changed or dispatched; reload before saving' using errcode='40001';end if;
 if d.id is null then
   insert into private.admin_correction_drafts(
     organization_id,work_order_id,origin_run_id,expected_wo_updated_at,
     kind,reason,reference_photos,assigned_user_id,due_date,instructions,
     capture_requirements,item_mapping,release_requirements,saved_by)
   values(org,w.id,w.current_run_id,w.updated_at,v_kind,btrim(p_reason),
     p_reference_photos,p_assigned_user,p_due_date,p_instructions,
     p_capture_requirements,p_item_mapping,p_release_requirements,auth.uid())
   returning * into d;
 else
   update private.admin_correction_drafts set
     origin_run_id=w.current_run_id,expected_wo_updated_at=w.updated_at,
     kind=v_kind,reason=btrim(p_reason),reference_photos=p_reference_photos,
     assigned_user_id=p_assigned_user,due_date=p_due_date,instructions=p_instructions,
     capture_requirements=p_capture_requirements,item_mapping=p_item_mapping,
     release_requirements=p_release_requirements,revision=gen_random_uuid(),
     saved_by=auth.uid(),updated_at=clock_timestamp()
   where id=d.id returning * into d;
 end if;
 return jsonb_build_object('draft_id',d.id,'revision',d.revision,
   'status',d.status,'origin_run_id',d.origin_run_id,'kind',d.kind);
end;$save$;
create function public.admin_save_correction_draft(
 p_wo uuid,p_expected_run uuid,p_expected_wo_updated_at timestamptz,
 p_expected_revision uuid,p_reason text,p_reference_photos uuid[],
 p_assigned_user uuid,p_due_date date,p_instructions text,
 p_capture_requirements jsonb,p_item_mapping jsonb,p_release_requirements jsonb
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_save_correction_draft(
 p_wo,p_expected_run,p_expected_wo_updated_at,p_expected_revision,
 p_reason,p_reference_photos,p_assigned_user,p_due_date,p_instructions,
 p_capture_requirements,p_item_mapping,p_release_requirements)
$$;

create function private.admin_preview_correction_draft(
 p_wo uuid,p_revision uuid
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $preview$
declare d private.admin_correction_drafts%rowtype; b jsonb;
 content jsonb; digest text;
begin
 if p_revision is null then raise exception 'Saved draft revision required' using errcode='22023';end if;
 perform private.lock_account_lifecycle();
 b:=private.admin_correction_basis(p_wo);
 select * into d from private.admin_correction_drafts where work_order_id=p_wo for update;
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
    'item_mapping',d.item_mapping,'release_requirements',d.release_requirements,
    'draft_revision',d.revision);
 digest:=encode(sha256(convert_to(content::text,'UTF8')),'hex');
 insert into private.admin_correction_previews(
    draft_id,revision,actor_id,manifest_sha256)
 values(d.id,d.revision,auth.uid(),digest) on conflict do nothing;
 return jsonb_build_object('draft_revision',d.revision,
  'preview_sha256',digest,'summary',content);
end;$preview$;
create function public.admin_preview_correction_draft(p_wo uuid,p_revision uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_preview_correction_draft(p_wo,p_revision)
$$;

create function private.admin_dispatch_correction_draft(
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
 select * into d from private.admin_correction_drafts where work_order_id=p_wo for update;
 if d.id is null or d.revision is distinct from p_revision then
   raise exception 'Correction draft revision changed' using errcode='40001';end if;
 if d.status='DISPATCHED' then
   if d.dispatched_action_id is distinct from p_action
   then raise exception 'Correction already dispatched; reload its result' using errcode='40001';end if;
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
    'item_mapping',d.item_mapping,'release_requirements',d.release_requirements,
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
 set status='DISPATCHED',dispatched_action_id=p_action,dispatched_result=result,
     updated_at=clock_timestamp()
 where id=d.id;
 return result;
end;$dispatch$;
create function public.admin_dispatch_correction_draft(
 p_action uuid,p_wo uuid,p_revision uuid,p_preview_sha256 text
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_dispatch_correction_draft(p_action,p_wo,p_revision,p_preview_sha256)
$$;
revoke all on function private.admin_correction_state(uuid),
  public.admin_correction_state(uuid),
  private.admin_save_correction_draft(uuid,uuid,timestamptz,uuid,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb),
  public.admin_save_correction_draft(uuid,uuid,timestamptz,uuid,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb),
  private.admin_preview_correction_draft(uuid,uuid),
  public.admin_preview_correction_draft(uuid,uuid),
  private.admin_dispatch_correction_draft(uuid,uuid,uuid,text),
  public.admin_dispatch_correction_draft(uuid,uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function private.admin_correction_state(uuid),
  public.admin_correction_state(uuid),
  private.admin_save_correction_draft(uuid,uuid,timestamptz,uuid,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb),
  public.admin_save_correction_draft(uuid,uuid,timestamptz,uuid,text,uuid[],uuid,date,text,jsonb,jsonb,jsonb),
  private.admin_preview_correction_draft(uuid,uuid),
  public.admin_preview_correction_draft(uuid,uuid),
  private.admin_dispatch_correction_draft(uuid,uuid,uuid,text),
  public.admin_dispatch_correction_draft(uuid,uuid,uuid,text)
to authenticated,service_role;
