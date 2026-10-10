-- Phase 5D: service-only *candidate* delivery fence. Existing live provider OFF.
-- This schema does not authenticate Google, deploy Edge, invoke cron, or grant browser Send.
-- Every remote ID must be generated on the trusted Drive connection then saved
-- here BEFORE making an external create/upload attempt.
alter table private.client_delivery_outbox
  add column worker_id uuid,
  add column last_heartbeat_at timestamptz,
  add column uncertain_reason text check(char_length(uncertain_reason)<=200),
  add constraint delivery_outbox_lease_complete
    check ((worker_id is null and lease_until is null)
      or (worker_id is not null and lease_until is not null));

create table private.client_delivery_file_plans (
 package_id uuid not null references private.client_packages(id) on delete restrict,
 kind text not null check(kind in ('FOLDER','PHOTO','MANIFEST')),
 photo_id uuid,
 drive_file_id text not null check(drive_file_id ~ '^[a-zA-Z0-9_-]{10,160}$'),
 drive_parent_id text not null check(drive_parent_id ~ '^[a-zA-Z0-9_-]{3,160}$'),
 expected_sha256 text check(expected_sha256 ~ '^[a-f0-9]{64}$'),
 expected_size bigint check(expected_size>=0),
 mime_type text not null check(mime_type in ('application/vnd.google-apps.folder','image/jpeg','application/json')),
 state text not null default 'PREALLOCATED' check(state in ('PREALLOCATED','VERIFIED','UNCERTAIN')),
 verified_at timestamptz,
 remote_evidence jsonb,
 created_at timestamptz not null default clock_timestamp(),
 primary key(package_id,kind,photo_id) nulls not distinct,
 unique(drive_file_id),
 check ((kind='PHOTO' and photo_id is not null and expected_sha256 is not null and expected_size>0 and mime_type='image/jpeg')
  or (kind='MANIFEST' and photo_id is null and expected_sha256 is not null and expected_size>0 and mime_type='application/json')
  or (kind='FOLDER' and photo_id is null and expected_sha256 is null and expected_size is null and mime_type='application/vnd.google-apps.folder')),
 check ((state='VERIFIED' and verified_at is not null and remote_evidence is not null)
   or (state<>'VERIFIED' and verified_at is null))
);
create index client_delivery_plan_package on private.client_delivery_file_plans(package_id,state);
create table private.client_delivery_final_receipts (
 package_id uuid primary key references private.client_packages(id) on delete restrict,
 approved_sha256 text not null check(approved_sha256 ~ '^[a-f0-9]{64}$'),
 destination_id uuid not null references private.client_delivery_destinations(id) on delete restrict,
 drive_folder_id text not null,
 files jsonb not null,
 confirmed_at timestamptz not null default clock_timestamp()
);
alter table private.client_delivery_file_plans enable row level security;
alter table private.client_delivery_final_receipts enable row level security;
revoke all on private.client_delivery_file_plans,private.client_delivery_final_receipts
 from public,anon,authenticated,service_role;
grant select on private.client_delivery_file_plans,private.client_delivery_final_receipts to service_role;
create trigger delivery_final_receipt_immutable
 before update or delete on private.client_delivery_final_receipts
 for each row execute function private.protect_photo_transfer_ledger();

