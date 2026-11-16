-- Extend the existing draft owner to one resumable Create & Assign draft per Admin.
-- NULL work_order_id is a draft only; saving cannot create/assign a job.
alter table private.admin_job_drafts alter column work_order_id drop not null;
alter table private.admin_job_drafts alter column base_updated_at drop not null;
alter table private.admin_job_drafts add constraint admin_job_drafts_binding_check check (
 (work_order_id is not null and base_updated_at is not null)
 or (work_order_id is null and base_updated_at is null and base_run_id is null and client_company_id is null));
create unique index admin_job_drafts_new_owner_idx on private.admin_job_drafts(owner_user_id) where work_order_id is null;

create or replace function private.admin_job_draft(
 p_wo uuid,p_operation text,p_payload jsonb default null,
 p_expected_revision uuid default null,p_base_updated_at timestamptz default null,
 p_write_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $draft$
declare org uuid; w public.work_orders%rowtype; d private.admin_job_drafts%rowtype;
 field_name text; max_length integer;
begin
 if p_operation not in ('READ','SAVE','DISCARD') or p_operation is null
 then raise exception 'Invalid draft operation' using errcode='22023';end if;
 if p_operation<>'READ' then perform private.lock_legacy_work_authority();end if;
 org:=private.admin_alert_current_org();
 if p_wo is null then
  -- New work drafts use exactly the existing Create & Assign Admin authority.
  -- Lock one actor before reading an absent row, so first saves serialize too.
  org:=private.phase4_admin_org();
  if p_operation<>'READ' then
   perform 1 from private.account_work_access where user_id=auth.uid() and organization_id=org for update;
  end if;
 else
  if not private.can_read_office_work_order(p_wo)
  then raise exception 'Current scoped office job required' using errcode='42501';end if;
  if p_operation='READ' then
   select * into w from public.work_orders where id=p_wo and organization_id=org;
  else
   select * into w from public.work_orders where id=p_wo and organization_id=org for update;
  end if;
  if w.id is null then raise exception 'Current scoped office job required' using errcode='42501';end if;
 end if;
 select * into d from private.admin_job_drafts
  where owner_user_id=auth.uid() and work_order_id is not distinct from p_wo and organization_id=org;
 if p_operation='SAVE' then
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>200000 or p_write_id is null or (p_wo is not null and p_base_updated_at is null)
    or (p_wo is null and p_base_updated_at is not null)
    or not (p_payload ?& array['woNumber','propertyAddress','workType','instructions','dueDate','assignedUserId','requirements','requirementsLegacy','expectedRevision'])
    or exists(select 1 from jsonb_object_keys(p_payload) k where k not in
      ('woNumber','propertyAddress','workType','instructions','dueDate','assignedUserId','requirements','requirementsLegacy','expectedRevision')
      and (p_wo is not null or k not in ('numberMode','rememberNumberMode','sourceTemplateId')))
  then raise exception 'Invalid job draft' using errcode='22023';end if;
  foreach field_name in array array['woNumber','propertyAddress','workType','instructions','dueDate','assignedUserId'] loop
   max_length:=case field_name when 'woNumber' then 160 when 'propertyAddress' then 500
    when 'workType' then 200 when 'instructions' then 4000 when 'dueDate' then 10 else 36 end;
   if jsonb_typeof(p_payload->field_name)<>'string' or char_length(p_payload->>field_name)>max_length
   then raise exception 'Invalid job draft field' using errcode='22023';end if;
  end loop;
  if jsonb_typeof(p_payload->'requirementsLegacy')<>'boolean'
    or jsonb_typeof(p_payload->'requirements')<>'object'
    or jsonb_typeof(p_payload->'expectedRevision') not in ('string','null')
    or coalesce(char_length(p_payload->>'expectedRevision'),0)>36
  then raise exception 'Invalid job draft requirements' using errcode='22023';end if;
  if p_wo is null and (
    not (p_payload ?& array['numberMode','rememberNumberMode','sourceTemplateId'])
    or jsonb_typeof(p_payload->'numberMode')<>'string'
    or p_payload->>'numberMode' not in ('auto','custom')
    or jsonb_typeof(p_payload->'rememberNumberMode')<>'boolean'
    or jsonb_typeof(p_payload->'sourceTemplateId') not in ('string','null')
    or (p_payload->>'sourceTemplateId' is not null and (p_payload->>'sourceTemplateId')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
    or p_payload->'requirementsLegacy'<>'false'::jsonb or p_payload->'expectedRevision'<>'null'::jsonb)
  then raise exception 'Invalid new-work draft' using errcode='22023';end if;
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
   if p_wo is not null and w.updated_at is distinct from p_base_updated_at
   then raise exception 'Job changed; retain edits and reload before saving draft' using errcode='PT409';end if;
   if d.id is null then
    insert into private.admin_job_drafts(organization_id,owner_user_id,work_order_id,
     base_updated_at,base_run_id,client_company_id,payload,write_id)
    values(org,auth.uid(),p_wo,w.updated_at,w.current_run_id,w.client_company_id,p_payload,p_write_id)
    returning * into d;
   else
    update private.admin_job_drafts set base_updated_at=w.updated_at,base_run_id=w.current_run_id,
     client_company_id=w.client_company_id,payload=p_payload,write_id=p_write_id,
     revision=gen_random_uuid(),updated_at=clock_timestamp() where id=d.id returning * into d;
   end if;
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

-- Exact creation receipt: consuming a draft and delegating to the existing
-- creation engine commit together. A lost response replays this receipt.
create table private.admin_job_draft_creations (
 draft_revision uuid primary key,
 draft_id uuid not null,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.admin_job_draft_creations enable row level security;
revoke all on private.admin_job_draft_creations from public,anon,authenticated,service_role;
create index admin_job_draft_creations_org_idx on private.admin_job_draft_creations(organization_id);
create index admin_job_draft_creations_actor_idx on private.admin_job_draft_creations(actor_user_id);
create index admin_job_draft_creations_work_idx on private.admin_job_draft_creations(work_order_id);
create trigger admin_job_draft_creations_immutable before update or delete on private.admin_job_draft_creations
 for each row execute function private.protect_photo_transfer_ledger();

create function private.admin_create_work_order_from_draft(p_revision uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $create$
declare org uuid; d private.admin_job_drafts%rowtype; receipt private.admin_job_draft_creations%rowtype;
 created jsonb; p jsonb;
begin
 perform private.lock_legacy_work_authority();org:=private.phase4_admin_org();
 if p_revision is null then raise exception 'Exact saved new-work draft required' using errcode='22023';end if;
 perform 1 from private.account_work_access where user_id=auth.uid() and organization_id=org for update;
 select * into receipt from private.admin_job_draft_creations where draft_revision=p_revision;
 if receipt.draft_revision is not null then
  if receipt.actor_user_id is distinct from auth.uid() or receipt.organization_id is distinct from org
   or not private.can_read_office_work_order(receipt.work_order_id)
  then raise exception 'Creation receipt unavailable' using errcode='42501';end if;
  return receipt.result;
 end if;
 select * into d from private.admin_job_drafts where owner_user_id=auth.uid()
  and organization_id=org and work_order_id is null for update;
 if d.id is null or d.revision is distinct from p_revision
 then raise exception 'New-work draft changed; check saved draft before creating' using errcode='PT409';end if;
 p:=d.payload;
 -- Provenance is copied draft metadata, never an authorization or template write.
 select j into created from private.admin_create_work_order_v4(
  p->>'numberMode'='auto',case when p->>'numberMode'='custom' then btrim(p->>'woNumber') else null end,
  btrim(p->>'propertyAddress'),btrim(p->>'workType'),btrim(p->>'instructions'),
  nullif(p->>'dueDate','')::date,nullif(p->>'assignedUserId','')::uuid,p->'requirements') j;
 if created->>'work_order_id' is null then raise exception 'Creation did not return a work order';end if;
 insert into private.admin_job_draft_creations(draft_revision,draft_id,organization_id,actor_user_id,work_order_id,result)
 values(d.revision,d.id,org,auth.uid(),(created->>'work_order_id')::uuid,created);
 delete from private.admin_job_drafts where id=d.id;
 return created;
end;$create$;
create function public.admin_create_work_order_from_draft(p_revision uuid) returns setof jsonb
language sql security invoker set search_path='' as $$
 select private.admin_create_work_order_from_draft(p_revision);$$;
revoke all on function private.admin_create_work_order_from_draft(uuid),public.admin_create_work_order_from_draft(uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_create_work_order_from_draft(uuid),public.admin_create_work_order_from_draft(uuid)
 to authenticated;
