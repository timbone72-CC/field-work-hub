-- Request-bound metadata; bytes are verified only by the trusted Edge worker.
-- Do not select some other valid session when the incoming session was revoked.
revoke all on function public.photo_object_verification_target(uuid,uuid),
  private.photo_object_verification_target(uuid,uuid) from service_role;

create function private.photo_verification_target_for_session(
  p_photo uuid,p_transfer_version uuid,p_owner uuid,p_session uuid
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t private.photo_transfers%rowtype; o storage.objects%rowtype; r private.photo_transfer_receipts%rowtype;
begin
  if not private.photo_transfer_authorized_for_user(p_owner,p_session,p_photo) then
    raise exception 'Current original-owner transfer session required' using errcode='42501'; end if;
  select * into t from private.photo_transfers where photo_id=p_photo and version=p_transfer_version;
  if not found or t.captured_by is distinct from p_owner then
    raise exception 'Exact prepared transfer not found' using errcode='22023'; end if;
  select * into r from private.photo_transfer_receipts where photo_id=p_photo and transfer_version=t.version;
  if found then
    -- Persisted historical proof, not a promise that the object can currently be read.
    return jsonb_build_object('photo_id',t.photo_id,'transfer_version',t.version,'receipt_id',r.action_id,'state','RECEIVED');
  end if;
  select * into o from storage.objects where bucket_id=t.bucket and name=t.object_key
    and archived_at is null and not coalesce(is_delete_marker,false);
  if not found or o.owner_id is distinct from p_owner::text
    or coalesce(char_length(o.version) between 1 and 256,false)=false then
    raise exception 'Exact private object unavailable' using errcode='22023'; end if;
  return jsonb_build_object('photo_id',t.photo_id,'transfer_version',t.version,'state','WAITING',
    'owner_user_id',p_owner,'owner_session_id',p_session,'bucket',t.bucket,'object_key',t.object_key,
    'expected_sha256',t.prepared_sha256,'expected_size',t.prepared_size,'object_id',o.id,'object_version',o.version);
end;
$$;
create function public.photo_verification_target_for_session(p_photo uuid,p_transfer_version uuid,p_owner uuid,p_session uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.photo_verification_target_for_session(p_photo,p_transfer_version,p_owner,p_session)
$$;
revoke all on function private.photo_verification_target_for_session(uuid,uuid,uuid,uuid),
  public.photo_verification_target_for_session(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.photo_verification_target_for_session(uuid,uuid,uuid,uuid),
  public.photo_verification_target_for_session(uuid,uuid,uuid,uuid) to service_role;

-- Authenticated exact-object status for the original owner. This is the only source
-- allowed to turn an uncertain/missing TUS session into authoritative object absence.
-- It returns no reusable Storage URL, catalog id or object version.
create function private.photo_transfer_status(
  p_photo uuid,p_transfer_version uuid
) returns jsonb
language plpgsql stable security definer set search_path='' as $photo_status$
declare
  actor uuid:=auth.uid();
  session_id uuid;
  t private.photo_transfers%rowtype;
  o storage.objects%rowtype;
  r private.photo_transfer_receipts%rowtype;
begin
  if actor is null then
    raise exception 'Current original-owner transfer session required' using errcode='42501';
  end if;
  begin
    session_id:=(auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'Current original-owner transfer session required' using errcode='42501';
  end;
  if session_id is null
    or not private.photo_transfer_authorized_for_user(actor,session_id,p_photo) then
    raise exception 'Current original-owner transfer session required' using errcode='42501';
  end if;

  select * into t
  from private.photo_transfers
  where photo_id=p_photo and version=p_transfer_version and captured_by=actor;
  if not found then
    raise exception 'Exact prepared transfer not found' using errcode='22023';
  end if;

  select * into r
  from private.photo_transfer_receipts
  where photo_id=p_photo and transfer_version=t.version;
  if found then
    return jsonb_build_object(
      'photo_id',t.photo_id,
      'transfer_version',t.version,
      'receipt_id',r.action_id,
      'state','RECEIVED'
    );
  end if;

  select * into o
  from storage.objects
  where bucket_id=t.bucket and name=t.object_key;

  if not found then
    return jsonb_build_object(
      'photo_id',t.photo_id,
      'transfer_version',t.version,
      'state','ABSENT'
    );
  end if;

  if o.owner_id is distinct from actor::text
    or o.archived_at is not null
    or coalesce(o.is_delete_marker,false) then
    return jsonb_build_object(
      'photo_id',t.photo_id,
      'transfer_version',t.version,
      'state','CONFLICT'
    );
  end if;

  return jsonb_build_object(
    'photo_id',t.photo_id,
    'transfer_version',t.version,
    'state','PRESENT'
  );
end;
$photo_status$;
create function public.photo_transfer_status(p_photo uuid,p_transfer_version uuid)
returns jsonb language sql security invoker set search_path='' as $photo_wrapper$
  select private.photo_transfer_status(p_photo,p_transfer_version)
$photo_wrapper$;
revoke all on function private.photo_transfer_status(uuid,uuid),
  public.photo_transfer_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.photo_transfer_status(uuid,uuid),
  public.photo_transfer_status(uuid,uuid) to authenticated;

-- Retain one receipt/action/state engine behind a guarded entrance.
alter function private.confirm_photo_transfer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint)
  rename to confirm_photo_transfer_engine;
revoke all on function private.confirm_photo_transfer_engine(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint)
  from public,anon,authenticated,service_role;

create function private.confirm_photo_transfer(p_action uuid,p_photo uuid,p_transfer_version uuid,p_owner uuid,p_session uuid,
  p_object_id uuid,p_object_version text,p_bucket text,p_object_key text,p_observed_sha256 text,p_observed_size bigint)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  -- Same lifecycle/recovery/session locks as access changes, before transfer/catalog locks.
  perform private.lock_account_lifecycle();
  if not private.photo_transfer_authorized_for_user(p_owner,p_session,p_photo) then
    raise exception 'Current original-owner transfer session required' using errcode='42501'; end if;
  lock table storage.objects in share mode;
  if not exists(select 1 from storage.objects o where o.id=p_object_id and o.version=p_object_version
    and o.bucket_id=p_bucket and o.name=p_object_key and o.owner_id=p_owner::text
    and o.archived_at is null and not coalesce(o.is_delete_marker,false)) then
    raise exception 'Observed private object catalog identity changed or unavailable' using errcode='22023'; end if;
  return private.confirm_photo_transfer_engine(p_action,p_photo,p_transfer_version,p_owner,p_session,
    p_object_id,p_object_version,p_bucket,p_object_key,p_observed_sha256,p_observed_size);
end;
$$;
-- Rebind the existing SQL wrapper after the rename; no OID bypass to the engine.
create or replace function public.confirm_photo_transfer(p_action uuid,p_photo uuid,p_transfer_version uuid,p_owner uuid,p_session uuid,
  p_object_id uuid,p_object_version text,p_bucket text,p_object_key text,p_observed_sha256 text,p_observed_size bigint)
returns jsonb language sql security invoker set search_path='' as $$
  select private.confirm_photo_transfer(p_action,p_photo,p_transfer_version,p_owner,p_session,
    p_object_id,p_object_version,p_bucket,p_object_key,p_observed_sha256,p_observed_size)
$$;
revoke all on function private.confirm_photo_transfer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint),
  public.confirm_photo_transfer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function private.confirm_photo_transfer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint),
  public.confirm_photo_transfer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint) to service_role;

