-- Phase 4: additive run requirements and frozen capture metadata. No byte delivery.
create function private.phase4_admin_org() returns uuid
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid;
begin
 if auth.uid() is null or auth.jwt()->'app_metadata'->>'role' is distinct from 'ADMIN'
 or not exists(select 1 from auth.users u where u.id=auth.uid() and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=now())
 and u.raw_app_meta_data->>'role'='ADMIN' and u.raw_app_meta_data->>'organization_id'=v_org::text)
 then raise exception 'Active Admin authorization required' using errcode='42501'; end if;
 return v_org;
end; $$;

create function private.validate_photo_requirements(p jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare i jsonb; ids uuid[]:='{}'; names text[]:='{}'; n integer; s integer:=0; k text; id uuid;
begin
 if p is null or jsonb_typeof(p)<>'object' or p->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p->'revision') is distinct from 'string'
 or jsonb_typeof(p->'total') is distinct from 'object' or jsonb_typeof(p->'items') is distinct from 'array'
 then raise exception 'Unsupported photo requirements' using errcode='22023'; end if;
 perform (p->>'revision')::uuid;
 if exists(select 1 from jsonb_object_keys(p) t(k) where t.k not in ('schema','revision','total','items'))
 or exists(select 1 from jsonb_object_keys(p->'total') t(k) where t.k not in ('enabled','minimum'))
 or jsonb_typeof(p->'total'->'enabled') is distinct from 'boolean'
 or (p->'total'->>'minimum') !~ '^(0|[1-9][0-9]{0,3})$'
 or jsonb_typeof(p->'total'->'minimum') is distinct from 'number'
 then raise exception 'Invalid total requirement' using errcode='22023'; end if;
 n:=(p->'total'->>'minimum')::integer;
 if n>5000 or ((p->'total'->>'enabled')::boolean and n=0) or jsonb_array_length(p->'items')>100
 then raise exception 'Photo requirement limits exceeded' using errcode='22023'; end if;
 for i in select value from jsonb_array_elements(p->'items') loop
 if jsonb_typeof(i)<>'object' then raise exception 'Invalid photo item' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(i) t(k) where t.k not in ('id','label','enabled','minimum','instruction','stage','framing','order'))
 or jsonb_typeof(i->'id') is distinct from 'string' or jsonb_typeof(i->'label') is distinct from 'string'
 or jsonb_typeof(i->'enabled') is distinct from 'boolean' or jsonb_typeof(i->'minimum') is distinct from 'number'
 or (i->>'minimum') !~ '^(0|[1-9][0-9]{0,3})$' or jsonb_typeof(i->'order') is distinct from 'number'
 or (i->>'order') !~ '^(0|[1-9][0-9]{0,2})$' or jsonb_typeof(i->'instruction') is distinct from 'string'
 or jsonb_typeof(i->'stage') is distinct from 'string' or i->>'stage' not in ('NONE','BEFORE','DURING','AFTER')
 or jsonb_typeof(i->'framing') is distinct from 'string' or i->>'framing' not in ('NORMAL','WIDE','CLOSEUP')
 then raise exception 'Invalid photo item fields' using errcode='22023'; end if;
 id:=(i->>'id')::uuid; k:=lower(btrim(i->>'label')); n:=(i->>'minimum')::integer;
 if k='' or length(i->>'label')>100 or k='extra' or k=any(names) or id=any(ids)
 or length(i->>'instruction')>400 or n>1000 or ((i->>'enabled')::boolean and n=0)
 then raise exception 'Photo items need unique names and IDs and valid counts' using errcode='22023'; end if;
 ids:=array_append(ids,id); names:=array_append(names,k);
 if (i->>'enabled')::boolean then s:=s+n; end if;
 end loop;
 if s>5000 then raise exception 'Specified photo total exceeds 5000' using errcode='22023'; end if;
exception when invalid_text_representation then raise exception 'Invalid requirement identity' using errcode='22023';
end; $$;

create table public.photo_templates(
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete restrict,
 name text not null check(length(btrim(name)) between 1 and 100), work_type text not null,
 requirements jsonb not null, is_default boolean not null default false, active boolean not null default true,
 revision uuid not null default gen_random_uuid(), updated_at timestamptz not null default now(),
 unique(organization_id,name)
);
create unique index photo_templates_one_default_idx on public.photo_templates(organization_id,lower(work_type)) where active and is_default;
alter table public.photo_templates enable row level security;
revoke all on public.photo_templates from public,anon,authenticated;
grant select on public.photo_templates to authenticated;
grant all on public.photo_templates to service_role;
create policy photo_templates_admin_read on public.photo_templates for select to authenticated
 using(organization_id=(select private.phase4_admin_org()));

