-- Phase 5E / Phase 6F: bounded read-only recovery of VERIFIED private
-- prepared JPEGs from immutable, READY, per-user historical grants.
-- No work authority, delivery, review, cleanup or source-file mutation.
create function private.photo_recovery_page(
  p_after_photo uuid default null,p_limit integer default 25
) returns jsonb
language plpgsql stable security definer set search_path='' as $recovery_page$
declare
  items jsonb; cursor uuid; n bigint;
begin
  if p_limit is null or p_limit not in (25,50)
    or not private.current_identity_valid()
    or not exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id'
      and s.user_id=auth.uid() and s.created_at>now()-interval '30 minutes'
      and (s.not_after is null or s.not_after>now())) then
    raise exception 'Fresh verified recovery session required' using errcode='42501';
  end if;
  with eligible as (
    select distinct on(m.photo_id) m.photo_id,m.work_order_id,m.run_id,
      p.captured_at,t.version as transfer_version,r.verified_at,r.observed_size
    from private.photo_recovery_members m
    join private.photo_recovery_grants g on g.action_id=m.grant_id
      and g.organization_id=m.organization_id and g.user_id=m.user_id
    join public.photos p on p.id=m.photo_id
    join private.photo_transfers t on t.photo_id=m.photo_id
      and t.organization_id=m.organization_id and t.work_order_id=m.work_order_id
      and t.run_id=m.run_id and t.captured_by=m.captured_by
    join private.photo_transfer_receipts r on r.photo_id=t.photo_id
      and r.transfer_version=t.version and r.owner_user_id=t.captured_by
      and r.bucket=t.bucket and r.object_key=t.object_key
      and r.observed_sha256=t.prepared_sha256 and r.observed_size=t.prepared_size
    join storage.objects o on o.id=r.object_id and o.version=r.object_version
      and o.bucket_id=r.bucket and o.name=r.object_key
      and o.owner_id=r.owner_user_id::text and o.archived_at is null
      and not coalesce(o.is_delete_marker,false)
    where m.user_id=auth.uid() and g.state='READY' and t.state='RECEIVED'
      and (p_after_photo is null or m.photo_id>p_after_photo)
      and private.recovery_member_binding_valid(m.grant_id,m.photo_id)
      and private.can_recover_photo(m.photo_id)
    order by m.photo_id,g.action_id
  ), page as (
    select * from eligible order by photo_id limit p_limit+1
  ), numbered as (
    select *,row_number() over(order by photo_id) rn from page
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'photo_id',photo_id,'work_order_id',work_order_id,'run_id',run_id,
    'captured_at',captured_at,'transfer_version',transfer_version,
    'verified_at',verified_at,'prepared_size',observed_size) order by photo_id)
    filter(where rn<=p_limit),'[]'::jsonb),
    (max(photo_id::text) filter(where rn<=p_limit))::uuid,count(*)
  into items,cursor,n from numbered;
  return jsonb_build_object('photos',items,
    'next_photo',case when n>p_limit then cursor else null end);
end;
$recovery_page$;
create function public.photo_recovery_page(
  p_after_photo uuid default null,p_limit integer default 25
) returns jsonb language sql security invoker set search_path='' as $$
  select private.photo_recovery_page(p_after_photo,p_limit)
$$;
revoke all on function private.photo_recovery_page(uuid,integer),
  public.photo_recovery_page(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.photo_recovery_page(uuid,integer),
  public.photo_recovery_page(uuid,integer) to authenticated;

-- Service-only target for the existing exact-JPEG signed-link owner. The Edge
-- caller must first independently validate the bearer at Auth /user, and
-- supply its exact actor/session; a browser cannot call this privileged RPC.
create function private.photo_recovery_target_for_session(
  p_photo uuid,p_transfer_version uuid,p_actor uuid,p_session uuid
) returns jsonb
language plpgsql stable security definer set search_path='' as $recovery_target$
declare t private.photo_transfers%rowtype; r private.photo_transfer_receipts%rowtype;
begin
  if p_photo is null or p_transfer_version is null or p_actor is null or p_session is null
    or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=p_actor and s.id=p_session and u.deleted_at is null
        and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until<=now())
        and (s.not_after is null or s.not_after>now())
        and s.created_at>now()-interval '30 minutes')
  then raise exception 'Fresh verified recovery session required' using errcode='42501';end if;
  select * into t from private.photo_transfers
    where photo_id=p_photo and version=p_transfer_version and state='RECEIVED';
  select * into r from private.photo_transfer_receipts
    where photo_id=p_photo and transfer_version=p_transfer_version;
  if t.photo_id is null or r.photo_id is null
    or t.captured_by is distinct from r.owner_user_id
    or t.bucket is distinct from r.bucket or t.object_key is distinct from r.object_key
    or t.prepared_sha256 is distinct from r.observed_sha256
    or t.prepared_size is distinct from r.observed_size
    or not exists(
      select 1 from private.photo_recovery_grants g
      join private.photo_recovery_members m on m.grant_id=g.action_id
        and m.organization_id=g.organization_id and m.user_id=g.user_id
      where g.state='READY' and g.user_id=p_actor
        and g.organization_id=t.organization_id and m.photo_id=p_photo
        and m.work_order_id=t.work_order_id and m.run_id=t.run_id
        and m.captured_by=t.captured_by
        and private.recovery_member_binding_valid(g.action_id,p_photo))
    or not exists(select 1 from storage.objects o
      where o.id=r.object_id and o.version=r.object_version
        and o.bucket_id=r.bucket and o.name=r.object_key
        and o.owner_id=r.owner_user_id::text
        and o.archived_at is null and not coalesce(o.is_delete_marker,false))
  then raise exception 'Exact verified historical photo unavailable' using errcode='42501';end if;
  return jsonb_build_object('photo_id',t.photo_id,'transfer_version',t.version,
    'bucket',r.bucket,'object_key',r.object_key,
    'object_id',r.object_id,'object_version',r.object_version);
end;
$recovery_target$;
create function public.photo_recovery_target_for_session(
  p_photo uuid,p_transfer_version uuid,p_actor uuid,p_session uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select private.photo_recovery_target_for_session(
    p_photo,p_transfer_version,p_actor,p_session)
$$;
revoke all on function private.photo_recovery_target_for_session(uuid,uuid,uuid,uuid),
  public.photo_recovery_target_for_session(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.photo_recovery_target_for_session(uuid,uuid,uuid,uuid),
  public.photo_recovery_target_for_session(uuid,uuid,uuid,uuid) to service_role;
