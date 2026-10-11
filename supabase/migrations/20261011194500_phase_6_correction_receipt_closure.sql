-- Maintain the single original verified provider worker/journal engine.
-- Only an exact final delivery receipt may turn active corrections SATISFIED.
-- Do not create an alternative provider or cleanup state transition.
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
 -- The verified immutable client delivery now satisfies each active obligation
 -- that passed this package's frozen exact-run coverage. A private photo receipt,
 -- Review approval or queued Send alone does not close a correction.
 update private.correction_obligations co set status='SATISFIED'
   where co.work_order_id=k.work_order_id and co.status='OPEN'
     and exists(select 1 from jsonb_array_elements(
         coalesce(k.approved_manifest->'correction_obligations','[]'::jsonb)) active
       where active.value->>'obligation_id'=co.id::text
         and active.value->>'replacement_run_id'=co.replacement_run_id::text);
 return jsonb_build_object('package_id',p_package,'status','DELIVERED',
  'manifest_sha256',k.approved_sha256,'verified_file_count',expected+2);
end;
$finish$;