create function private.admin_save_photo_template(p_id uuid,p_name text,p_work_type text,p_requirements jsonb,p_active boolean,p_is_default boolean,p_expected_revision uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.phase4_admin_org(); t public.photo_templates%rowtype;
begin
 perform private.validate_photo_requirements(p_requirements);
 if p_id is null or p_active is null or p_is_default is null or btrim(coalesce(p_name,''))='' or length(p_name)>100
 or btrim(coalesce(p_work_type,''))='' then raise exception 'Template name and work type required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fwh.template.'||p_id::text,0));
 select * into t from public.photo_templates where id=p_id for update;
 if p_is_default and p_active then
 update public.photo_templates set is_default=false,revision=gen_random_uuid(),updated_at=now()
 where organization_id=o and lower(work_type)=lower(btrim(p_work_type)) and id<>p_id and is_default;
 end if;
 if t.id is not null then
 if t.organization_id<>o then raise exception 'Template unavailable' using errcode='42501'; end if;
 if t.revision is distinct from p_expected_revision then raise exception 'Template changed. Reload and retry.' using errcode='40001'; end if;
 update public.photo_templates set name=btrim(p_name),work_type=btrim(p_work_type),requirements=p_requirements,
 active=p_active,is_default=p_is_default and p_active,revision=gen_random_uuid(),updated_at=now() where id=p_id returning * into t;
 else
 if p_expected_revision is not null then raise exception 'Template unavailable' using errcode='40001'; end if;
 insert into public.photo_templates(id,organization_id,name,work_type,requirements,active,is_default)
 values(p_id,o,btrim(p_name),btrim(p_work_type),p_requirements,p_active,p_is_default and p_active) returning * into t;
 end if;
 return to_jsonb(t);
end; $$;

