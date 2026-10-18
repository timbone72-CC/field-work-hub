-- Disposable PostgreSQL CI only: exercise migration 20261011190000 with
-- a genuine pre-existing work order and its deferred current-run FK.
-- Never execute this fixture on the hosted Field Work Hub database.
insert into public.work_orders(
  id,organization_id,responsible_team_id,assigned_user_id,
  wo_number,property_address,work_type,due_date
) values (
  '00000000-0000-0000-0000-000000000090',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000011',
  'FWH-UPGRADE-EXISTING-ROW','Synthetic migration fixture','INSPECTION',current_date
);
do $assert$
begin
  if not exists (
    select 1 from public.work_orders w
    join public.work_order_runs r
      on r.id=w.current_run_id and r.work_order_id=w.id
    where w.id='00000000-0000-0000-0000-000000000090'::uuid
      and r.requirement_snapshot='{}'::jsonb
  ) then raise exception 'Missing existing-work/run seed before correction migration';end if;
end;$assert$;
