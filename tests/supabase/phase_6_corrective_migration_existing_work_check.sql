-- Verify the historical row survived the source-ordered correction upgrade.
-- Disposable CI only; assertions make no changes.
do $assert$
declare w public.work_orders%rowtype; r public.work_order_runs%rowtype;
begin
  select * into w from public.work_orders
    where id='00000000-0000-0000-0000-000000000090'::uuid;
  if w.id is null then raise exception 'Existing work order lost during migration';end if;
  select * into r from public.work_order_runs where id=w.current_run_id;
  if r.id is null or r.work_order_id<>w.id or r.requirement_snapshot<>'{}'::jsonb
    or w.release_requirement_revision is null
    or jsonb_typeof(w.release_requirement_snapshot) is distinct from 'object'
    or w.release_requirement_snapshot->>'schema'<>'1'
    or w.release_requirement_snapshot->'total'->>'enabled'<>'false'
    or w.release_requirement_snapshot->'total'->>'minimum'<>'0'
    or w.release_requirement_snapshot->'items'<>'[]'::jsonb
    or nullif(w.release_requirement_snapshot->>'revision','') is null
  then raise exception 'Existing work/run identity or canonical release backfill changed';end if;
  if exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='work_orders'
      and column_name='release_requirement_snapshot'
      and (is_nullable<>'NO' or column_default is not null))
    or not exists(select 1 from pg_trigger
      where tgrelid='public.work_orders'::regclass
        and tgname='work_orders_initial_release' and tgenabled='O')
  then raise exception 'Release non-null and insert-trigger rules changed';end if;
  raise notice 'Existing-work Phase 6 correction migration transaction/backfill PASS';
end;$assert$;