create function private.admin_set_photo_requirements(p_work_order_id uuid,p_expected_revision uuid,p_requirements jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.phase4_admin_org(); w public.work_orders%rowtype; old jsonb; v_next jsonb;
begin
 perform private.validate_photo_requirements(p_requirements);
 select * into w from public.work_orders where id=p_work_order_id for update;
 if not found or w.organization_id<>o then raise exception 'Work order unavailable' using errcode='42501'; end if;
 select requirement_snapshot into old from public.work_order_runs where id=w.current_run_id;
 if nullif(old->>'revision','')::uuid is distinct from p_expected_revision then
 raise exception 'Requirements changed. Reload and retry.' using errcode='40001'; end if;
 if old-'revision'=p_requirements-'revision' then return old; end if;
 if w.field_status<>'ASSIGNED' or w.started_at is not null
 or exists(select 1 from public.field_actions where run_id=w.current_run_id and action_kind='START') then
 raise exception 'Photo requirements are frozen after Start' using errcode='22023'; end if;
 v_next:=jsonb_set(p_requirements,'{revision}',to_jsonb(gen_random_uuid()::text));
 update public.work_order_runs set requirement_snapshot=v_next where id=w.current_run_id;
 return v_next;
end; $$;

-- Defence against privileged legacy mutations changing a started snapshot.
create function private.protect_photo_requirements() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.requirement_snapshot is distinct from old.requirement_snapshot then
 if old.started_at is not null or old.field_status<>'ASSIGNED'
 or exists(select 1 from public.field_actions where run_id=old.id and action_kind='START') then
 raise exception 'Started requirements are immutable' using errcode='22023'; end if;
 if new.requirement_snapshot<>'{}'::jsonb then perform private.validate_photo_requirements(new.requirement_snapshot); end if;
 end if;
 return new;
end; $$;
create trigger work_order_runs_protect_requirements before update on public.work_order_runs
for each row execute function private.protect_photo_requirements();

alter table public.field_actions add column requirement_revision uuid, add column finish_set_id uuid, add column finish_digest text not null default '';
create table public.photo_finish_sets(
 id uuid primary key, actor_user_id uuid not null references auth.users(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 run_id uuid not null, assignment_instance_id uuid not null, requirement_revision uuid,
 photos jsonb not null check(jsonb_typeof(photos)='array'), digest text not null check(digest ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
 unique(run_id,assignment_instance_id),
 foreign key(run_id,work_order_id) references public.work_order_runs(id,work_order_id) on delete restrict,
 foreign key(assignment_instance_id,run_id) references public.work_order_assignments(id,run_id) on delete restrict
);
create index photo_finish_sets_actor_org_idx on public.photo_finish_sets(actor_user_id,organization_id);
create index photo_finish_sets_org_idx on public.photo_finish_sets(organization_id);
create index photo_finish_sets_wo_idx on public.photo_finish_sets(work_order_id);
create index photo_finish_sets_run_wo_idx on public.photo_finish_sets(run_id,work_order_id);
create index photo_finish_sets_assignment_run_idx on public.photo_finish_sets(assignment_instance_id,run_id);
alter table public.photo_finish_sets enable row level security;
revoke all on public.photo_finish_sets from public,anon,authenticated;
grant select on public.photo_finish_sets to authenticated;
grant all on public.photo_finish_sets to service_role;
create policy photo_finish_sets_read on public.photo_finish_sets for select to authenticated using(
 organization_id=nullif((select auth.jwt()->'app_metadata'->>'organization_id'),'')::uuid
 and (actor_user_id=(select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role')='ADMIN'));
alter table public.photos add column requirement_item_id uuid, add column requirement_revision uuid,
 add column finish_set_id uuid references public.photo_finish_sets(id) on delete restrict,
 add column assignment_instance_id uuid;
create index photos_finish_set_idx on public.photos(finish_set_id);

-- Configured runs can insert metadata only through the validated frozen set RPC.
drop policy photos_contractor_insert_waiting on public.photos;
create policy photos_contractor_insert_waiting on public.photos for insert to authenticated with check(
 captured_by=(select auth.uid()) and sync_status='WAITING' and remote_file_id is null and uploaded_at is null
 and finish_set_id is null and requirement_item_id is null and requirement_revision is null and assignment_instance_id is null
 and exists(select 1 from public.work_orders w join public.work_order_runs r on r.id=w.current_run_id
 where w.id=photos.work_order_id and r.id=photos.run_id and r.requirement_snapshot='{}'::jsonb
 and w.organization_id=nullif((select auth.jwt()->'app_metadata'->>'organization_id'),'')::uuid
 and w.assigned_user_id=(select auth.uid()) and w.field_status<>'CANCELLED'));

create function private.phase4_conflict(p_id uuid,p_reason text) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('action_id',p_id,'outcome','CONFLICT','reason',p_reason);
$$;

-- Preserve the established legacy acceptance engine; its helper is not client callable.
alter function private.accept_field_action(uuid,uuid,uuid,uuid,text,text) rename to accept_field_action_legacy_v3;
revoke all on function private.accept_field_action_legacy_v3(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
create function private.accept_field_action(p_action_id uuid,p_work_order_id uuid,p_run_id uuid,p_assignment_instance_id uuid,p_action_kind text,p_event_time text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
 if auth.jwt()->'app_metadata'->>'role' is distinct from 'CONTRACTOR'
 or not private.is_assignable_contractor(auth.uid(),nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid)
 then raise exception 'Contractor authorization required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fwh.action.'||p_action_id::text,0));
 if exists(select 1 from public.field_actions where action_id=p_action_id and requirement_revision is null and finish_set_id is null) then
 return private.accept_field_action_legacy_v3(p_action_id,p_work_order_id,p_run_id,p_assignment_instance_id,p_action_kind,p_event_time); end if;
 perform 1 from public.work_orders where id=p_work_order_id for update;
 select requirement_snapshot into s from public.work_order_runs where id=p_run_id;
 if s is distinct from '{}'::jsonb then return private.phase4_conflict(p_action_id,'UPDATE_REQUIRED'); end if;
 return private.accept_field_action_legacy_v3(p_action_id,p_work_order_id,p_run_id,p_assignment_instance_id,p_action_kind,p_event_time);
end; $$;

create function private.accept_field_action_v4(p_action_id uuid,p_work_order_id uuid,p_run_id uuid,p_assignment_instance_id uuid,p_action_kind text,p_event_time text,p_requirement_revision uuid,p_finish_set_id uuid,p_finish_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; old public.field_actions%rowtype; result jsonb; v_event timestamptz;
begin
 if auth.jwt()->'app_metadata'->>'role' is distinct from 'CONTRACTOR'
 or not private.is_assignable_contractor(auth.uid(),nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid)
 then raise exception 'Contractor authorization required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fwh.action.'||p_action_id::text,0));
 select * into old from public.field_actions where action_id=p_action_id;
 if found then
 if old.requirement_revision is distinct from p_requirement_revision or old.finish_set_id is distinct from p_finish_set_id or old.finish_digest is distinct from p_finish_digest then
 return private.phase4_conflict(p_action_id,'ACTION_PAYLOAD_MISMATCH'); end if;
 return private.accept_field_action_legacy_v3(p_action_id,p_work_order_id,p_run_id,p_assignment_instance_id,p_action_kind,p_event_time);
 end if;
 perform 1 from public.work_orders where id=p_work_order_id for update;
 select requirement_snapshot into s from public.work_order_runs where id=p_run_id and work_order_id=p_work_order_id;
 if s is null or nullif(s->>'revision','')::uuid is distinct from p_requirement_revision then
 return private.phase4_conflict(p_action_id,'REQUIREMENTS_CHANGED'); end if;
 if s<>'{}'::jsonb then perform private.validate_photo_requirements(s); end if;
 if p_finish_digest is null or (p_action_kind='START' and (p_finish_set_id is not null or p_finish_digest<>'')) then return private.phase4_conflict(p_action_id,'INVALID_ACTION'); end if;
 if p_action_kind='COMPLETE' and (s<>'{}'::jsonb or p_finish_set_id is not null) and not exists(
 select 1 from public.photo_finish_sets f where f.id=p_finish_set_id and f.actor_user_id=auth.uid()
 and f.work_order_id=p_work_order_id and f.run_id=p_run_id and f.assignment_instance_id=p_assignment_instance_id
 and f.requirement_revision is not distinct from p_requirement_revision and f.digest=p_finish_digest) then
 return private.phase4_conflict(p_action_id,'PHOTO_SET_REQUIRED'); end if;
 if p_action_kind='COMPLETE' and p_finish_set_id is not null then
 begin v_event:=p_event_time::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then return private.phase4_conflict(p_action_id,'INVALID_TIME'); end;
 if v_event is null or exists(select 1 from public.photo_finish_sets f,jsonb_array_elements(f.photos) p
 where f.id=p_finish_set_id and (p->>'captured_at')::timestamptz>v_event) then
 return private.phase4_conflict(p_action_id,'FINISH_BEFORE_PHOTO'); end if;
 end if;
 result:=private.accept_field_action_legacy_v3(p_action_id,p_work_order_id,p_run_id,p_assignment_instance_id,p_action_kind,p_event_time);
 if result->>'outcome'<>'CONFLICT' then
 update public.field_actions set requirement_revision=p_requirement_revision,finish_set_id=p_finish_set_id,finish_digest=p_finish_digest where action_id=p_action_id;
 end if;
 return result;
end; $$;

create function private.register_photo_finish_set(p_set_id uuid,p_work_order_id uuid,p_run_id uuid,p_assignment_instance_id uuid,p_requirement_revision uuid,p_photos jsonb,p_digest text,p_payload text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o uuid:=nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid;
 w public.work_orders%rowtype; old public.photo_finish_sets%rowtype; s jsonb; p jsonb; i jsonb;
 ids uuid[]:='{}'; v_photo_id uuid; item uuid; captured timestamptz; n integer; reason text;
begin
 if auth.jwt()->'app_metadata'->>'role' is distinct from 'CONTRACTOR' or not private.is_assignable_contractor(u,o)
 then raise exception 'Contractor authorization required' using errcode='42501'; end if;
 if p_digest is null or p_payload is null or length(p_payload)>2000000 or p_digest is distinct from encode(sha256(convert_to(p_payload,'UTF8')),'hex')
 or p_payload::jsonb is distinct from p_photos then return private.phase4_conflict(p_set_id,'PHOTO_SET_DIGEST_MISMATCH'); end if;
 if p_set_id is null or p_photos is null or jsonb_typeof(p_photos)<>'array' or jsonb_array_length(p_photos)>5000
 then return private.phase4_conflict(p_set_id,'INVALID_PHOTO_SET'); end if;
 perform pg_advisory_xact_lock(hashtextextended('fwh.photo-set.'||p_set_id::text,0));
 select * into old from public.photo_finish_sets where id=p_set_id;
 if found then
 if old.actor_user_id is distinct from u or old.organization_id is distinct from o
 or old.work_order_id is distinct from p_work_order_id or old.run_id is distinct from p_run_id
 or old.assignment_instance_id is distinct from p_assignment_instance_id
 or old.requirement_revision is distinct from p_requirement_revision or old.photos is distinct from p_photos or old.digest is distinct from p_digest then
 return private.phase4_conflict(p_set_id,'PHOTO_SET_PAYLOAD_MISMATCH'); end if;
 return jsonb_build_object('outcome','ALREADY_APPLIED','set_id',p_set_id);
 end if;
 select * into w from public.work_orders where id=p_work_order_id for update;
 if not found or w.organization_id is distinct from o or w.assigned_user_id is distinct from u
 or w.current_run_id is distinct from p_run_id or w.field_status<>'IN_PROGRESS' then
 return private.phase4_conflict(p_set_id,'ASSIGNMENT_UNAVAILABLE'); end if;
 if not exists(select 1 from public.work_order_assignments a where a.id=p_assignment_instance_id
 and a.run_id=p_run_id and a.assigned_user_id=u and a.organization_id=o and a.assignment_ended_at is null) then
 return private.phase4_conflict(p_set_id,'ASSIGNMENT_CHANGED'); end if;
 select requirement_snapshot into s from public.work_order_runs where id=p_run_id;
 if nullif(s->>'revision','')::uuid is distinct from p_requirement_revision then
 return private.phase4_conflict(p_set_id,'REQUIREMENTS_CHANGED'); end if;
 if s<>'{}'::jsonb then perform private.validate_photo_requirements(s); end if;
 if not exists(select 1 from public.field_actions a where a.run_id=p_run_id and a.assignment_instance_id=p_assignment_instance_id
 and a.actor_user_id=u and a.action_kind='START' and a.requirement_revision is not distinct from p_requirement_revision) then
 return private.phase4_conflict(p_set_id,'START_REQUIRED'); end if;
 if exists(select 1 from public.photo_finish_sets where run_id=p_run_id and assignment_instance_id=p_assignment_instance_id) then
 return private.phase4_conflict(p_set_id,'PHOTO_SET_ALREADY_FROZEN'); end if;
 for p in select value from jsonb_array_elements(p_photos) loop
 if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) t(k) where t.k not in ('id','item_id','captured_at'))
 or jsonb_typeof(p->'id') is distinct from 'string' or jsonb_typeof(p->'captured_at') is distinct from 'string'
 or not(p ? 'item_id') or (jsonb_typeof(p->'item_id') not in ('string','null')) then
 return private.phase4_conflict(p_set_id,'INVALID_PHOTO_METADATA'); end if;
 v_photo_id:=(p->>'id')::uuid; item:=nullif(p->>'item_id','')::uuid; captured:=(p->>'captured_at')::timestamptz;
 if v_photo_id=any(ids) or not isfinite(captured) or captured>w.started_at+interval '100 years'
 or captured>now()+interval '5 minutes' or captured<w.started_at then
 return private.phase4_conflict(p_set_id,'INVALID_PHOTO_METADATA'); end if;
 ids:=array_append(ids,v_photo_id);
 if item is not null and not exists(select 1 from jsonb_array_elements(coalesce(s->'items','[]')) r
 where (r->>'id')::uuid=item and (r->>'enabled')::boolean) then
 return private.phase4_conflict(p_set_id,'INVALID_PHOTO_ITEM'); end if;
 if exists(select 1 from public.photos where photos.id=v_photo_id) then return private.phase4_conflict(p_set_id,'PHOTO_ID_COLLISION'); end if;
 end loop;
 if coalesce((s->'total'->>'enabled')::boolean,false) and jsonb_array_length(p_photos)<(s->'total'->>'minimum')::integer then
 return private.phase4_conflict(p_set_id,'PHOTO_REQUIREMENTS_UNMET'); end if;
 for i in select value from jsonb_array_elements(coalesce(s->'items','[]')) loop
 if (i->>'enabled')::boolean then
 select count(*) into n from jsonb_array_elements(p_photos) r where r->>'item_id'=i->>'id';
 if n<(i->>'minimum')::integer then return private.phase4_conflict(p_set_id,'PHOTO_REQUIREMENTS_UNMET'); end if;
 end if;
 end loop;
 insert into public.photo_finish_sets(id,actor_user_id,organization_id,work_order_id,run_id,assignment_instance_id,requirement_revision,photos,digest)
 values(p_set_id,u,o,p_work_order_id,p_run_id,p_assignment_instance_id,p_requirement_revision,p_photos,p_digest);
 insert into public.photos(id,work_order_id,run_id,captured_by,captured_at,requirement_item_id,requirement_revision,finish_set_id,assignment_instance_id)
 select (r->>'id')::uuid,p_work_order_id,p_run_id,u,(r->>'captured_at')::timestamptz,
 nullif(r->>'item_id','')::uuid,p_requirement_revision,p_set_id,p_assignment_instance_id from jsonb_array_elements(p_photos) r;
 return jsonb_build_object('outcome','APPLIED','set_id',p_set_id);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 return private.phase4_conflict(p_set_id,'INVALID_PHOTO_METADATA');
end; $$;

create function private.admin_create_work_order_v4(p_generate_wo_number boolean,p_wo_number text,p_property_address text,p_work_type text,p_instructions text,p_due_date date,p_assigned_user_id uuid,p_requirements jsonb)
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare c record;
begin
 perform private.phase4_admin_org(); perform private.validate_photo_requirements(p_requirements);
 for c in select * from private.admin_create_work_order(p_generate_wo_number,p_wo_number,p_property_address,p_work_type,p_instructions,p_due_date,p_assigned_user_id) loop
 perform private.admin_set_photo_requirements(c.work_order_id,null,p_requirements);
 return next to_jsonb(c);
 end loop;
end; $$;
create function private.admin_update_work_order_v4(p_work_order_id uuid,p_wo_number text,p_property_address text,p_work_type text,p_instructions text,p_due_date date,p_assigned_user_id uuid,p_expected_revision uuid,p_requirements jsonb)
returns setof jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.phase4_admin_org();
 -- One transaction and one WO lock; no half-saved general edit and requirements.
 if p_requirements is not null then perform private.admin_set_photo_requirements(p_work_order_id,p_expected_revision,p_requirements); end if;
 return query select to_jsonb(c) from private.admin_update_work_order(p_work_order_id,p_wo_number,p_property_address,p_work_type,p_instructions,p_due_date,p_assigned_user_id) c;
end; $$;

DO $parity$ BEGIN IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.acknowledge_assignment_received(uuid)'::regprocedure)) <> '1e59fba5e3c8b4154c6c20e0b6bd2e48' THEN RAISE EXCEPTION 'Mutation source drift: acknowledge_assignment_received'; END IF; END $parity$;
create or replace function private.acknowledge_assignment_received(p_work_order_id uuid)
returns table (
  work_order_id uuid,
  assignment_received_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_row public.work_orders%rowtype;
begin
  if v_role='ADMIN' then perform private.phase4_admin_org();
  elsif v_role='CONTRACTOR' and not private.is_assignable_contractor(v_uid,v_org) then
    raise exception 'Active Contractor required' using errcode='42501'; end if;
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_role not in ('ADMIN', 'CONTRACTOR') or v_org is null then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select * into v_row
  from public.work_orders
  where id = p_work_order_id for update;

  if not found
     or v_row.organization_id is distinct from v_org
     or v_row.assigned_user_id is distinct from v_uid then
    raise exception 'Work order not available to this user' using errcode = '42501';
  end if;

  if v_row.field_status = 'CANCELLED' then
    raise exception 'Cancelled work order cannot be acknowledged' using errcode = '22023';
  end if;

  if v_row.assignment_received_at is null then
    update public.work_orders
       set assignment_received_at = now()
     where id = p_work_order_id
     returning * into v_row;
  end if;

  return query
  select v_row.id, v_row.assignment_received_at;
end;
$$;

DO $parity$ BEGIN IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.admin_update_work_order(uuid,text,text,text,text,date,uuid)'::regprocedure)) <> 'b929f713660a285eabce308658c48dda' THEN RAISE EXCEPTION 'Mutation source drift: admin_update_work_order'; END IF; END $parity$;
create or replace function private.admin_update_work_order(
  p_work_order_id uuid,
  p_wo_number text,
  p_property_address text,
  p_work_type text,
  p_instructions text,
  p_due_date date,
  p_assigned_user_id uuid
)
returns table (
  work_order_id uuid,
  organization_id uuid,
  assigned_user_id uuid,
  pending_assignee_user_id uuid,
  reassignment_requested_at timestamptz,
  wo_number text,
  property_address text,
  work_type text,
  instructions text,
  due_date date,
  field_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_row public.work_orders%rowtype;
  v_assignment_changed boolean;
begin
  if v_role='ADMIN' then perform private.phase4_admin_org();
  elsif v_role='CONTRACTOR' and not private.is_assignable_contractor(v_uid,v_org) then
    raise exception 'Active Contractor required' using errcode='42501'; end if;
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_role <> 'ADMIN' or v_org is null then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;

  select * into v_row
  from public.work_orders
  where id = p_work_order_id for update;

  if not found or v_row.organization_id is distinct from v_org then
    raise exception 'Work order not available to this Admin' using errcode = '42501';
  end if;

  if btrim(coalesce(p_wo_number, '')) = ''
     or btrim(coalesce(p_property_address, '')) = ''
     or btrim(coalesce(p_work_type, '')) = ''
     or p_due_date is null
     or p_assigned_user_id is null then
    raise exception 'Required work-order field is missing' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = p_assigned_user_id
      and u.deleted_at is null
      and u.raw_app_meta_data ->> 'organization_id' = v_org::text
      and u.raw_app_meta_data ->> 'role' = 'CONTRACTOR'
  ) then
    raise exception 'Assignee is not an active Contractor in this organization' using errcode = '42501';
  end if;

  v_assignment_changed := p_assigned_user_id is distinct from v_row.assigned_user_id;

  if v_row.field_status = 'ASSIGNED' then
    update public.work_orders
       set wo_number = btrim(p_wo_number),
           property_address = btrim(p_property_address),
           work_type = btrim(p_work_type),
           instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
           due_date = p_due_date,
           assigned_user_id = p_assigned_user_id,
           assignment_received_at = case when v_assignment_changed then null else assignment_received_at end,
           pending_assignee_user_id = null,
           reassignment_requested_at = null
     where id = p_work_order_id
     returning * into v_row;
  elsif v_row.field_status = 'IN_PROGRESS' then
    update public.work_orders
       set wo_number = btrim(p_wo_number),
           property_address = btrim(p_property_address),
           work_type = btrim(p_work_type),
           instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
           due_date = p_due_date,
           pending_assignee_user_id = case when v_assignment_changed then p_assigned_user_id else null end,
           reassignment_requested_at = case when v_assignment_changed then now() else null end
     where id = p_work_order_id
     returning * into v_row;
  elsif v_row.field_status in ('FIELD_COMPLETE', 'CANCELLED') then
    if v_assignment_changed then
      raise exception 'Completed or cancelled work cannot be reassigned' using errcode = '22023';
    end if;

    update public.work_orders
       set wo_number = btrim(p_wo_number),
           property_address = btrim(p_property_address),
           work_type = btrim(p_work_type),
           instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
           due_date = p_due_date,
           pending_assignee_user_id = null,
           reassignment_requested_at = null
     where id = p_work_order_id
     returning * into v_row;
  else
    raise exception 'Invalid work order state' using errcode = '22023';
  end if;

  return query
  select
    v_row.id,
    v_row.organization_id,
    v_row.assigned_user_id,
    v_row.pending_assignee_user_id,
    v_row.reassignment_requested_at,
    v_row.wo_number,
    v_row.property_address,
    v_row.work_type,
    v_row.instructions,
    v_row.due_date,
    v_row.field_status,
    v_row.updated_at;
end;
$$;

DO $parity$ BEGIN IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.complete_field_work(uuid)'::regprocedure)) <> 'bba93ca55c6249b86061a72c3ec466bb' THEN RAISE EXCEPTION 'Mutation source drift: complete_field_work'; END IF; END $parity$;
create or replace function private.complete_field_work(p_work_order_id uuid)
returns table (
  work_order_id uuid,
  field_status text,
  started_at timestamptz,
  field_completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_row public.work_orders%rowtype;
begin
  if v_role='ADMIN' then perform private.phase4_admin_org();
  elsif v_role='CONTRACTOR' and not private.is_assignable_contractor(v_uid,v_org) then
    raise exception 'Active Contractor required' using errcode='42501'; end if;
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_role not in ('ADMIN', 'CONTRACTOR') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select wo.* into v_row
  from public.work_orders as wo
  where wo.id = p_work_order_id for update;

  if not found
     or v_row.organization_id is distinct from v_org
     or v_row.assigned_user_id is distinct from v_uid then
    raise exception 'Work order not available to this user' using errcode = '42501';
  end if;

  if exists(select 1 from public.work_order_runs where id=v_row.current_run_id and requirement_snapshot<>'{}'::jsonb) then
    raise exception 'Update the app to use configured photo requirements' using errcode='22023'; end if;

  if v_row.field_status = 'IN_PROGRESS' then
    update public.work_orders as wo
       set field_status = 'FIELD_COMPLETE',
           field_completed_at = coalesce(wo.field_completed_at, now()),
           pending_assignee_user_id = null,
           reassignment_requested_at = null
     where wo.id = p_work_order_id
     returning wo.* into v_row;
  elsif v_row.field_status = 'FIELD_COMPLETE' then
    null;
  elsif v_row.field_status = 'ASSIGNED' then
    raise exception 'Work order must be started before field completion' using errcode = '22023';
  elsif v_row.field_status = 'CANCELLED' then
    raise exception 'Cancelled work order cannot be completed' using errcode = '22023';
  else
    raise exception 'Invalid work order state' using errcode = '22023';
  end if;

  return query
  select v_row.id, v_row.field_status, v_row.started_at, v_row.field_completed_at;
end;
$$;

DO $parity$ BEGIN IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.respond_reassignment(uuid,boolean)'::regprocedure)) <> '4a4c7c28c526a650fe2d43125699d63d' THEN RAISE EXCEPTION 'Mutation source drift: respond_reassignment'; END IF; END $parity$;
create or replace function private.respond_reassignment(
  p_work_order_id uuid,
  p_accept boolean
)
returns table (
  work_order_id uuid,
  accepted boolean,
  assigned_user_id uuid,
  field_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_row public.work_orders%rowtype;
begin
  if v_role='ADMIN' then perform private.phase4_admin_org();
  elsif v_role='CONTRACTOR' and not private.is_assignable_contractor(v_uid,v_org) then
    raise exception 'Active Contractor required' using errcode='42501'; end if;
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_role not in ('ADMIN', 'CONTRACTOR') or v_org is null then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select * into v_row
  from public.work_orders
  where id = p_work_order_id for update;

  if not found
     or v_row.organization_id is distinct from v_org
     or v_row.assigned_user_id is distinct from v_uid then
    raise exception 'Work order not available to this user' using errcode = '42501';
  end if;

  if v_row.field_status <> 'IN_PROGRESS' then
    raise exception 'Reassignment consent is only available while work is in progress' using errcode = '22023';
  end if;

  if p_accept and exists(select 1 from public.photos p where p.run_id=v_row.current_run_id and p.sync_status<>'UPLOADED') then
    raise exception 'Saved photos are awaiting delivery. Contact Admin before handing off.' using errcode='22023'; end if;

  if v_row.pending_assignee_user_id is null then
    raise exception 'No reassignment request is pending' using errcode = '22023';
  end if;

  if p_accept then
    if not exists (
      select 1
      from auth.users u
      where u.id = v_row.pending_assignee_user_id
        and u.deleted_at is null
        and u.raw_app_meta_data ->> 'organization_id' = v_org::text
        and u.raw_app_meta_data ->> 'role' = 'CONTRACTOR'
    ) then
      raise exception 'Proposed assignee is no longer an active Contractor' using errcode = '42501';
    end if;

    update public.work_orders
       set assigned_user_id = pending_assignee_user_id,
           assignment_received_at = null,
           pending_assignee_user_id = null,
           reassignment_requested_at = null
     where id = p_work_order_id
     returning * into v_row;
  else
    update public.work_orders
       set pending_assignee_user_id = null,
           reassignment_requested_at = null
     where id = p_work_order_id
     returning * into v_row;
  end if;

  return query
  select v_row.id, p_accept, v_row.assigned_user_id, v_row.field_status;
end;
$$;

DO $parity$ BEGIN IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.start_work(uuid)'::regprocedure)) <> 'affe7742e5a127ed47bf85796a059bf3' THEN RAISE EXCEPTION 'Mutation source drift: start_work'; END IF; END $parity$;
create or replace function private.start_work(p_work_order_id uuid)
returns table (
  work_order_id uuid,
  field_status text,
  started_at timestamptz,
  field_completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_row public.work_orders%rowtype;
begin
  if v_role='ADMIN' then perform private.phase4_admin_org();
  elsif v_role='CONTRACTOR' and not private.is_assignable_contractor(v_uid,v_org) then
    raise exception 'Active Contractor required' using errcode='42501'; end if;
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_role not in ('ADMIN', 'CONTRACTOR') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select wo.* into v_row
  from public.work_orders as wo
  where wo.id = p_work_order_id for update;

  if not found
     or v_row.organization_id is distinct from v_org
     or v_row.assigned_user_id is distinct from v_uid then
    raise exception 'Work order not available to this user' using errcode = '42501';
  end if;

  if exists(select 1 from public.work_order_runs where id=v_row.current_run_id and requirement_snapshot<>'{}'::jsonb) then
    raise exception 'Update the app to use configured photo requirements' using errcode='22023'; end if;

  if v_row.field_status = 'ASSIGNED' then
    update public.work_orders as wo
       set field_status = 'IN_PROGRESS',
           started_at = coalesce(wo.started_at, now())
     where wo.id = p_work_order_id
     returning wo.* into v_row;
  elsif v_row.field_status in ('IN_PROGRESS', 'FIELD_COMPLETE') then
    null;
  elsif v_row.field_status = 'CANCELLED' then
    raise exception 'Cancelled work order cannot be started' using errcode = '22023';
  else
    raise exception 'Invalid work order state' using errcode = '22023';
  end if;

  return query
  select v_row.id, v_row.field_status, v_row.started_at, v_row.field_completed_at;
end;
$$;

create or replace function private.field_assignments()
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare
 v_uid uuid:=auth.uid();
 v_org uuid:=nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid;
 v_role text:=auth.jwt()->'app_metadata'->>'role';
begin
 if v_uid is null or v_org is null or v_role is null or v_role not in ('CONTRACTOR','ADMIN') or not exists(
 select 1 from auth.users u where u.id=v_uid and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=now())
 and u.raw_app_meta_data->>'organization_id'=v_org::text and u.raw_app_meta_data->>'role'=v_role
 ) then raise exception 'Authentication required' using errcode='42501'; end if;
 if v_role='CONTRACTOR' and not private.is_assignable_contractor(v_uid,v_org) then
 raise exception 'Contractor authorization required' using errcode='42501'; end if;
 return query select to_jsonb(w)||jsonb_build_object('assignment_instance_id',a.id,'requirement_snapshot',r.requirement_snapshot)
 from public.work_orders w join public.work_order_runs r on r.id=w.current_run_id left join lateral (
 select h.id from public.work_order_assignments h
 where h.run_id=w.current_run_id and h.assigned_user_id=w.assigned_user_id
 and (h.assignment_ended_at is null or (w.field_status='FIELD_COMPLETE' and h.end_reason='FIELD_COMPLETE'))
 order by h.assignment_started_at desc,h.created_at desc limit 1
 ) a on true
 where w.organization_id=v_org and (v_role='ADMIN' or w.assigned_user_id=v_uid)
 order by w.due_date,w.wo_number;
end; $$;

create function public.admin_save_photo_template(p_id uuid,p_name text,p_work_type text,p_requirements jsonb,p_active boolean,p_is_default boolean,p_expected_revision uuid) returns jsonb language sql security invoker set search_path='' as $$select * from private.admin_save_photo_template(p_id,p_name,p_work_type,p_requirements,p_active,p_is_default,p_expected_revision);$$;
revoke all on function private.admin_save_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid) from public,anon,authenticated;
grant execute on function private.admin_save_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid) to authenticated,service_role;
revoke all on function public.admin_save_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid) from public,anon,authenticated;
grant execute on function public.admin_save_photo_template(uuid,text,text,jsonb,boolean,boolean,uuid) to authenticated,service_role;

create function public.admin_set_photo_requirements(p_work_order_id uuid,p_expected_revision uuid,p_requirements jsonb) returns jsonb language sql security invoker set search_path='' as $$select * from private.admin_set_photo_requirements(p_work_order_id,p_expected_revision,p_requirements);$$;
revoke all on function private.admin_set_photo_requirements(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_set_photo_requirements(uuid,uuid,jsonb) to authenticated,service_role;
revoke all on function public.admin_set_photo_requirements(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_set_photo_requirements(uuid,uuid,jsonb) to authenticated,service_role;

create function public.admin_create_work_order_v4(p_generate_wo_number boolean,p_wo_number text,p_property_address text,p_work_type text,p_instructions text,p_due_date date,p_assigned_user_id uuid,p_requirements jsonb) returns setof jsonb language sql security invoker set search_path='' as $$select * from private.admin_create_work_order_v4(p_generate_wo_number,p_wo_number,p_property_address,p_work_type,p_instructions,p_due_date,p_assigned_user_id,p_requirements);$$;
revoke all on function private.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb) to authenticated,service_role;
revoke all on function public.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_create_work_order_v4(boolean,text,text,text,text,date,uuid,jsonb) to authenticated,service_role;

create function public.admin_update_work_order_v4(p_work_order_id uuid,p_wo_number text,p_property_address text,p_work_type text,p_instructions text,p_due_date date,p_assigned_user_id uuid,p_expected_revision uuid,p_requirements jsonb) returns setof jsonb language sql security invoker set search_path='' as $$select * from private.admin_update_work_order_v4(p_work_order_id,p_wo_number,p_property_address,p_work_type,p_instructions,p_due_date,p_assigned_user_id,p_expected_revision,p_requirements);$$;
revoke all on function private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb) to authenticated,service_role;
revoke all on function public.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb) to authenticated,service_role;

create function public.accept_field_action_v4(p_action_id uuid,p_work_order_id uuid,p_run_id uuid,p_assignment_instance_id uuid,p_action_kind text,p_event_time text,p_requirement_revision uuid,p_finish_set_id uuid,p_finish_digest text) returns jsonb language sql security invoker set search_path='' as $$select * from private.accept_field_action_v4(p_action_id,p_work_order_id,p_run_id,p_assignment_instance_id,p_action_kind,p_event_time,p_requirement_revision,p_finish_set_id,p_finish_digest);$$;
revoke all on function private.accept_field_action_v4(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.accept_field_action_v4(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text) to authenticated,service_role;
revoke all on function public.accept_field_action_v4(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_field_action_v4(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text) to authenticated,service_role;

create function public.register_photo_finish_set(p_set_id uuid,p_work_order_id uuid,p_run_id uuid,p_assignment_instance_id uuid,p_requirement_revision uuid,p_photos jsonb,p_digest text,p_payload text) returns jsonb language sql security invoker set search_path='' as $$select * from private.register_photo_finish_set(p_set_id,p_work_order_id,p_run_id,p_assignment_instance_id,p_requirement_revision,p_photos,p_digest,p_payload);$$;
revoke all on function private.register_photo_finish_set(uuid,uuid,uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.register_photo_finish_set(uuid,uuid,uuid,uuid,uuid,jsonb,text,text) to authenticated,service_role;
revoke all on function public.register_photo_finish_set(uuid,uuid,uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.register_photo_finish_set(uuid,uuid,uuid,uuid,uuid,jsonb,text,text) to authenticated,service_role;
revoke all on function private.validate_photo_requirements(jsonb) from public,anon,authenticated;
revoke all on function private.protect_photo_requirements() from public,anon,authenticated;
revoke all on function private.phase4_conflict(uuid,text) from public,anon,authenticated;
revoke all on function private.phase4_admin_org() from public,anon;
grant execute on function private.phase4_admin_org() to authenticated,service_role;
revoke all on function private.accept_field_action(uuid,uuid,uuid,uuid,text,text) from public,anon;
grant execute on function private.accept_field_action(uuid,uuid,uuid,uuid,text,text) to authenticated,service_role;
