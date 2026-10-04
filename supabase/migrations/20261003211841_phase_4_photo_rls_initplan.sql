-- Same photo authority; scalar JWT initplans match the established ledger pattern.
alter policy photo_finish_sets_read on public.photo_finish_sets using(
 organization_id=nullif(((select auth.jwt())->'app_metadata'->>'organization_id'),'')::uuid
 and (actor_user_id=(select auth.uid()) or ((select auth.jwt())->'app_metadata'->>'role')='ADMIN'));
alter policy photos_contractor_insert_waiting on public.photos with check(
 captured_by=(select auth.uid()) and sync_status='WAITING' and remote_file_id is null and uploaded_at is null
 and finish_set_id is null and requirement_item_id is null and requirement_revision is null and assignment_instance_id is null
 and exists(select 1 from public.work_orders w join public.work_order_runs r on r.id=w.current_run_id
 where w.id=photos.work_order_id and r.id=photos.run_id and r.requirement_snapshot='{}'::jsonb
 and w.organization_id=nullif(((select auth.jwt())->'app_metadata'->>'organization_id'),'')::uuid
 and w.assigned_user_id=(select auth.uid()) and w.field_status<>'CANCELLED'));

