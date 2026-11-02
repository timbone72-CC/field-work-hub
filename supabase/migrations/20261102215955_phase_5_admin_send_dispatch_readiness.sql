-- Phase 5D approved safety correction: normal Admin Send must not queue while
-- general package dispatch is OFF, regardless of stale worker_ready=true.
-- SOURCE ONLY. Do not enable dispatch, retarget the already-delivered pinned TEST
-- worker, retry the original HELD upload, mutate outbox or contact Google.
-- Existing functions are replaced in place; signatures, grants, identities,
-- atomic action replay and provider-specific trusted TEST step paths remain.
-- Expected prior revision: 128 installed canonical migrations in FWH TEST.

CREATE OR REPLACE FUNCTION private.admin_package_state(p_wo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare w public.work_orders%rowtype; k private.client_packages%rowtype;
  items jsonb; saved jsonb; snapshot jsonb; hash text; eligible boolean:=false;
  problem text:=''; dest jsonb; ready boolean:=false; dispatch_enabled boolean:=false;
begin
  if p_wo is null or not private.current_identity_valid() or not private.can_work_order(p_wo) then
    raise exception 'Current scoped office job required' using errcode='42501';end if;
  select * into w from public.work_orders where id=p_wo;
  select * into k from private.client_packages where work_order_id=p_wo
    and run_id=w.current_run_id order by created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('photo_id',t.photo_id,
    'transfer_version',t.version,'run_id',t.run_id,
    'requirement_item_id',ph.requirement_item_id,
    'decision',coalesce(d.decision,'PENDING')) order by t.photo_id),'[]'::jsonb)
    into items
  from (select photo_id from private.photo_transfers where work_order_id=p_wo
    and state='RECEIVED' and exists(
      select 1 from public.work_order_runs cr
      where cr.id=private.photo_transfers.run_id and cr.work_order_id=p_wo
        and cr.field_status='FIELD_COMPLETE')
    order by photo_id limit 25) n
  join private.photo_transfers t on t.photo_id=n.photo_id
  join private.photo_transfer_receipts r on r.photo_id=t.photo_id and r.transfer_version=t.version
  join public.photos ph on ph.id=t.photo_id
  join storage.objects ob on ob.id=r.object_id and ob.version=r.object_version
    and ob.bucket_id=r.bucket and ob.name=r.object_key and ob.owner_id=r.owner_user_id::text
    and ob.archived_at is null and not coalesce(ob.is_delete_marker,false)
  left join private.photo_review_decisions d on d.photo_id=t.photo_id;
  -- Phase 6D now paginates; this compact compatibility list is only a first
  -- overview, never an upper limit on the actual verified photo selection.
  if jsonb_array_length(items)>25 then
    raise exception 'Bounded overview exceeded one page' using errcode='22023';end if;
  if k.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('photo_id',s.photo_id,'ordinal',s.ordinal)
      order by s.ordinal),'[]'::jsonb) into saved
    from private.client_package_photos s where s.package_id=k.id;
    begin
      snapshot:=private.client_package_manifest(k.id);
      hash:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
      eligible:=true;
    exception when others then
      eligible:=false; problem:='Selected photos or destination require review before approval.';
    end;
  end if;
  select jsonb_build_object('verified',d.verified,'company_name',c.name)
    into dest from private.client_delivery_destinations d
    join private.client_companies c on c.id=d.company_id
    where d.organization_id=w.organization_id and d.company_id=w.client_company_id
      and d.active and d.verified;
  select coalesce((select cfg.enabled and cfg.legacy_worker_off_verified
    from private.client_delivery_package_dispatch_config cfg
    where cfg.singleton),false) into dispatch_enabled;
  ready:=dispatch_enabled and eligible and k.status='APPROVED' and k.approved_sha256=hash
    and exists(select 1 from private.client_delivery_runtime rt
      where rt.organization_id=w.organization_id and rt.worker_ready);
  return jsonb_build_object('work_order_id',p_wo,'available_photos',items,
    'too_many_photos',false,'paged_selection',true,'coverage_message',problem,
    'destination',dest,'package',case when k.id is null then null else
      jsonb_build_object('id',k.id,'status',k.status,'revision',k.revision,
        'notes',k.notes,'photos',coalesce(saved,'[]'::jsonb),
        'manifest_sha256',case when eligible then hash else null end,
        'ready_to_approve',eligible and k.status='DRAFT',
        'can_send',coalesce(ready,false),
        'send_blocked_reason',case when not dispatch_enabled
          then 'Automatic client delivery is paused; Send is unavailable.'
          else null end) end);
