-- Phase 5D, unapplied source only: one-shot package folder identity and recovery.
-- Requires VERIFIED client root -> ADDRESS -> permanent WO before PACKAGE.
-- Never creates an external Drive object or enables delivery by itself.
create table private.client_delivery_package_folder_attempts (
 file_plan_id uuid primary key references private.client_delivery_file_plans(id) on delete restrict,
 package_id uuid not null references private.client_packages(id) on delete restrict,
 attempted_at timestamptz not null default clock_timestamp(),
 verified_at timestamptz,
 remote_evidence jsonb,
 check ((verified_at is null and remote_evidence is null)
     or (verified_at is not null and jsonb_typeof(remote_evidence)='object'))
);
alter table private.client_delivery_package_folder_attempts enable row level security;
revoke all on private.client_delivery_package_folder_attempts from public,anon,authenticated,service_role;
grant select on private.client_delivery_package_folder_attempts to service_role;

-- Authenticated worker lease and saved file-plan identity are rechecked on
-- every attempt/GET/confirmation. No user-supplied folder ID is authoritative.
create function private.service_delivery_package_folder_guard(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns private.client_delivery_file_plans language plpgsql security definer
set search_path='' set lock_timeout='5s' as $guard$
declare
 k private.client_packages%rowtype;
 o private.client_delivery_outbox%rowtype;
 f private.client_delivery_file_plans%rowtype;
 w private.client_delivery_parent_maps%rowtype;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into k from private.client_packages where id=p_package;
 select * into o from private.client_delivery_outbox where package_id=p_package;
 select * into f from private.client_delivery_file_plans
  where id=p_plan and package_id=p_package and kind='FOLDER' and photo_id is null for update;
 if k.id is null or o.package_id is null or f.id is null or k.status<>'DELIVERING'
    or k.approved_sha256 is distinct from o.approved_sha256
    or k.destination_id is distinct from o.destination_id
    or k.folder_address_key is null or k.approved_manifest is null then
   raise exception 'Exact frozen package folder required' using errcode='42501';end if;
 select * into w from private.client_delivery_parent_maps
    where kind='WORK_ORDER' and organization_id=k.organization_id
      and company_id=k.company_id and destination_id=k.destination_id
      and work_order_id=k.work_order_id and address_key=k.folder_address_key
      and state='VERIFIED';
 if w.id is null or f.drive_parent_id is distinct from w.remote_folder_id then
   raise exception 'Verified WO parent and reserved package identity required'
     using errcode='42501';end if;
 -- Repeat the complete same-client destination, address and parent chain gate.
 perform private.service_delivery_parent_guard(p_package,p_worker,p_generation,w.id);
 return f;
end;
$guard$;
revoke all on function private.service_delivery_package_folder_guard(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_delivery_package_folder_guard(uuid,uuid,bigint,uuid)
 to service_role;

create function private.service_get_delivery_folder_plan(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language plpgsql security definer set search_path='' as $plan$
declare f private.client_delivery_file_plans%rowtype;
 k private.client_packages%rowtype;
 a private.client_delivery_package_folder_attempts%rowtype;
begin
 f:=private.service_delivery_package_folder_guard(p_package,p_worker,p_generation,p_plan);
 select * into k from private.client_packages where id=p_package;
 select * into a from private.client_delivery_package_folder_attempts where file_plan_id=f.id;
 if f.state='VERIFIED' and (a.file_plan_id is null or a.verified_at is null) then
   raise exception 'Package folder missing one-shot receipt' using errcode='42501';end if;
 return jsonb_build_object('package_id',k.id,'plan_id',f.id,'kind','FOLDER',
   'parent_kind','WORK_ORDER','work_order_id',k.work_order_id,'file_id',f.drive_file_id,
   'parent_id',f.drive_parent_id,'name','package-'||k.id::text,
   'mime',f.mime_type,'sha256',f.expected_sha256,'size',f.expected_size,
   'appProperties',jsonb_build_object('fwh_package',k.id::text,
    'fwh_manifest',k.approved_sha256),
   'state',case when f.state='VERIFIED' then 'VERIFIED'
     when a.file_plan_id is null then 'PREALLOCATED' else 'ATTEMPTED' end);
end;
$plan$;
create function public.service_get_delivery_folder_plan(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_get_delivery_folder_plan(p_package,p_worker,p_generation,p_plan)
$wrap$;
revoke all on function private.service_get_delivery_folder_plan(uuid,uuid,bigint,uuid),
 public.service_get_delivery_folder_plan(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_get_delivery_folder_plan(uuid,uuid,bigint,uuid),
 public.service_get_delivery_folder_plan(uuid,uuid,bigint,uuid) to service_role;

create function private.service_begin_delivery_folder_create(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $begin$
declare f private.client_delivery_file_plans%rowtype;
 k private.client_delivery_package_folder_attempts%rowtype;
 n integer;
begin
 f:=private.service_delivery_package_folder_guard(p_package,p_worker,p_generation,p_plan);
 select * into k from private.client_delivery_package_folder_attempts where file_plan_id=f.id;
 if f.state='VERIFIED' then
   if k.file_plan_id is null or k.verified_at is null then
     raise exception 'Verified folder lacks one-shot evidence' using errcode='42501';end if;
   return jsonb_build_object('state','VERIFY_EXISTING','plan_id',f.id,
      'file_id',f.drive_file_id,'parent_id',f.drive_parent_id);
 end if;
 if f.state<>'PREALLOCATED' then
    raise exception 'Uncertain folder requires recovery' using errcode='40001';end if;
 insert into private.client_delivery_package_folder_attempts(file_plan_id,package_id)
  values(f.id,p_package) on conflict(file_plan_id) do nothing;
 get diagnostics n=row_count;
 return jsonb_build_object('state',case when n=1 then 'MAY_CREATE' else 'VERIFY_EXISTING' end,
    'plan_id',f.id,'file_id',f.drive_file_id,'parent_id',f.drive_parent_id);
end;
$begin$;
create function public.service_begin_delivery_folder_create(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_begin_delivery_folder_create(p_package,p_worker,p_generation,p_plan)
$wrap$;
revoke all on function private.service_begin_delivery_folder_create(uuid,uuid,bigint,uuid),
 public.service_begin_delivery_folder_create(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_begin_delivery_folder_create(uuid,uuid,bigint,uuid),
 public.service_begin_delivery_folder_create(uuid,uuid,bigint,uuid) to service_role;

create function private.service_confirm_delivery_folder(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid,p_proof jsonb
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $confirm$
declare f private.client_delivery_file_plans%rowtype;
 k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 a private.client_delivery_package_folder_attempts%rowtype;
 expected jsonb;
begin
 f:=private.service_delivery_package_folder_guard(p_package,p_worker,p_generation,p_plan);
 select * into k from private.client_packages where id=p_package;
 select * into d from private.client_delivery_destinations where id=k.destination_id;
 select * into a from private.client_delivery_package_folder_attempts
   where file_plan_id=p_plan for update;
 if a.file_plan_id is null or a.package_id is distinct from p_package
   or jsonb_typeof(p_proof)<>'object'
   or p_proof->>'id' is distinct from f.drive_file_id
   or p_proof->>'parent' is distinct from f.drive_parent_id
   or p_proof->>'name' is distinct from 'package-'||k.id::text
   or p_proof->>'mime' is distinct from 'application/vnd.google-apps.folder'
   or p_proof->'trashed' is distinct from 'false'::jsonb
   or p_proof->'sha256' is distinct from 'null'::jsonb
   or p_proof->'size' is distinct from 'null'::jsonb
   or nullif(d.verification_receipt->>'drive_id','') is null
   or p_proof->>'drive_id' is distinct from d.verification_receipt->>'drive_id' then
    raise exception 'Original package folder GET receipt required' using errcode='42501';end if;
 expected:=jsonb_build_object('fwh_package',k.id::text,'fwh_manifest',k.approved_sha256);
 if p_proof->'appProperties' is distinct from expected then
    raise exception 'Package folder metadata changed' using errcode='42501';end if;
 if a.verified_at is not null then
   if a.remote_evidence is distinct from p_proof or f.state<>'VERIFIED' then
     raise exception 'Package folder receipt conflict' using errcode='40001';end if;
   return jsonb_build_object('state','VERIFIED','plan_id',p_plan,'replayed',true);
 end if;
 -- A legacy service-only file receipt can precede this stronger
 -- independent Drive GET proof. Reconcile that *same* immutable ID only;
 -- never weaken the final one-shot journal gate or allocate a replacement.
 if f.state='UNCERTAIN' or f.state not in ('PREALLOCATED','VERIFIED') then
   raise exception 'Uncertain package folder cannot be confirmed' using errcode='40001';end if;
 if f.state='PREALLOCATED' then
   perform private.service_confirm_delivery_file(p_package,p_worker,p_generation,
     'FOLDER',null,f.drive_file_id,f.drive_parent_id,
     'application/vnd.google-apps.folder',null,null);
 end if;
 update private.client_delivery_package_folder_attempts
   set verified_at=clock_timestamp(),remote_evidence=p_proof where file_plan_id=p_plan;
 return jsonb_build_object('state','VERIFIED','plan_id',p_plan,'replayed',false);
end;
$confirm$;
create function public.service_confirm_delivery_folder(
 p_package uuid,p_worker uuid,p_generation bigint,p_plan uuid,p_proof jsonb
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_confirm_delivery_folder(p_package,p_worker,p_generation,p_plan,p_proof)
$wrap$;
revoke all on function private.service_confirm_delivery_folder(uuid,uuid,bigint,uuid,jsonb),
 public.service_confirm_delivery_folder(uuid,uuid,bigint,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.service_confirm_delivery_folder(uuid,uuid,bigint,uuid,jsonb),
 public.service_confirm_delivery_folder(uuid,uuid,bigint,uuid,jsonb) to service_role;
