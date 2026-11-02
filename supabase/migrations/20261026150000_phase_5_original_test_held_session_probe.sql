-- Phase 5D held-permit forensic status probe: only the ONE original
-- interrupted disposable TEST upload. No lease renewal, no journal mutation,
-- no dispatch release, no Google bytes or new resumable session.
-- Ciphertext is visible only to the service-role-only trusted worker RPC.
create function private.service_read_exact_held_first_photo_probe(
  p_package uuid,p_destination uuid,p_root text
) returns jsonb language plpgsql stable security definer set search_path=''
set lock_timeout='5s' as $read$
declare
 o private.client_delivery_outbox%rowtype;
 k private.client_packages%rowtype;
 d private.client_delivery_destinations%rowtype;
 j private.client_delivery_test_first_photo_continuations%rowtype;
 c private.client_delivery_test_first_photo_progress_continuations%rowtype;
 s private.client_delivery_upload_sessions%rowtype;
 f private.client_delivery_file_plans%rowtype;
 g private.client_delivery_file_plans%rowtype;
 permit private.client_delivery_dispatch_permit%rowtype;
begin
 select * into o from private.client_delivery_outbox where package_id=p_package;
 select * into k from private.client_packages where id=p_package;
 select * into d from private.client_delivery_destinations where id=p_destination;
 select * into j from private.client_delivery_test_first_photo_continuations
  where package_id=p_package;
 select * into c from private.client_delivery_test_first_photo_progress_continuations
  where package_id=p_package;
 select * into permit from private.client_delivery_dispatch_permit;
 select * into f from private.client_delivery_file_plans
  where package_id=p_package and id=c.photo_plan_id;
 select * into g from private.client_delivery_file_plans
  where package_id=p_package and kind='FOLDER';
 select * into s from private.client_delivery_upload_sessions
  where package_id=p_package and file_plan_id=c.photo_plan_id;
 if p_package is null or p_destination is null
  or p_root is null or k.id is null or d.id is null
  or o.package_id is null or j.package_id is null or c.package_id is null
  or permit.request_id is null or permit.request_id is distinct from c.request_id
  or permit.singleton is distinct from true
  or o.worker_id is null or o.worker_id is distinct from j.worker_id
  or o.worker_id is distinct from c.worker_id
  or o.lease_generation<>1 or j.lease_generation<>1 or c.lease_generation<>1
  or o.attempts<>1 or o.state<>'DELIVERING'
  or k.status<>'DELIVERING' or o.uncertain_reason is not null
  or o.lease_until is null or o.lease_until>=clock_timestamp()
  or o.destination_id is distinct from p_destination
  or k.destination_id is distinct from p_destination
  or d.organization_id is distinct from k.organization_id
  or d.company_id is distinct from k.company_id
  or d.provider<>'GOOGLE_DRIVE' or d.verified is distinct from true
  or d.active is distinct from true
  or d.root_folder_id is distinct from p_root
  or d.verification_receipt->>'shared_drive_id' is null
  or k.approved_manifest->>'destination_root' is distinct from p_root
  or k.approved_manifest->>'destination_id' is distinct from p_destination::text
  or k.approved_manifest->>'destination_revision' is distinct from d.revision::text
  or o.approved_sha256 is distinct from k.approved_sha256
  or k.approved_sha256 is null
  or c.photo_plan_id is distinct from j.photo_plan_id
  or c.photo_remote_id is distinct from j.photo_remote_id
  or f.id is null or f.kind<>'PHOTO' or f.state<>'PREALLOCATED'
  or f.photo_id is null or f.drive_file_id is distinct from c.photo_remote_id
  or f.expected_size is null or f.expected_size<=0 or f.expected_size>33554432
  or f.expected_sha256 is null or f.mime_type<>'image/jpeg'
  or g.id is null or g.state<>'VERIFIED'
  or g.id is distinct from j.folder_plan_id
  or g.drive_file_id is distinct from j.folder_remote_id
  or f.drive_parent_id is distinct from g.drive_file_id
  or s.file_plan_id is null or s.state<>'UPLOADING'
  or s.total_bytes is distinct from f.expected_size
  or s.ciphertext is null or jsonb_typeof(s.ciphertext)<>'object'
  or s.ciphertext->>'version' is distinct from '1'
  or s.recorded_offset is distinct from c.previous_offset
  or s.revision is distinct from c.previous_revision
  or s.recorded_offset<=0 or s.recorded_offset>=s.total_bytes
  or c.previous_offset<=0 or c.previous_revision<3
  or (select count(*) from private.client_delivery_dispatch_permit)<>1
  or (select count(*) from private.client_delivery_upload_sessions
      where package_id=p_package)<>1
  or (select count(*) from private.client_delivery_upload_starts
      where package_id=p_package and file_plan_id=f.id)<>1
  or (select count(*) from private.client_delivery_file_plans
      where package_id=p_package)<>4
  or (select count(*) from private.client_delivery_file_plans
      where package_id=p_package and kind='PHOTO' and state='PREALLOCATED')<>2
  or exists(select 1 from private.client_delivery_final_receipts
      where package_id=p_package)
  or exists(select 1 from private.client_delivery_outbox
      where package_id<>p_package and state='DELIVERING')
 then raise exception 'Held original TEST session probe denied'
  using errcode='42501';end if;
 return jsonb_build_object(
  'status','ORIGINAL_TEST_HELD_FIRST_PHOTO_EXACT',
  'package_id',p_package,
  'destination_id',p_destination,'root_id',p_root,
  'worker_id',o.worker_id,'generation',o.lease_generation,
  'photo_plan_id',f.id,'photo_remote_id',f.drive_file_id,
  'parent_remote_id',f.drive_parent_id,
  'drive_id',d.verification_receipt->>'shared_drive_id',
  'expected_size',s.total_bytes,'saved_offset',s.recorded_offset,
  'session_revision',s.revision,'sealed_session',s.ciphertext);
end;
$read$;
create function public.service_read_exact_held_first_photo_probe(
 p_package uuid,p_destination uuid,p_root text
) returns jsonb language sql stable security invoker
set search_path='' as $wrap$
 select private.service_read_exact_held_first_photo_probe(
  p_package,p_destination,p_root)
$wrap$;
revoke all on function
 private.service_read_exact_held_first_photo_probe(uuid,uuid,text),
 public.service_read_exact_held_first_photo_probe(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function
 private.service_read_exact_held_first_photo_probe(uuid,uuid,text),
 public.service_read_exact_held_first_photo_probe(uuid,uuid,text)
 to service_role;
