-- Immutable prepared JPEG identity and receipt ledger, not a byte verifier.
-- No bucket, Storage grants, signed URLs, provider release or cleanup here.
create table private.photo_transfers (
  photo_id uuid primary key references public.photos(id) on delete restrict,
  version uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  captured_by uuid not null references auth.users(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  run_id uuid not null,
  finish_set_id uuid not null references public.photo_finish_sets(id) on delete restrict,
  assignment_instance_id uuid not null,
  requirement_revision uuid,
  finish_digest text not null check(finish_digest ~ '^[a-f0-9]{64}$'),
  prepared_sha256 text not null check(prepared_sha256 ~ '^[a-f0-9]{64}$'),
  prepared_size bigint not null check(prepared_size>0),
  bucket text not null default 'fwh-review-private' check(bucket='fwh-review-private'),
  object_key text not null,
  state text not null default 'WAITING' check(state in ('WAITING','RECEIVED')),
  registered_at timestamptz not null default clock_timestamp(),
  unique(photo_id,version),
  unique(bucket,object_key),
  foreign key(run_id,work_order_id) references public.work_order_runs(id,work_order_id) on delete restrict,
  foreign key(assignment_instance_id,run_id) references public.work_order_assignments(id,run_id) on delete restrict,
  check(object_key=organization_id::text||'/'||work_order_id::text||'/'||run_id::text||'/'||photo_id::text||'.jpg')
);
create index photo_transfers_org_idx on private.photo_transfers(organization_id);
create index photo_transfers_owner_idx on private.photo_transfers(captured_by,photo_id);
create index photo_transfers_work_idx on private.photo_transfers(work_order_id);
create index photo_transfers_run_work_idx on private.photo_transfers(run_id,work_order_id);
create index photo_transfers_finish_idx on private.photo_transfers(finish_set_id);
create index photo_transfers_assignment_run_idx on private.photo_transfers(assignment_instance_id,run_id);

create table private.photo_transfer_actions (
  action_id uuid primary key,
  photo_id uuid not null references private.photo_transfers(photo_id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  prepared_sha256 text not null,
  prepared_size bigint not null,
  result jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index photo_transfer_actions_photo_idx on private.photo_transfer_actions(photo_id);
create index photo_transfer_actions_actor_idx on private.photo_transfer_actions(actor_user_id);

create table private.photo_transfer_receipts (
  action_id uuid primary key,
  photo_id uuid not null unique,
  transfer_version uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  owner_session_id uuid not null, -- Historical Auth session may later be pruned.
  object_id uuid not null,
  object_version text not null check(char_length(object_version) between 1 and 256),
  bucket text not null check(bucket='fwh-review-private'),
  object_key text not null,
  observed_sha256 text not null check(observed_sha256 ~ '^[a-f0-9]{64}$'),
  observed_size bigint not null check(observed_size>0),
  verified_at timestamptz not null default clock_timestamp(),
  unique(object_id,object_version),
  foreign key(photo_id,transfer_version) references private.photo_transfers(photo_id,version) on delete restrict
);
create index photo_transfer_receipts_owner_idx on private.photo_transfer_receipts(owner_user_id);
create table private.photo_receipt_actions (
  action_id uuid primary key,
  photo_id uuid not null references private.photo_transfers(photo_id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  manifest jsonb not null,
  result jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index photo_receipt_actions_photo_idx on private.photo_receipt_actions(photo_id);
create index photo_receipt_actions_actor_idx on private.photo_receipt_actions(actor_user_id);

-- Trusted verifier accepts identity only from its validated incoming Auth context.
-- The ordinary client never supplies another user's identity to this helper.
create function private.photo_transfer_authorized_for_user(p_user uuid,p_session uuid,p_photo uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    join public.photos p on p.captured_by=u.id join public.work_orders w on w.id=p.work_order_id
    where u.id=p_user and s.id=p_session and p.id=p_photo
      and u.email_confirmed_at is not null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now()) and (s.not_after is null or s.not_after>now())
      and private.photo_has_accepted_finish(p_photo)
      and (private.work_role_for_user(p_user,w.organization_id)='CONTRACTOR'
        or exists(select 1 from private.photo_recovery_members m join private.photo_recovery_grants g on g.action_id=m.grant_id
          where m.user_id=p_user and m.captured_by=p_user and m.photo_id=p_photo and g.state='READY'
            and m.accepted_finish_at_cutoff and private.recovery_member_binding_valid(m.grant_id,m.photo_id))))
$$;
revoke all on function private.photo_transfer_authorized_for_user(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.photo_transfer_authorized_for_user(uuid,uuid,uuid) to service_role;

create function private.begin_photo_transfer(p_action uuid,p_photo uuid,p_prepared_sha256 text,p_prepared_size bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=auth.uid(); session_id uuid; p public.photos%rowtype; t private.photo_transfers%rowtype;
  prior private.photo_transfer_actions%rowtype; org uuid; digest text; result jsonb;
begin
  if not private.current_identity_valid() then raise exception 'Current verified identity required' using errcode='42501';end if;
  session_id:=(auth.jwt()->>'session_id')::uuid;
  if p_action is null or p_photo is null or p_prepared_size is null or p_prepared_size<=0
    or coalesce(p_prepared_sha256 ~ '^[a-f0-9]{64}$',false)=false then
    raise exception 'Exact prepared hash and positive byte length required' using errcode='22023';end if;
  lock table private.photo_transfers,private.photo_transfer_actions,private.photo_transfer_receipts in share row exclusive mode;
  lock table auth.users,private.account_work_access in share mode;
  lock table public.work_orders,public.photos,public.photo_finish_sets,public.field_actions in share mode;
  if not private.photo_transfer_authorized_for_user(actor,session_id,p_photo) then
    raise exception 'Original owner and accepted Finish authority required' using errcode='42501';end if;
  select * into prior from private.photo_transfer_actions where action_id=p_action;
  if found then
    if row(prior.actor_user_id,prior.photo_id,prior.prepared_sha256,prior.prepared_size)
      is distinct from row(actor,p_photo,p_prepared_sha256,p_prepared_size) then
      raise exception 'Transfer action reused with changed inputs' using errcode='22023';end if;
    return prior.result;
  end if;
  select * into p from public.photos where id=p_photo;
  select organization_id into org from public.work_orders where id=p.work_order_id;
  select f.digest into digest from public.photo_finish_sets f where f.id=p.finish_set_id;
  select * into t from private.photo_transfers where photo_id=p_photo;
  if found then
    if row(t.organization_id,t.captured_by,t.work_order_id,t.run_id,t.finish_set_id,t.assignment_instance_id,t.requirement_revision,t.finish_digest,
      t.prepared_sha256,t.prepared_size) is distinct from row(org,actor,p.work_order_id,p.run_id,p.finish_set_id,p.assignment_instance_id,
      p.requirement_revision,digest,p_prepared_sha256,p_prepared_size) then
      raise exception 'Prepared content is already bound; replacement denied' using errcode='22023';end if;
  else
    insert into private.photo_transfers(photo_id,organization_id,captured_by,work_order_id,run_id,finish_set_id,assignment_instance_id,
      requirement_revision,finish_digest,prepared_sha256,prepared_size,object_key)
      values(p_photo,org,actor,p.work_order_id,p.run_id,p.finish_set_id,p.assignment_instance_id,p.requirement_revision,digest,
        p_prepared_sha256,p_prepared_size,org::text||'/'||p.work_order_id::text||'/'||p.run_id::text||'/'||p_photo::text||'.jpg') returning * into t;
  end if;
  result:=jsonb_build_object('photo_id',t.photo_id,'transfer_version',t.version,'bucket',t.bucket,'object_key',t.object_key,
    'prepared_sha256',t.prepared_sha256,'prepared_size',t.prepared_size,'state',t.state);
  insert into private.photo_transfer_actions(action_id,photo_id,actor_user_id,prepared_sha256,prepared_size,result)
    values(p_action,p_photo,actor,p_prepared_sha256,p_prepared_size,result);
  return result;
end;
$$;
create function public.begin_photo_transfer(p_action uuid,p_photo uuid,p_prepared_sha256 text,p_prepared_size bigint) returns jsonb
language sql security invoker set search_path='' as $$
  select private.begin_photo_transfer(p_action,p_photo,p_prepared_sha256,p_prepared_size)
$$;
revoke all on function public.begin_photo_transfer(uuid,uuid,text,bigint),private.begin_photo_transfer(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.begin_photo_transfer(uuid,uuid,text,bigint),private.begin_photo_transfer(uuid,uuid,text,bigint) to authenticated,service_role;

-- This accepts observations from a future trusted object-download verifier only.
-- A client upload-success response is never a verification input.
create function private.confirm_photo_transfer(p_action uuid,p_photo uuid,p_transfer_version uuid,p_owner uuid,p_session uuid,
  p_object_id uuid,p_object_version text,p_bucket text,p_object_key text,p_observed_sha256 text,p_observed_size bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare t private.photo_transfers%rowtype; prior private.photo_transfer_receipts%rowtype; p public.photos%rowtype;
  prior_action private.photo_receipt_actions%rowtype; manifest jsonb; result jsonb;
begin
  if p_action is null or p_photo is null or p_transfer_version is null or p_owner is null or p_session is null or p_object_id is null
    or coalesce(char_length(p_object_version) between 1 and 256,false)=false then
    raise exception 'Exact trusted receipt identity required' using errcode='22023';end if;
  lock table private.photo_transfers,private.photo_transfer_actions,private.photo_transfer_receipts,private.photo_receipt_actions in share row exclusive mode;
  lock table auth.users,private.account_work_access in share mode;
  lock table public.work_orders,public.photos,public.photo_finish_sets,public.field_actions in share mode;
  if not private.photo_transfer_authorized_for_user(p_owner,p_session,p_photo) then
    raise exception 'Current original-owner session and Finish authority required' using errcode='42501';end if;
  select * into t from private.photo_transfers where photo_id=p_photo;
  if not found then raise exception 'Prepared content registration required' using errcode='22023';end if;
  select * into p from public.photos where id=p_photo;
  if row(p.work_order_id,p.run_id,p.captured_by,p.finish_set_id,p.assignment_instance_id,p.requirement_revision,
    (select digest from public.photo_finish_sets where id=p.finish_set_id))
    is distinct from row(t.work_order_id,t.run_id,t.captured_by,t.finish_set_id,t.assignment_instance_id,t.requirement_revision,t.finish_digest)
    or row(p_transfer_version,p_owner,p_bucket,p_object_key,p_observed_sha256,p_observed_size)
    is distinct from row(t.version,t.captured_by,t.bucket,t.object_key,t.prepared_sha256,t.prepared_size) then
    raise exception 'Observed object does not match immutable prepared identity' using errcode='22023';end if;
  manifest:=jsonb_build_array(p_photo,p_transfer_version,p_owner,p_session,p_object_id,p_object_version,p_bucket,p_object_key,p_observed_sha256,p_observed_size);
  select * into prior_action from private.photo_receipt_actions where action_id=p_action;
  if found then
    if prior_action.manifest is distinct from manifest then
      raise exception 'Receipt action reused with changed inputs' using errcode='22023';end if;
    return prior_action.result;
  end if;
  select * into prior from private.photo_transfer_receipts where photo_id=p_photo;
  if found then
    if row(prior.transfer_version,prior.object_id,prior.object_version,prior.bucket,prior.object_key,prior.observed_sha256,prior.observed_size)
      is distinct from row(p_transfer_version,p_object_id,p_object_version,p_bucket,p_object_key,p_observed_sha256,p_observed_size) then
      raise exception 'Received object replacement denied' using errcode='22023';end if;
    result:=jsonb_build_object('photo_id',p_photo,'transfer_version',p_transfer_version,'receipt_id',prior.action_id,'state','RECEIVED');
    insert into private.photo_receipt_actions(action_id,photo_id,actor_user_id,manifest,result) values(p_action,p_photo,p_owner,manifest,result);
    return result;
  end if;
  insert into private.photo_transfer_receipts(action_id,photo_id,transfer_version,owner_user_id,owner_session_id,object_id,object_version,
    bucket,object_key,observed_sha256,observed_size) values(p_action,p_photo,p_transfer_version,p_owner,p_session,p_object_id,p_object_version,
      p_bucket,p_object_key,p_observed_sha256,p_observed_size);
  update private.photo_transfers set state='RECEIVED' where photo_id=p_photo;
  result:=jsonb_build_object('photo_id',p_photo,'transfer_version',p_transfer_version,'receipt_id',p_action,'state','RECEIVED');
  insert into private.photo_receipt_actions(action_id,photo_id,actor_user_id,manifest,result) values(p_action,p_photo,p_owner,manifest,result);
  return result;
end;
$$;
create function public.confirm_photo_transfer(p_action uuid,p_photo uuid,p_transfer_version uuid,p_owner uuid,p_session uuid,
  p_object_id uuid,p_object_version text,p_bucket text,p_object_key text,p_observed_sha256 text,p_observed_size bigint) returns jsonb
language sql security invoker set search_path='' as $$
  select private.confirm_photo_transfer(p_action,p_photo,p_transfer_version,p_owner,p_session,p_object_id,p_object_version,p_bucket,p_object_key,p_observed_sha256,p_observed_size)
$$;
revoke all on function public.confirm_photo_transfer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint),
  private.confirm_photo_transfer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.confirm_photo_transfer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint),
  private.confirm_photo_transfer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint) to service_role;

create function private.protect_photo_transfer_binding() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Prepared identity cannot be deleted' using errcode='42501';end if;
  if row(new.photo_id,new.version,new.organization_id,new.captured_by,new.work_order_id,new.run_id,new.finish_set_id,new.assignment_instance_id,
    new.requirement_revision,new.finish_digest,new.prepared_sha256,new.prepared_size,new.bucket,new.object_key,new.registered_at)
    is distinct from row(old.photo_id,old.version,old.organization_id,old.captured_by,old.work_order_id,old.run_id,old.finish_set_id,old.assignment_instance_id,
    old.requirement_revision,old.finish_digest,old.prepared_sha256,old.prepared_size,old.bucket,old.object_key,old.registered_at)
    or (new.state is distinct from old.state and (old.state<>'WAITING' or new.state<>'RECEIVED'
      or not exists(select 1 from private.photo_transfer_receipts r where r.photo_id=old.photo_id and r.transfer_version=old.version
        and r.owner_user_id=old.captured_by and r.bucket=old.bucket and r.object_key=old.object_key
        and r.observed_sha256=old.prepared_sha256 and r.observed_size=old.prepared_size))) then
    raise exception 'Prepared identity or verified state is immutable' using errcode='42501';end if;
  return new;
end;
$$;
create function private.protect_photo_transfer_ledger() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Transfer action and receipt records are immutable' using errcode='42501';end;
$$;
create trigger photo_transfers_protect_binding before update or delete on private.photo_transfers
  for each row execute function private.protect_photo_transfer_binding();
create trigger photo_transfer_actions_immutable before update or delete on private.photo_transfer_actions
  for each row execute function private.protect_photo_transfer_ledger();
create trigger photo_transfer_receipts_immutable before update or delete on private.photo_transfer_receipts
  for each row execute function private.protect_photo_transfer_ledger();
create trigger photo_receipt_actions_immutable before update or delete on private.photo_receipt_actions
  for each row execute function private.protect_photo_transfer_ledger();
revoke all on function private.protect_photo_transfer_binding(),private.protect_photo_transfer_ledger() from public,anon,authenticated;

alter table private.photo_transfers enable row level security;
alter table private.photo_transfer_actions enable row level security;
alter table private.photo_transfer_receipts enable row level security;
alter table private.photo_receipt_actions enable row level security;
revoke all on private.photo_transfers,private.photo_transfer_actions,private.photo_transfer_receipts,private.photo_receipt_actions from public,anon,authenticated,service_role;
grant select on private.photo_transfers,private.photo_transfer_actions,private.photo_transfer_receipts,private.photo_receipt_actions to service_role;