end;
$function$;

CREATE OR REPLACE FUNCTION private.admin_queue_package(p_action uuid, p_wo uuid, p_package uuid, p_expected_revision uuid, p_manifest_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare k private.client_packages%rowtype; prior private.client_package_actions%rowtype;
  fingerprint text; m jsonb; result jsonb; verified boolean;
begin
  if p_action is null or p_wo is null or p_package is null or p_expected_revision is null
    or p_manifest_sha256 is null or p_manifest_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Explicit approved package Send identity required' using errcode='22023';end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_wo,p_package,
    p_expected_revision,p_manifest_sha256)::text,'UTF8')),'hex');
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() or not private.can_work_order(p_wo) then
    raise exception 'Current scoped office Send authority required' using errcode='42501';end if;
  select * into prior from private.client_package_actions where action_id=p_action;
  if prior.action_id is not null then
    if prior.actor_user_id is distinct from auth.uid() or prior.action_kind<>'SEND'
      or prior.request_fingerprint<>fingerprint then
      raise exception 'Changed Send action UUID' using errcode='22023';end if;
    return prior.result;
  end if;
  -- Lock the config row through the Send transaction: a concurrent disable
  -- cannot race a new QUEUED outbox item into an unserved delivery queue.
  perform 1 from private.client_delivery_package_dispatch_config cfg
    where cfg.singleton and cfg.enabled and cfg.legacy_worker_off_verified
    for share;
  if not found then
    raise exception 'Automatic client delivery is paused; no Send queued'
      using errcode='42501';
  end if;
  select * into k from private.client_packages where id=p_package and work_order_id=p_wo for update;
  if k.id is null or k.status<>'APPROVED' or k.revision is distinct from p_expected_revision
    or k.approved_sha256 is distinct from p_manifest_sha256 then
    raise exception 'Approved package or revision changed; no Send' using errcode='40001';end if;
  if not exists(select 1 from private.client_delivery_runtime rt
      where rt.organization_id=k.organization_id and rt.worker_ready) then
    raise exception 'Verified trusted provider worker not enabled; no Send queued' using errcode='42501';end if;
  m:=private.client_package_manifest(k.id);
  if m is distinct from k.approved_manifest
    or encode(sha256(convert_to(m::text,'UTF8')),'hex')<>k.approved_sha256 then
    raise exception 'Approved manifest changed; no Send queued' using errcode='40001';end if;
  if exists(select 1 from private.client_delivery_outbox where package_id=k.id) then
    raise exception 'Delivery already requested; inspect prior attempt' using errcode='40001';end if;
  update private.client_packages set status='QUEUED',revision=gen_random_uuid()
    where id=k.id returning * into k;
  result:=jsonb_build_object('package_id',k.id,'status','QUEUED','revision',k.revision,
    'manifest_sha256',k.approved_sha256);
  insert into private.client_package_actions(action_id,package_id,actor_user_id,action_kind,
    request_fingerprint,result) values(p_action,k.id,auth.uid(),'SEND',fingerprint,result);
  insert into private.client_delivery_outbox(package_id,action_id,approved_sha256,destination_id)
    values(k.id,p_action,k.approved_sha256,k.destination_id);
  return result;
end;
$function$;
