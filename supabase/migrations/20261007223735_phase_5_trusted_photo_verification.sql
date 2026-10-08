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
language plpgsql stable security definer set search_path='' as $
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
$;
create function public.photo_transfer_status(p_photo uuid,p_transfer_version uuid)
returns jsonb language sql security invoker set search_path='' as $
  select private.photo_transfer_status(p_photo,p_transfer_version)
$;
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