-- A single claim avoids external parallel jobs; no expired-lease blind replay.
-- An expired lease requires explicit reconciliation, preserving saved remote IDs.
create function private.service_claim_delivery(p_worker uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $claim$
declare job private.client_delivery_outbox%rowtype; k private.client_packages%rowtype;
begin
 if p_worker is null then raise exception 'Worker identity required' using errcode='22023';end if;
 select * into job from private.client_delivery_outbox
  where state='QUEUED' and attempts=0 and worker_id is null
  order by enqueued_at,package_id for update skip locked limit 1;
 if job.package_id is null then return jsonb_build_object('claimed',false);end if;
 select * into k from private.client_packages where id=job.package_id for update;
 if k.status<>'QUEUED' or k.approved_sha256 is distinct from job.approved_sha256
  or k.destination_id is distinct from job.destination_id
  or not exists(select 1 from private.client_delivery_runtime rt
   where rt.organization_id=k.organization_id and rt.worker_ready
   and rt.last_verified_at>=now()-interval '24 hours' and rt.worker_identity is not null)
  or not exists(select 1 from private.client_delivery_destinations d
    where d.id=job.destination_id and d.organization_id=k.organization_id
      and d.company_id=k.company_id and d.verified and d.active
      and d.revision=(k.approved_manifest->>'destination_revision')::uuid) then
  raise exception 'Delivery worker or frozen destination is not verified' using errcode='42501';end if;
 update private.client_delivery_outbox
  set state='DELIVERING',worker_id=p_worker,lease_generation=lease_generation+1,
   lease_until=clock_timestamp()+interval '2 minutes',last_heartbeat_at=clock_timestamp(),
   attempts=attempts+1 where package_id=job.package_id returning * into job;
 update private.client_packages set status='DELIVERING' where id=k.id;
 return jsonb_build_object('claimed',true,'package_id',job.package_id,
  'generation',job.lease_generation,'expires_at',job.lease_until,
  'approved_sha256',job.approved_sha256,'destination_id',job.destination_id,
  'manifest',k.approved_manifest);
end;
$claim$;
create function public.service_claim_delivery(p_worker uuid)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_claim_delivery(p_worker)
$wrap$;
revoke all on function private.service_claim_delivery(uuid),public.service_claim_delivery(uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.service_claim_delivery(uuid),public.service_claim_delivery(uuid) to service_role;

create function private.service_delivery_guard(p_package uuid,p_worker uuid,p_generation bigint)
returns void language plpgsql security definer set search_path='' as $guard$
declare o private.client_delivery_outbox%rowtype;
begin
 select * into o from private.client_delivery_outbox where package_id=p_package for update;
 if o.package_id is null or o.state<>'DELIVERING' or o.worker_id is distinct from p_worker
 or o.lease_generation is distinct from p_generation
 or o.lease_until<=clock_timestamp() then
   raise exception 'Delivery lease stale or uncertain; no remote mutation authority' using errcode='40001';end if;
end;
$guard$;
revoke all on function private.service_delivery_guard(uuid,uuid,bigint)
 from public,anon,authenticated,service_role;
grant execute on function private.service_delivery_guard(uuid,uuid,bigint) to service_role;

create function private.service_heartbeat_delivery(p_package uuid,p_worker uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $beat$
declare lease_end timestamptz;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 update private.client_delivery_outbox
  set lease_until=clock_timestamp()+interval '2 minutes',last_heartbeat_at=clock_timestamp()
  where package_id=p_package returning lease_until into lease_end;
 return jsonb_build_object('package_id',p_package,'generation',p_generation,'expires_at',lease_end);
end;
$beat$;
create function public.service_heartbeat_delivery(p_package uuid,p_worker uuid,p_generation bigint)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_heartbeat_delivery(p_package,p_worker,p_generation)
$wrap$;
revoke all on function private.service_heartbeat_delivery(uuid,uuid,bigint),
 public.service_heartbeat_delivery(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.service_heartbeat_delivery(uuid,uuid,bigint),
 public.service_heartbeat_delivery(uuid,uuid,bigint) to service_role;

-- Exact expected parent and content are derived from the frozen manifest,
-- never from client input. Repeating identical reservation is idempotent.
create function private.service_reserve_delivery_file(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text,p_photo uuid,
 p_file_id text,p_parent_id text
) returns jsonb language plpgsql security definer set search_path='' as $reserve$
declare k private.client_packages%rowtype; o private.client_delivery_outbox%rowtype;
 folder private.client_delivery_file_plans%rowtype; existing private.client_delivery_file_plans%rowtype;
 m jsonb; photo jsonb; content_hash text; content_size bigint; mime text; parent text;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 if p_kind not in ('FOLDER','PHOTO','MANIFEST') or p_file_id is null
   or p_file_id !~ '^[a-zA-Z0-9_-]{10,160}$' or p_parent_id is null
   or p_parent_id !~ '^[a-zA-Z0-9_-]{3,160}$' then
  raise exception 'Exact generated Drive ID and parent required' using errcode='22023';end if;
 select * into k from private.client_packages where id=p_package;
 select * into o from private.client_delivery_outbox where package_id=p_package;
 m:=k.approved_manifest;
 if k.status<>'DELIVERING' or k.approved_sha256<>o.approved_sha256 or m is null then
  raise exception 'Frozen approved package required' using errcode='42501';end if;
 if p_kind='FOLDER' then
   if p_photo is not null then raise exception 'Folder cannot refer to a photo' using errcode='22023';end if;
   parent:=m->>'destination_root'; mime:='application/vnd.google-apps.folder';
 elsif p_kind='PHOTO' or p_kind='MANIFEST' then
   select * into folder from private.client_delivery_file_plans
     where package_id=p_package and kind='FOLDER' and photo_id is null;
   if folder.package_id is null then
    raise exception 'Preallocate package folder before children' using errcode='42501';end if;
   parent:=folder.drive_file_id;
   if p_kind='PHOTO' then
     if p_photo is null then raise exception 'Selected photo identity required' using errcode='22023';end if;
     select value into photo from jsonb_array_elements(m->'selected_photos')
       where value->>'photo_id'=p_photo::text;
     if photo is null then raise exception 'Photo not selected in approved manifest' using errcode='42501';end if;
     content_hash:=photo->>'observed_sha256'; content_size:=(photo->>'observed_size')::bigint; mime:='image/jpeg';
   else
     if p_photo is not null then raise exception 'Manifest has no photo identity' using errcode='22023';end if;
     content_hash:=k.approved_sha256;content_size:=octet_length(m::text);mime:='application/json';
   end if;
 else raise exception 'Unsupported file role' using errcode='22023';end if;
 if parent is distinct from p_parent_id then
  raise exception 'Drive parent differs from frozen destination' using errcode='42501';end if;
 select * into existing from private.client_delivery_file_plans
   where package_id=p_package and kind=p_kind and photo_id is not distinct from p_photo for update;
 if existing.package_id is not null then
   if existing.drive_file_id<>p_file_id or existing.drive_parent_id<>p_parent_id then
     raise exception 'Remote identity already reserved; do not replace' using errcode='40001';end if;
 else
   insert into private.client_delivery_file_plans(package_id,kind,photo_id,
     drive_file_id,drive_parent_id,expected_sha256,expected_size,mime_type)
     values(p_package,p_kind,p_photo,p_file_id,p_parent_id,content_hash,content_size,mime);
 end if;
 return jsonb_build_object('package_id',p_package,'kind',p_kind,'photo_id',p_photo,
  'drive_file_id',p_file_id,'drive_parent_id',p_parent_id,'expected_sha256',content_hash,
  'expected_size',content_size,'mime_type',mime);
end;
$reserve$;
create function public.service_reserve_delivery_file(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text,p_photo uuid,
 p_file_id text,p_parent_id text
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_reserve_delivery_file(p_package,p_worker,p_generation,
  p_kind,p_photo,p_file_id,p_parent_id)
$wrap$;
revoke all on function private.service_reserve_delivery_file(uuid,uuid,bigint,text,uuid,text,text),
 public.service_reserve_delivery_file(uuid,uuid,bigint,text,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function private.service_reserve_delivery_file(uuid,uuid,bigint,text,uuid,text,text),
 public.service_reserve_delivery_file(uuid,uuid,bigint,text,uuid,text,text) to service_role;

-- The trusted worker supplies a *fresh* Drive GET verification result for
-- reserved ID, exact parent, MIME, SHA-256 and size. Never accept file listing,
-- folder presence or 308 upload offset as completed file verification.
create function private.service_confirm_delivery_file(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text,p_photo uuid,
 p_file_id text,p_parent text,p_mime text,p_sha256 text,p_size bigint
) returns jsonb language plpgsql security definer set search_path='' as $confirm$
declare f private.client_delivery_file_plans%rowtype; result jsonb;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into f from private.client_delivery_file_plans
  where package_id=p_package and kind=p_kind and photo_id is not distinct from p_photo for update;
 if f.package_id is null or f.drive_file_id is distinct from p_file_id
   or f.drive_parent_id is distinct from p_parent or f.mime_type is distinct from p_mime
   or f.expected_sha256 is distinct from p_sha256
   or f.expected_size is distinct from p_size then
  raise exception 'Verified Drive metadata differs from frozen identity' using errcode='42501';end if;
 if f.state='UNCERTAIN' then raise exception 'Uncertain Drive object requires reconciliation' using errcode='40001';end if;
 if f.state='PREALLOCATED' then
   update private.client_delivery_file_plans set state='VERIFIED',verified_at=clock_timestamp(),
    remote_evidence=jsonb_build_object('file_id',p_file_id,'parent_id',p_parent,
     'mime_type',p_mime,'sha256',p_sha256,'size',p_size)
   where package_id=p_package and kind=p_kind and photo_id is not distinct from p_photo;
 end if;
 result:=jsonb_build_object('package_id',p_package,'kind',p_kind,
  'photo_id',p_photo,'drive_file_id',p_file_id,'state','VERIFIED');
 return result;
end;
$confirm$;
create function public.service_confirm_delivery_file(
 p_package uuid,p_worker uuid,p_generation bigint,p_kind text,p_photo uuid,
 p_file_id text,p_parent text,p_mime text,p_sha256 text,p_size bigint
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_confirm_delivery_file(p_package,p_worker,p_generation,
  p_kind,p_photo,p_file_id,p_parent,p_mime,p_sha256,p_size)
$wrap$;
revoke all on function private.service_confirm_delivery_file(uuid,uuid,bigint,text,uuid,text,text,text,text,bigint),
 public.service_confirm_delivery_file(uuid,uuid,bigint,text,uuid,text,text,text,text,bigint)
 from public,anon,authenticated,service_role;
grant execute on function private.service_confirm_delivery_file(uuid,uuid,bigint,text,uuid,text,text,text,text,bigint),
 public.service_confirm_delivery_file(uuid,uuid,bigint,text,uuid,text,text,text,text,bigint) to service_role;

create function private.service_finish_delivery(p_package uuid,p_worker uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $finish$
declare k private.client_packages%rowtype; outbox private.client_delivery_outbox%rowtype;
 folder private.client_delivery_file_plans%rowtype; manifest private.client_delivery_file_plans%rowtype;
 included integer; expected integer; evidence jsonb;
begin
 perform private.service_delivery_guard(p_package,p_worker,p_generation);
 select * into k from private.client_packages where id=p_package for update;
 select * into outbox from private.client_delivery_outbox where package_id=p_package;
 select * into folder from private.client_delivery_file_plans
  where package_id=p_package and kind='FOLDER' and photo_id is null and state='VERIFIED';
 select * into manifest from private.client_delivery_file_plans
  where package_id=p_package and kind='MANIFEST' and photo_id is null and state='VERIFIED';
 if folder.package_id is null or manifest.package_id is null
  or manifest.drive_parent_id<>folder.drive_file_id
  or manifest.expected_sha256<>k.approved_sha256
  or outbox.approved_sha256<>k.approved_sha256
  or outbox.destination_id<>k.destination_id then
  raise exception 'Complete, matching folder, manifest and frozen outbox required' using errcode='42501';end if;
 expected:=jsonb_array_length(k.approved_manifest->'selected_photos');
 select count(*) into included from private.client_delivery_file_plans f where
  f.package_id=p_package and f.kind='PHOTO' and f.state='VERIFIED'
  and f.drive_parent_id=folder.drive_file_id;
 if included<>expected or (select count(*) from private.client_delivery_file_plans
    where package_id=p_package and state<>'VERIFIED')<>0
  or (select count(*) from private.client_delivery_file_plans where package_id=p_package)<>expected+2 then
  raise exception 'All selected photo IDs and exact provider receipts required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'photo_id',photo_id,
  'file_id',drive_file_id,'parent_id',drive_parent_id,
  'sha256',expected_sha256,'size',expected_size) order by kind,photo_id),'[]'::jsonb)
 into evidence from private.client_delivery_file_plans where package_id=p_package;
 insert into private.client_delivery_final_receipts(package_id,approved_sha256,destination_id,drive_folder_id,files)
  values(p_package,k.approved_sha256,k.destination_id,folder.drive_file_id,evidence);
 update private.client_delivery_outbox set state='DELIVERED',lease_until=null,worker_id=null
   where package_id=p_package;
 update private.client_packages set status='DELIVERED' where id=p_package;
 return jsonb_build_object('package_id',p_package,'status','DELIVERED',
  'manifest_sha256',k.approved_sha256,'verified_file_count',expected+2);
end;
$finish$;
create function public.service_finish_delivery(p_package uuid,p_worker uuid,p_generation bigint)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_finish_delivery(p_package,p_worker,p_generation)
$wrap$;
revoke all on function private.service_finish_delivery(uuid,uuid,bigint),
 public.service_finish_delivery(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.service_finish_delivery(uuid,uuid,bigint),
 public.service_finish_delivery(uuid,uuid,bigint) to service_role;

-- No automatic blind retry after a worker/HTTP crash: suspend for provider
-- status inspection, keeping all pre-generated IDs, photos and original bytes.
create function private.service_quarantine_expired_delivery(p_package uuid)
returns jsonb language plpgsql security definer set search_path='' as $quarantine$
declare o private.client_delivery_outbox%rowtype;
begin
 select * into o from private.client_delivery_outbox where package_id=p_package for update;
 if o.package_id is null or o.state<>'DELIVERING' or o.lease_until>=clock_timestamp() then
  raise exception 'Only actually expired delivery can be quarantined' using errcode='40001';end if;
 update private.client_delivery_outbox
  set state='UNCERTAIN',uncertain_reason='Expired lease; inspect existing Drive IDs before retry',
   worker_id=null,lease_until=null where package_id=p_package;
 update private.client_packages set status='UNCERTAIN' where id=p_package;
 return jsonb_build_object('package_id',p_package,'status','UNCERTAIN');
end;
$quarantine$;
create function public.service_quarantine_expired_delivery(p_package uuid)
returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_quarantine_expired_delivery(p_package)
$wrap$;
revoke all on function private.service_quarantine_expired_delivery(uuid),
 public.service_quarantine_expired_delivery(uuid) from public,anon,authenticated,service_role;
grant execute on function private.service_quarantine_expired_delivery(uuid),
 public.service_quarantine_expired_delivery(uuid) to service_role;
