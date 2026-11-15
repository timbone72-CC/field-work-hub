-- 6A-T02: private per-office-user drafts for existing jobs. Never applies work.
create table private.admin_job_drafts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 owner_user_id uuid not null references auth.users(id) on delete restrict,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 base_updated_at timestamptz not null,
 base_run_id uuid,
 client_company_id uuid,
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=200000),
 revision uuid not null default gen_random_uuid(),
 write_id uuid not null,
 updated_at timestamptz not null default clock_timestamp(),
 unique(owner_user_id,work_order_id)
);
alter table private.admin_job_drafts enable row level security;
revoke all on private.admin_job_drafts from public,anon,authenticated,service_role;
create index admin_job_drafts_organization_idx on private.admin_job_drafts(organization_id);
create index admin_job_drafts_work_order_idx on private.admin_job_drafts(work_order_id);

-- One short authority/WO/draft lock order; direct tables are never exposed.
create function private.admin_job_draft(
 p_wo uuid,p_operation text,p_payload jsonb default null,
 p_expected_revision uuid default null,p_base_updated_at timestamptz default null,
 p_write_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $draft$
declare org uuid; w public.work_orders%rowtype; d private.admin_job_drafts%rowtype;
 field_name text; max_length integer;
begin
 if p_operation not in ('READ','SAVE','DISCARD') or p_operation is null or p_wo is null
 then raise exception 'Invalid draft operation' using errcode='22023';end if;
 if p_operation<>'READ' then perform private.lock_legacy_work_authority();end if;
 org:=private.admin_alert_current_org();
 if not private.can_read_office_work_order(p_wo)
 then raise exception 'Current scoped office job required' using errcode='42501';end if;
 -- Serialize per job before the first insert too; this prevents two tabs
 -- with expected NULL from both creating a draft or overwriting one another.
 if p_operation='READ' then
  select * into w from public.work_orders where id=p_wo and organization_id=org;
 else
  select * into w from public.work_orders where id=p_wo and organization_id=org for update;
 end if;
 if w.id is null then raise exception 'Current scoped office job required' using errcode='42501';end if;
 select * into d from private.admin_job_drafts
  where owner_user_id=auth.uid() and work_order_id=p_wo and organization_id=org;
 if p_operation='SAVE' then
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>200000 or p_write_id is null or p_base_updated_at is null
    or not (p_payload ?& array['woNumber','propertyAddress','workType','instructions','dueDate','assignedUserId','requirements','expectedRevision'])
    or exists(select 1 from jsonb_object_keys(p_payload) k where k not in
      ('woNumber','propertyAddress','workType','instructions','dueDate','assignedUserId','requirements','expectedRevision'))
  then raise exception 'Invalid job draft' using errcode='22023';end if;
  foreach field_name in array array['woNumber','propertyAddress','workType','instructions','dueDate','assignedUserId'] loop
   max_length:=case field_name when 'woNumber' then 160 when 'propertyAddress' then 500
    when 'workType' then 200 when 'instructions' then 4000 when 'dueDate' then 10 else 36 end;
   if jsonb_typeof(p_payload->field_name)<>'string' or char_length(p_payload->>field_name)>max_length
   then raise exception 'Invalid job draft field' using errcode='22023';end if;
  end loop;
  if jsonb_typeof(p_payload->'requirements')<>'object'
    or jsonb_typeof(p_payload->'expectedRevision') not in ('string','null')
    or coalesce(char_length(p_payload->>'expectedRevision'),0)>36
  then raise exception 'Invalid job draft requirements' using errcode='22023';end if;
  perform private.validate_photo_requirements(p_payload->'requirements');
  -- An exact lost-response retry returns the same revision, even if the WO
  -- subsequently changed. It does not rewrite the draft or current job.
  if d.id is not null and d.write_id=p_write_id then
   if d.payload is distinct from p_payload or d.base_updated_at is distinct from p_base_updated_at
   then raise exception 'Draft request identity reused' using errcode='PT409';end if;
  else
   if (d.id is null and p_expected_revision is not null)
     or (d.id is not null and d.revision is distinct from p_expected_revision)
   then raise exception 'Saved draft changed; check saved draft before saving' using errcode='PT409';end if;
   if w.updated_at is distinct from p_base_updated_at
   then raise exception 'Job changed; retain edits and reload before saving draft' using errcode='PT409';end if;
   insert into private.admin_job_drafts(organization_id,owner_user_id,work_order_id,
    base_updated_at,base_run_id,client_company_id,payload,write_id)
   values(org,auth.uid(),w.id,w.updated_at,w.current_run_id,w.client_company_id,p_payload,p_write_id)
   on conflict(owner_user_id,work_order_id) do update set
    base_updated_at=excluded.base_updated_at,base_run_id=excluded.base_run_id,
    client_company_id=excluded.client_company_id,payload=excluded.payload,
    write_id=excluded.write_id,revision=gen_random_uuid(),updated_at=clock_timestamp()
   returning * into d;
  end if;
 elsif p_operation='DISCARD' then
  if d.id is not null then
   if d.revision is distinct from p_expected_revision
   then raise exception 'Saved draft changed; check it before discarding' using errcode='PT409';end if;
   delete from private.admin_job_drafts where id=d.id;
   d:=null;
  end if;
 end if;
 return jsonb_build_object('work_order_id',w.id,'organization_id',org,'owner_user_id',auth.uid(),
  'draft',case when d.id is null then null else jsonb_build_object(
   'id',d.id,'revision',d.revision,'base_updated_at',d.base_updated_at,
   'base_run_id',d.base_run_id,'client_company_id',d.client_company_id,
   'payload',d.payload,'write_id',d.write_id,'updated_at',d.updated_at,
   'stale',d.base_updated_at is distinct from w.updated_at
     or d.base_run_id is distinct from w.current_run_id
     or d.client_company_id is distinct from w.client_company_id) end);
end;$draft$;

create function public.admin_job_draft_state(p_wo uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select private.admin_job_draft(p_wo,'READ');$$;
create function public.admin_save_job_draft(p_wo uuid,p_payload jsonb,p_expected_revision uuid,
 p_base_updated_at timestamptz,p_write_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select private.admin_job_draft(p_wo,'SAVE',p_payload,p_expected_revision,p_base_updated_at,p_write_id);$$;
create function public.admin_discard_job_draft(p_wo uuid,p_expected_revision uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select private.admin_job_draft(p_wo,'DISCARD',null,p_expected_revision);$$;
revoke all on function private.admin_job_draft(uuid,text,jsonb,uuid,timestamptz,uuid),
 public.admin_job_draft_state(uuid),public.admin_save_job_draft(uuid,jsonb,uuid,timestamptz,uuid),
 public.admin_discard_job_draft(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.admin_job_draft(uuid,text,jsonb,uuid,timestamptz,uuid),
 public.admin_job_draft_state(uuid),public.admin_save_job_draft(uuid,jsonb,uuid,timestamptz,uuid),
 public.admin_discard_job_draft(uuid,uuid) to authenticated;
