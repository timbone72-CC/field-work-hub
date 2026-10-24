-- Source-only final delivery gate: independent one-shot PACKAGE folder receipt
-- is required in addition to the existing per-file and manifest metadata.
create or replace function private.service_finish_delivery(p_package uuid,p_worker uuid,p_generation bigint)
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
 -- An ordinary FOLDER plan marked VERIFIED is not sufficient:
 -- require the original one-shot attempt and exact independent Drive GET
 -- proof committed in the same trusted lease before package completion.
 if folder.id is null or not exists(
   select 1 from private.client_delivery_package_folder_attempts receipt
   where receipt.file_plan_id=folder.id and receipt.package_id=p_package
      and receipt.verified_at is not null and receipt.remote_evidence is not null
 ) then
   raise exception 'Independent package folder provider receipt required'
     using errcode='42501';end if;
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
$finish$