-- Phase 5C: private verified-photo review owner, scoped to current office work.
-- Source-only extension of this still-unapplied migration; no live authorization is enabled.
-- Reviewing is distinct from transfer acceptance, package approval, Send or cleanup.
create table private.photo_review_decisions (
  photo_id uuid primary key references private.photo_transfer_receipts(photo_id) on delete restrict,
  transfer_version uuid not null,
  observed_sha256 text not null check (observed_sha256 ~ '^[a-f0-9]{64}$'),
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  decision text not null check (decision in ('PENDING','APPROVED','REJECTED')),
  reason text not null default '' check (char_length(reason) <= 1000),
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  revision uuid not null default gen_random_uuid(),
  reviewed_at timestamptz not null default clock_timestamp(),
  check (decision <> 'REJECTED' or char_length(btrim(reason)) > 0)
);
create index photo_review_decisions_work_idx on private.photo_review_decisions(work_order_id,photo_id);
create table private.photo_review_actions (
  action_id uuid primary key,
  photo_id uuid not null references private.photo_transfer_receipts(photo_id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  transfer_version uuid not null,
  expected_revision uuid,
  decision text not null check (decision in ('PENDING','APPROVED','REJECTED')),
  reason text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index photo_review_actions_photo_idx on private.photo_review_actions(photo_id,created_at);
alter table private.photo_review_decisions enable row level security;
alter table private.photo_review_actions enable row level security;
revoke all on private.photo_review_decisions,private.photo_review_actions from public,anon,authenticated,service_role;
grant select on private.photo_review_decisions,private.photo_review_actions to service_role;
create trigger photo_review_actions_immutable before update or delete on private.photo_review_actions
  for each row execute function private.protect_photo_transfer_ledger();

-- Server-confirmed receipts are necessary but not enough for a usable private gallery.
-- The exact Storage catalog object must still be present. No raw bucket/key,
-- storage URL, reviewer-only rejection explanation or capturing-owner secret leaks.
create function private.admin_list_private_review_photos(
  p_work_order uuid,p_limit integer default 25,p_after_photo uuid default null
) returns jsonb
language plpgsql stable security definer set search_path='' as $review_list$
declare items jsonb; page_count integer; last_photo uuid;
begin
  if p_work_order is null or p_limit not in (25,50)
    or not private.current_identity_valid() or not private.can_work_order(p_work_order) then
    raise exception 'Current scoped office review required' using errcode='42501';
  end if;
  with eligible as (
    select t.photo_id,t.run_id,p.requirement_item_id,p.captured_at,r.transfer_version,
      r.observed_sha256,r.verified_at,coalesce(d.decision,'PENDING') as decision,
      d.revision as decision_revision,d.reason as review_reason
    from private.photo_transfer_receipts r
    join private.photo_transfers t on t.photo_id=r.photo_id and t.version=r.transfer_version
    join public.photos p on p.id=t.photo_id and p.work_order_id=t.work_order_id
    join storage.objects o on o.id=r.object_id and o.version=r.object_version
      and o.bucket_id=r.bucket and o.name=r.object_key
      and o.owner_id=r.owner_user_id::text and o.archived_at is null
      and not coalesce(o.is_delete_marker,false)
    left join private.photo_review_decisions d on d.photo_id=t.photo_id
    where t.work_order_id=p_work_order and t.state='RECEIVED'
      and (p_after_photo is null or t.photo_id>p_after_photo)
    order by t.photo_id limit p_limit+1
  ), shown as (select * from eligible order by photo_id limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object(
    'photo_id',photo_id,'run_id',run_id,'requirement_item_id',requirement_item_id,
    'captured_at',captured_at,'transfer_version',transfer_version,
    'observed_sha256',observed_sha256,'verified_at',verified_at,
    'decision',decision,'decision_revision',decision_revision,
    'reason',review_reason) order by photo_id),'[]'::jsonb)
  into items from shown;

  with eligible as (
    select t.photo_id from private.photo_transfer_receipts r
    join private.photo_transfers t on t.photo_id=r.photo_id and t.version=r.transfer_version
    join storage.objects o on o.id=r.object_id and o.version=r.object_version
      and o.bucket_id=r.bucket and o.name=r.object_key
      and o.owner_id=r.owner_user_id::text and o.archived_at is null and not coalesce(o.is_delete_marker,false)
    where t.work_order_id=p_work_order and t.state='RECEIVED'
      and (p_after_photo is null or t.photo_id>p_after_photo)
    order by t.photo_id limit p_limit+1
  ) select count(*),(max(photo_id::text) filter (where rn<=p_limit))::uuid
    into page_count,last_photo
    from (select photo_id,row_number() over(order by photo_id) rn from eligible) q;
  return jsonb_build_object('work_order_id',p_work_order,'photos',items,
    'next_photo',case when page_count>p_limit then last_photo else null end);
end;
$review_list$;

create function public.admin_list_private_review_photos(
  p_work_order uuid,p_limit integer default 25,p_after_photo uuid default null
) returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.admin_list_private_review_photos(p_work_order,p_limit,p_after_photo)
$wrap$;
revoke all on function private.admin_list_private_review_photos(uuid,integer,uuid),
  public.admin_list_private_review_photos(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function private.admin_list_private_review_photos(uuid,integer,uuid),
  public.admin_list_private_review_photos(uuid,integer,uuid) to authenticated,service_role;

-- Single authoritative review transaction. Every mutation revalidates office
-- entitlement, exact receipt/content, unchanged catalog and expected revision.
-- Changed action UUID payloads are forbidden; no last-write-wins on a shared WO.
create function private.admin_review_photo(
  p_action uuid,p_work_order uuid,p_photo uuid,p_transfer_version uuid,
  p_expected_revision uuid,p_decision text,p_reason text default ''
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $review_action$
declare prior private.photo_review_actions%rowtype; current_review private.photo_review_decisions%rowtype;
  receipt private.photo_transfer_receipts%rowtype; transfer private.photo_transfers%rowtype;
  actor uuid:=auth.uid(); result jsonb; explanation text:=btrim(coalesce(p_reason,''));
  revision uuid:=gen_random_uuid();
begin
  if p_action is null or p_work_order is null or p_photo is null or p_transfer_version is null
    or p_decision not in ('PENDING','APPROVED','REJECTED')
    or coalesce(char_length(explanation)<=1000,false)=false
    or (p_decision='REJECTED' and explanation='')
    or (p_decision<>'REJECTED' and explanation<>'') then
    raise exception 'Exact photo review decision and bounded reason required' using errcode='22023';
  end if;
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() or not private.can_work_order(p_work_order) then
    raise exception 'Current scoped office review required' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('fwh.review.photo.'||p_photo::text,0));
  select * into prior from private.photo_review_actions where action_id=p_action;
  if found then
    if row(prior.actor_user_id,prior.work_order_id,prior.photo_id,prior.transfer_version,
           prior.expected_revision,prior.decision,prior.reason) is distinct from
       row(actor,p_work_order,p_photo,p_transfer_version,p_expected_revision,p_decision,explanation) then
      raise exception 'Photo review action UUID reused with changed inputs' using errcode='22023';end if;
    return prior.result;
  end if;
  select * into transfer from private.photo_transfers where photo_id=p_photo;
  select * into receipt from private.photo_transfer_receipts where photo_id=p_photo;
  if receipt.photo_id is null or transfer.photo_id is null or transfer.work_order_id is distinct from p_work_order
    or receipt.transfer_version is distinct from p_transfer_version
    or transfer.version is distinct from p_transfer_version or transfer.state<>'RECEIVED'
    or not exists(select 1 from public.photos p where p.id=p_photo and p.work_order_id=p_work_order)
    or not exists(select 1 from storage.objects o where o.id=receipt.object_id and o.version=receipt.object_version
      and o.bucket_id=receipt.bucket and o.name=receipt.object_key
      and o.owner_id=receipt.owner_user_id::text and o.archived_at is null
      and not coalesce(o.is_delete_marker,false)) then
    raise exception 'Verified private photo is unavailable or identity changed' using errcode='22023';
  end if;
  select * into current_review from private.photo_review_decisions where photo_id=p_photo for update;
  if (case when found then current_review.revision else null end) is distinct from p_expected_revision then
    raise exception 'Photo review changed; reload' using errcode='40001';end if;
  insert into private.photo_review_decisions(photo_id,transfer_version,observed_sha256,work_order_id,
    decision,reason,reviewer_id,revision)
  values(p_photo,receipt.transfer_version,receipt.observed_sha256,p_work_order,p_decision,explanation,actor,revision)
  on conflict(photo_id) do update set decision=excluded.decision,reason=excluded.reason,
    reviewer_id=excluded.reviewer_id,revision=excluded.revision,reviewed_at=clock_timestamp()
    where private.photo_review_decisions.transfer_version=excluded.transfer_version
      and private.photo_review_decisions.observed_sha256=excluded.observed_sha256
      and private.photo_review_decisions.work_order_id=excluded.work_order_id;
  if not found then raise exception 'Frozen reviewed content changed' using errcode='22023';end if;
  result:=jsonb_build_object('action_id',p_action,'photo_id',p_photo,'work_order_id',p_work_order,
    'transfer_version',p_transfer_version,'decision',p_decision,'decision_revision',revision);
  insert into private.photo_review_actions(action_id,photo_id,work_order_id,actor_user_id,
    transfer_version,expected_revision,decision,reason,result)
    values(p_action,p_photo,p_work_order,actor,p_transfer_version,p_expected_revision,p_decision,explanation,result);
  return result;
end;
$review_action$;
create function public.admin_review_photo(
  p_action uuid,p_work_order uuid,p_photo uuid,p_transfer_version uuid,
  p_expected_revision uuid,p_decision text,p_reason text default ''
) returns jsonb language sql security invoker set search_path='' as $wrap$
  select private.admin_review_photo(p_action,p_work_order,p_photo,p_transfer_version,p_expected_revision,p_decision,p_reason)
$wrap$;
revoke all on function private.admin_review_photo(uuid,uuid,uuid,uuid,uuid,text,text),
  public.admin_review_photo(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.admin_review_photo(uuid,uuid,uuid,uuid,uuid,text,text),
  public.admin_review_photo(uuid,uuid,uuid,uuid,uuid,text,text) to authenticated,service_role;
