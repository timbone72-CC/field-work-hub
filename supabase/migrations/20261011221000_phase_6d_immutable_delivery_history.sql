-- Phase 6D read-only office audit projection. Never re-evaluate an earlier
-- DELIVERED package against the current WO; use its frozen approved_manifest,
-- verified final receipt and immutable run/photo/assignment identities.
create function private.admin_release_history(p_wo uuid,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $history$
declare w public.work_orders%rowtype; runs jsonb; packages jsonb; obligations jsonb;
begin
 if p_wo is null or p_limit not in (25,50)
   or not private.current_identity_valid() or not private.can_work_order(p_wo)
 then raise exception 'Scoped bounded work-order history required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo;
 if w.id is null then raise exception 'Work order not accessible' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'run_id',r.id,'run_sequence',r.run_sequence,
   'field_status',r.field_status,'assigned_user_id',r.current_assignee_user_id,
   'reopen_reason',r.reopen_reason,'created_at',r.created_at,
   'downloaded_at',r.assignment_received_at,'started_at',r.started_at,
   'finished_at',r.field_completed_at,
   'requirement_revision',r.requirement_snapshot->>'revision',
   'registered_photos',(select count(*) from public.photos ph where ph.run_id=r.id),
   'private_receipts',(select count(*) from private.photo_transfers t
      join private.photo_transfer_receipts rec on rec.photo_id=t.photo_id
        and rec.transfer_version=t.version
      where t.run_id=r.id and t.state='RECEIVED'))
   order by r.run_sequence desc),'[]'::jsonb) into runs
 from (select * from public.work_order_runs where work_order_id=p_wo
     order by run_sequence desc limit p_limit) r;
 select coalesce(jsonb_agg(jsonb_build_object(
   'package_id',k.id,'run_id',k.run_id,'status',k.status,
   'revision',k.revision,'created_at',k.created_at,
   'approved_at',k.approved_at,'approved_sha256',k.approved_sha256,
   'company_id',k.company_id,'destination_id',k.destination_id,
   'selected_count',(select count(*) from private.client_package_photos s
      where s.package_id=k.id),
   'frozen_wo_number',k.approved_manifest->>'client_wo_number',
   'frozen_release_revision',k.approved_manifest->>'release_requirement_revision',
   'frozen_destination',k.approved_manifest->>'destination_root',
   'receipt_confirmed_at',receipt.confirmed_at,
   'verified_drive_folder_id',receipt.drive_folder_id,
   'receipt_sha256',receipt.approved_sha256)
   order by k.created_at desc,k.id desc),'[]'::jsonb) into packages
 from (select * from private.client_packages where work_order_id=p_wo
   order by created_at desc,id desc limit p_limit) k
 left join private.client_delivery_final_receipts receipt on receipt.package_id=k.id;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',o.id,'origin_run_id',o.origin_run_id,'replacement_run_id',o.replacement_run_id,
   'kind',o.kind,'status',o.status,'superseded_by',o.superseded_by,
   'reason',o.reason,'created_at',o.created_at,'release_revision',o.release_revision)
   order by o.created_at desc,o.id desc),'[]'::jsonb) into obligations
 from (select * from private.correction_obligations where work_order_id=p_wo
   order by created_at desc,id desc limit p_limit) o;
 return jsonb_build_object(
   'work_order_id',w.id,'client_wo_number',w.wo_number,
   'company_id',w.client_company_id,'current_run_id',w.current_run_id,
   'runs',runs,'packages',packages,'corrections',obligations,
   'bounded_to',p_limit,
   'more_runs',exists(select 1 from public.work_order_runs r
     where r.work_order_id=p_wo and r.run_sequence<
       coalesce((select min((v.value->>'run_sequence')::int)
         from jsonb_array_elements(runs) v),2147483647)),
   'more_packages',(select count(*) from private.client_packages k
     where k.work_order_id=p_wo)>p_limit);
end;$history$;
create function public.admin_release_history(p_wo uuid,p_limit integer default 25)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_release_history(p_wo,p_limit)
$$;
revoke all on function private.admin_release_history(uuid,integer),
 public.admin_release_history(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.admin_release_history(uuid,integer),
 public.admin_release_history(uuid,integer) to authenticated,service_role;
