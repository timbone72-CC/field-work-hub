-- Phase 5E: durable, owner-scoped cleanup eligibility foundation.
-- SOURCE ONLY: not enabled, not a cleanup executor, no provider calls,
-- no file/receipt deletion, no backfill of historical package membership.
-- Missing exact closure MUST keep protected phone originals.
create table private.client_package_runs (
  package_id uuid not null references private.client_packages(id) on delete restrict,
  run_id uuid not null references public.work_order_runs(id) on delete restrict,
  finish_set_id uuid not null references public.photo_finish_sets(id) on delete restrict,
  finish_digest text not null check (finish_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (package_id,run_id)
);
create index client_package_runs_run_idx on private.client_package_runs(run_id);
alter table private.client_package_runs enable row level security;
revoke all on private.client_package_runs from public,anon,authenticated,service_role;

-- Closure is immutable and only valid when an independently confirmed package
-- covers the exact original Finish set AND every member has private retention.
-- No writer is granted by this migration; future delivery finalization must
-- use one reviewed, fenced server owner and prove this trigger's requirements.
create function private.guard_client_package_run_closure()
returns trigger language plpgsql security definer set search_path='' as $closure$
declare
  fs public.photo_finish_sets%rowtype;
  k private.client_packages%rowtype;
begin
  if tg_op<>'INSERT' then
    raise exception 'Immutable package/run closure cannot change' using errcode='42501';
  end if;
  select * into fs from public.photo_finish_sets where id=new.finish_set_id;
  select * into k from private.client_packages where id=new.package_id;
  if fs.id is null or k.id is null
    or fs.run_id is distinct from new.run_id
    or k.work_order_id is distinct from fs.work_order_id
    -- First stage only covers the package's explicit main run.
    -- Never infer closure for other runs absent manifest membership proof.
    or k.run_id is distinct from new.run_id
    or k.organization_id is distinct from fs.organization_id
    or k.status<>'DELIVERED'
    or fs.digest is distinct from new.finish_digest
    or not exists (
      select 1 from public.field_actions a
      where a.organization_id=fs.organization_id
        and a.work_order_id=fs.work_order_id
        and a.run_id=new.run_id
        and a.actor_user_id=fs.actor_user_id
        and a.action_kind='COMPLETE' and a.accepted_at is not null
        and a.finish_set_id=new.finish_set_id
        and a.finish_digest=new.finish_digest)
    or not exists (
      select 1 from private.client_delivery_final_receipts r
      join private.client_delivery_outbox o on o.package_id=r.package_id
      where r.package_id=k.id and o.state='DELIVERED'
        and r.destination_id=k.destination_id
        and r.approved_sha256=k.approved_sha256
        and o.approved_sha256=k.approved_sha256)
  then raise exception 'Applicable final delivery/Finish closure not verified'
    using errcode='42501';end if;
  if jsonb_typeof(fs.photos)<>'array'
    or exists (
       select 1 from jsonb_array_elements(fs.photos) image
       where image->>'id' is null
          or not exists (
            select 1 from private.photo_transfers t
            join private.photo_transfer_receipts r
              on r.photo_id=t.photo_id and r.transfer_version=t.version
               and r.observed_sha256=t.prepared_sha256
               and r.observed_size=t.prepared_size
            where t.photo_id=(image->>'id')::uuid
              and t.captured_by=fs.actor_user_id
              and t.organization_id=fs.organization_id
              and t.work_order_id=fs.work_order_id
              and t.run_id=new.run_id
              and t.finish_set_id=new.finish_set_id
              and t.finish_digest=new.finish_digest
              and t.state='RECEIVED'))
  then raise exception 'Every frozen photo needs a verified private retention receipt'
    using errcode='42501';end if;
  return new;
end;
$closure$;
create trigger client_package_runs_immutable
  before insert or update or delete on private.client_package_runs
  for each row execute function private.guard_client_package_run_closure();

-- A contractor may inspect ONLY their own original/photo for eligibility,
-- including accepted historical runs. No current assignment requirement that
-- strands accepted pre-disable evidence, and no customer/provider IDs leaked.
create function private.field_photo_cleanup_readiness(p_photo uuid)
returns jsonb language plpgsql security definer set search_path='' as $check$
declare
  t private.photo_transfers%rowtype;
  proof private.client_package_runs%rowtype;
  pkg uuid;
  included boolean;
begin
  if p_photo is null or auth.uid() is null then
    raise exception 'Authenticated photo owner required' using errcode='42501';
  end if;
  select * into t from private.photo_transfers
   where photo_id=p_photo and captured_by=auth.uid();
  if t.photo_id is null then
    raise exception 'Exact original photo owner required' using errcode='42501';
  end if;
  if t.state<>'RECEIVED' or not exists (
    select 1 from private.photo_transfer_receipts r
      where r.photo_id=t.photo_id and r.transfer_version=t.version
        and r.observed_sha256=t.prepared_sha256
        and r.observed_size=t.prepared_size)
  then return jsonb_build_object('eligible',false,'reason','PRIVATE_RECEIPT_PENDING');end if;
  if t.finish_set_id is null or not exists (
     select 1 from public.photo_finish_sets fs
       join public.field_actions a on a.finish_set_id=fs.id
     where fs.id=t.finish_set_id and fs.run_id=t.run_id
       and fs.actor_user_id=t.captured_by and fs.organization_id=t.organization_id
       and fs.work_order_id=t.work_order_id and fs.digest=t.finish_digest
       and a.action_kind='COMPLETE' and a.accepted_at is not null
       and a.actor_user_id=t.captured_by and a.run_id=t.run_id
       and a.finish_digest=t.finish_digest
       and exists(select 1 from jsonb_array_elements(fs.photos) image
                  where image->>'id'=p_photo::text))
  then return jsonb_build_object('eligible',false,'reason','FINISH_NOT_ACCEPTED');end if;
  select c.* into proof from private.client_package_runs c
    join private.client_packages k on k.id=c.package_id
    join private.client_delivery_final_receipts f on f.package_id=k.id
    join private.client_delivery_outbox o on o.package_id=k.id
  where c.run_id=t.run_id and c.finish_set_id=t.finish_set_id
    and c.finish_digest=t.finish_digest
    and k.work_order_id=t.work_order_id and k.organization_id=t.organization_id
    and k.status='DELIVERED' and o.state='DELIVERED'
    and f.approved_sha256=k.approved_sha256
    and o.approved_sha256=k.approved_sha256
    and f.destination_id=k.destination_id
  order by c.recorded_at desc limit 1;
  if proof.package_id is null then
    return jsonb_build_object('eligible',false,'reason','FINAL_RUN_CLOSURE_PENDING');
  end if;
  pkg:=proof.package_id;
  included:=exists(select 1 from private.client_package_photos p
                   where p.package_id=pkg and p.photo_id=t.photo_id);
  -- This is ONLY server readiness. Android must first durably journal the
  -- exact owner/run/photo receipt and check local pending actions/conflicts.
  -- No client-side status or this response alone may initiate a deletion.
  return jsonb_build_object(
    'eligible',true,'server_readiness_only',true,
    'photo_id',t.photo_id,'run_id',t.run_id,
    'finish_set_id',t.finish_set_id,'finish_digest',t.finish_digest,
    'transfer_version',t.version,'private_receipt_verified',true,
    'package_id',pkg,'retained_privately',true,
    'included_in_client_package',included);
end;
$check$;
create function public.field_photo_cleanup_readiness(p_photo uuid)
returns jsonb language sql security invoker set search_path='' as $wrapper$
 select private.field_photo_cleanup_readiness(p_photo)
$wrapper$;
revoke all on function
  private.field_photo_cleanup_readiness(uuid),
  public.field_photo_cleanup_readiness(uuid),
  private.guard_client_package_run_closure()
  from public,anon,authenticated,service_role;
grant execute on function
  private.field_photo_cleanup_readiness(uuid),
  public.field_photo_cleanup_readiness(uuid)
  to authenticated;
-- Intentionally no grant for closure mutation or deletion.
