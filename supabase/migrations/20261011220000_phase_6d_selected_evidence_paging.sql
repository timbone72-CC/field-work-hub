-- Phase 6D source-only exact extensions of the existing Phase 5 package
-- owners, no new Send, provider, cleanup or authorization paths.
-- Stable keyset page of original and corrected evidence, preserving exact
-- photo UUID, immutable run and verification. Current corrective run first.
create function private.admin_package_photo_page(
 p_wo uuid,p_limit integer,p_after_sequence integer,p_after_photo uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $page$
declare v_items jsonb; v_more integer; v_sequence integer; v_photo uuid;
begin
 if p_wo is null or p_limit not in (25,50) or
   ((p_after_sequence is null) is distinct from (p_after_photo is null)) or
   (p_after_sequence is not null and p_after_sequence<1) or
   not private.current_identity_valid() or not private.can_work_order(p_wo)
 then raise exception 'Scoped bounded client-package evidence required' using errcode='42501';end if;
 with candidates as(
   select t.photo_id,t.run_id,run.run_sequence,ph.requirement_item_id,
     coalesce(dec.decision,'PENDING') decision,
     t.version transfer_version,receipt.observed_sha256,
     case when run.run_sequence=1 then ph.requirement_item_id
       else (select nullif(mapping.value->>'release_item_id','')::uuid
         from jsonb_array_elements(co.item_mapping) mapping
         where mapping.value->>'capture_item_id'=ph.requirement_item_id::text)
     end as release_item_id
   from private.photo_transfers t
   join public.work_order_runs run on run.id=t.run_id and
     run.work_order_id=p_wo and run.field_status='FIELD_COMPLETE'
   join public.photos ph on ph.id=t.photo_id and ph.work_order_id=p_wo
     and ph.run_id=t.run_id
   join private.photo_transfer_receipts receipt on receipt.photo_id=t.photo_id
     and receipt.transfer_version=t.version
   join storage.objects obj on obj.id=receipt.object_id and
     obj.version=receipt.object_version and obj.bucket_id=receipt.bucket
     and obj.name=receipt.object_key and obj.owner_id=receipt.owner_user_id::text
     and obj.archived_at is null and not coalesce(obj.is_delete_marker,false)
   left join private.photo_review_decisions dec on dec.photo_id=t.photo_id
   left join private.correction_obligations co on co.replacement_run_id=t.run_id
     and co.work_order_id=p_wo
   where t.work_order_id=p_wo and t.state='RECEIVED'
     and (run.run_sequence=1 or co.id is not null)
     and (p_after_sequence is null or run.run_sequence<p_after_sequence
       or (run.run_sequence=p_after_sequence and t.photo_id>p_after_photo))
     and private.photo_has_accepted_finish(t.photo_id)
   order by run.run_sequence desc,t.photo_id asc limit p_limit+1
 ),numbered as(
   select c.*,row_number() over(order by run_sequence desc,photo_id asc) rn from candidates c
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'photo_id',photo_id,'run_id',run_id,'run_sequence',run_sequence,
   'requirement_item_id',requirement_item_id,'release_item_id',release_item_id,
   'transfer_version',transfer_version,'observed_sha256',observed_sha256,
   'decision',decision) order by run_sequence desc,photo_id asc)
     filter(where rn<=p_limit),'[]'::jsonb),
   count(*) filter(where rn>p_limit),
   min(run_sequence) filter(where rn=p_limit),
   (min(photo_id::text) filter(where rn=p_limit))::uuid
 into v_items,v_more,v_sequence,v_photo from numbered;
 return jsonb_build_object('work_order_id',p_wo,'photos',v_items,
   'next_sequence',case when v_more>0 then v_sequence else null end,
   'next_photo',case when v_more>0 then v_photo else null end);
end;$page$;
create function public.admin_package_photo_page(
 p_wo uuid,p_limit integer,p_after_sequence integer,p_after_photo uuid
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_package_photo_page(p_wo,p_limit,p_after_sequence,p_after_photo)
$$;
revoke all on function private.admin_package_photo_page(uuid,integer,integer,uuid),
 public.admin_package_photo_page(uuid,integer,integer,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_package_photo_page(uuid,integer,integer,uuid),
 public.admin_package_photo_page(uuid,integer,integer,uuid)
 to authenticated,service_role;


-- Keep superseded correction evidence eligible for explicitly chosen final
-- photos, while demanding NEW photos only for still OPEN obligations.
create or replace function private.client_package_manifest(p_package uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $manifest$
declare k private.client_packages%rowtype; w public.work_orders%rowtype;
  d private.client_delivery_destinations%rowtype; req jsonb; item jsonb;
  v_photos jsonb:='[]'::jsonb; n integer:=0; selected_count integer; required_total integer;
  selected_named integer; p record; obligation record; obligation_count integer; capture_item jsonb;
  new_covered integer; correction_manifest jsonb:='[]'::jsonb;
  selected_layout jsonb; manifest jsonb; geo private.client_delivery_geography%rowtype;
begin
  select * into k from private.client_packages where id=p_package;
  if k.id is null or k.status='SUPERSEDED' then raise exception 'Package superseded or unavailable' using errcode='42501';end if;
  select * into w from public.work_orders where id=k.work_order_id;
  if w.organization_id is distinct from k.organization_id or w.client_company_id is distinct from k.company_id
    or w.current_run_id is distinct from k.run_id or w.field_status<>'FIELD_COMPLETE' then
    raise exception 'Current accepted work identity changed or Finish missing' using errcode='40001';end if;
  if exists(select 1 from private.client_packages prior
     where prior.work_order_id=w.id and prior.id<>k.id
       and prior.status in ('QUEUED','DELIVERING','FAILED','UNCERTAIN')) then
    raise exception 'Earlier client delivery unresolved' using errcode='40001';end if;
  select * into d from private.client_delivery_destinations
    where organization_id=k.organization_id and company_id=k.company_id
      and active and verified
      and (k.status='DRAFT' or id=k.destination_id);
  if d.id is null then raise exception 'Verified client destination required' using errcode='42501';end if;
  -- Run 1 uses its frozen capture goals; later runs use the separately
  -- revisioned client release snapshot, never a replacement capture snapshot.
  if w.current_run_sequence=1 then
    select requirement_snapshot into req from public.work_order_runs where id=k.run_id;
  else req:=w.release_requirement_snapshot;end if;
  perform private.validate_photo_requirements(req);
  select count(*) into selected_count from private.client_package_photos where package_id=k.id;
  if selected_count>5000 then raise exception 'Package selection too large' using errcode='22023';end if;
  for p in
    select s.ordinal,s.photo_id,t.run_id,t.version,r.observed_sha256,r.observed_size,
      ph.requirement_item_id,coalesce(dec.decision,'PENDING') as decision,
      case when run.run_sequence=1 then ph.requirement_item_id
       when obl.id is not null then
        (select nullif(mapped.value->>'release_item_id','')::uuid
         from jsonb_array_elements(obl.item_mapping) mapped
         where mapped.value->>'capture_item_id'=ph.requirement_item_id::text)
       else null end as release_item_id
    from private.client_package_photos s
    join private.photo_transfers t on t.photo_id=s.photo_id
    join public.work_order_runs run on run.id=t.run_id
      and run.work_order_id=k.work_order_id
      and run.organization_id=k.organization_id
      and run.field_status='FIELD_COMPLETE'
    left join private.correction_obligations obl
      on obl.replacement_run_id=run.id and obl.work_order_id=k.work_order_id
       -- retain historical mapping even after a correction is superseded
       -- (coverage only applies to active OPEN obligations below)
    join private.photo_transfer_receipts r on r.photo_id=t.photo_id and r.transfer_version=t.version
    join public.photos ph on ph.id=t.photo_id and ph.work_order_id=k.work_order_id
      and ph.run_id=t.run_id
    left join private.photo_review_decisions dec on dec.photo_id=t.photo_id
    join storage.objects ob on ob.id=r.object_id and ob.version=r.object_version
      and ob.bucket_id=r.bucket and ob.name=r.object_key and ob.owner_id=r.owner_user_id::text
      and ob.archived_at is null and not coalesce(ob.is_delete_marker,false)
    where s.package_id=k.id and t.state='RECEIVED'
      and (run.run_sequence=1 or obl.id is not null)
    order by s.ordinal
  loop
    if p.decision='REJECTED' or (w.review_required and p.decision<>'APPROVED')
      or not private.photo_has_accepted_finish(p.photo_id) then
      raise exception 'Selected evidence not approved, received or Finish-accepted' using errcode='42501';end if;
    n:=n+1;
    v_photos:=v_photos||jsonb_build_array(jsonb_build_object('ordinal',p.ordinal,
      'photo_id',p.photo_id,'run_id',p.run_id,'transfer_version',p.version,
      'observed_sha256',p.observed_sha256,'observed_size',p.observed_size,
      'item_id',p.requirement_item_id,'release_item_id',p.release_item_id,
      'review_decision',p.decision));
  end loop;
  if n<>selected_count then
    raise exception 'Missing or foreign private receipt, rejected photo, or changed Storage object' using errcode='42501';end if;
  required_total:=case when (req->'total'->>'enabled')::boolean then (req->'total'->>'minimum')::integer else 0 end;
  if n<required_total then raise exception 'Package total photo coverage incomplete' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(req->'items') loop
    if (item->>'enabled')::boolean then
      select count(*) into selected_named from jsonb_array_elements(v_photos) photo
        where photo->>'release_item_id'=item->>'id';
      if selected_named<(item->>'minimum')::integer then
        raise exception 'Required named photo coverage incomplete' using errcode='22023';end if;
    end if;
  end loop;
  -- Every active correction must supply newly selected, accepted photos
  -- from its *own* designated replacement run. Old run evidence cannot count.
  for obligation in
    select o.id,o.replacement_run_id,o.capture_requirements,o.release_revision
    from private.correction_obligations o
    where o.work_order_id=w.id and o.status='OPEN'
  loop
    select count(*) into obligation_count from jsonb_array_elements(v_photos) selected_photo
      where selected_photo.value->>'run_id'=obligation.replacement_run_id::text;
    if (obligation.capture_requirements->'total'->>'enabled')::boolean
       and obligation_count<(obligation.capture_requirements->'total'->>'minimum')::int
    then raise exception 'Correction requires new-run total coverage' using errcode='22023';end if;
    for capture_item in select value from jsonb_array_elements(obligation.capture_requirements->'items') loop
      if (capture_item->>'enabled')::boolean then
        select count(*) into new_covered from jsonb_array_elements(v_photos) selected_photo
          where selected_photo.value->>'run_id'=obligation.replacement_run_id::text
            and selected_photo.value->>'item_id'=capture_item->>'id';
        if new_covered<(capture_item->>'minimum')::int then
          raise exception 'Correction requires new-run named photo coverage' using errcode='22023';end if;
      end if;
    end loop;
    correction_manifest:=correction_manifest||jsonb_build_array(
      jsonb_build_object('obligation_id',obligation.id,'replacement_run_id',
        obligation.replacement_run_id,'release_revision',obligation.release_revision));
  end loop;
  manifest:=jsonb_build_object('package_id',k.id,'organization_id',k.organization_id,
    'work_order_id',w.id,'client_company_id',k.company_id,'client_wo_number',w.wo_number,
    'client_notes',k.notes,'current_run_id',k.run_id,'requirements',req,
    'release_requirement_revision',w.release_requirement_revision,
    'correction_obligations',correction_manifest,
    'review_required',w.review_required,'review_policy_revision',w.review_policy_revision,
    'destination_id',d.id,'destination_revision',d.revision,'destination_provider',d.provider,
    'destination_root',d.root_folder_id,'selected_photos',v_photos);
  -- Rebuild live release evidence, but retain the ORIGINAL approved layout
  -- and remote destination snapshot. A newer company configuration cannot
  -- redirect an already approved package during Send reconciliation.
  if k.status<>'DRAFT' and k.approved_manifest is not null then
    if k.approved_manifest->>'destination_id' is distinct from d.id::text
      or k.approved_manifest->>'destination_revision' is distinct from d.revision::text
      or k.approved_manifest->>'destination_root' is distinct from d.root_folder_id then
      raise exception 'Approved destination identity changed' using errcode='40001';
    end if;
    if k.approved_manifest ? 'folder_layout' then
      manifest:=manifest||jsonb_build_object(
        'folder_layout',k.approved_manifest->>'folder_layout',
        'folder_layout_revision',k.approved_manifest->>'folder_layout_revision');
    end if;
    if k.approved_manifest ? 'geographic_path' then
      manifest:=manifest||jsonb_build_object(
        'geographic_path',k.approved_manifest->'geographic_path');
    end if;
    return manifest;
  end if;
  selected_layout:=private.phase_5_current_folder_layout(d.id,k.organization_id,k.company_id);
  if selected_layout->>'configured'='true' then
    manifest:=manifest||jsonb_build_object(
      'folder_layout',selected_layout->>'layout',
      'folder_layout_revision',selected_layout->>'revision');
    if selected_layout->>'layout' in ('STATE_COUNTY_CITY_ADDRESS','STATE_CITY_ADDRESS') then
      select * into geo from private.client_delivery_geography
        where organization_id=k.organization_id and company_id=k.company_id
          and work_order_id=k.work_order_id;
      -- Existing strict verification and no-fallback rule; no guess from ZIP.
      k.destination_id:=d.id;
      k.approved_manifest:=jsonb_build_object('folder_layout',selected_layout->>'layout');
      -- Draft previews do not yet have the approval trigger's frozen address.
      -- Compute the same canonical key, then the trigger independently freezes
      -- that identical current WO address at the approval transaction.
      k.folder_address_snapshot:=btrim(w.property_address);
      if char_length(k.folder_address_snapshot) not between 3 and 320 then
        raise exception 'Address snapshot unavailable' using errcode='22023';end if;
      k.folder_address_key:=encode(sha256(convert_to(
        lower(regexp_replace(btrim(w.property_address),'[[:space:]]+',' ','g')),'UTF8')),'hex');
      manifest:=manifest||jsonb_build_object(
        'geographic_path',private.phase_5_expected_geographic_path(k,geo));
    end if;
  end if;
  return manifest;
end;
$manifest$;

-- Bounded selection list and editable draft now include eligible old/new runs
-- for this *same WO*, with exact accepted Finish verified at manifest evaluation.

-- Compact package state; actual gallery selection uses bounded keyset pages.
create or replace function private.admin_package_state(p_wo uuid) returns jsonb
language plpgsql security definer set search_path='' as $state$
declare w public.work_orders%rowtype; k private.client_packages%rowtype;
  items jsonb; saved jsonb; snapshot jsonb; hash text; eligible boolean:=false;
  problem text:=''; dest jsonb; ready boolean:=false;
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
  ready:=eligible and k.status='APPROVED' and k.approved_sha256=hash
    and exists(select 1 from private.client_delivery_runtime rt
      where rt.organization_id=w.organization_id and rt.worker_ready);
  return jsonb_build_object('work_order_id',p_wo,'available_photos',items,
    'too_many_photos',false,'paged_selection',true,'coverage_message',problem,
    'destination',dest,'package',case when k.id is null then null else
      jsonb_build_object('id',k.id,'status',k.status,'revision',k.revision,
        'notes',k.notes,'photos',coalesce(saved,'[]'::jsonb),
        'manifest_sha256',case when eligible then hash else null end,
        'ready_to_approve',eligible and k.status='DRAFT',
        'can_send',coalesce(ready,false)) end);
end;
$state$;

-- The immutable manifest already permits 5000 selected photos; remove the
-- obsolete browser-era 200-photo request restriction without bypassing any
-- owner, review/receipt/Finish or destination verification.
create or replace function private.admin_save_package_draft(
  p_action uuid,p_wo uuid,p_expected_revision uuid,p_notes text,p_photo_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $draft$
declare w public.work_orders%rowtype; k private.client_packages%rowtype;
  prior private.client_package_actions%rowtype; fingerprint text;
  n int; selected uuid; result jsonb;
begin
  if p_action is null or p_wo is null or p_notes is null or char_length(p_notes)>2000
    or p_photo_ids is null or coalesce(array_length(p_photo_ids,1),0)>5000
    or array_position(p_photo_ids,null) is not null then
    raise exception 'Explicit bounded draft inputs required' using errcode='22023';end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_wo,p_expected_revision,
    p_notes,to_jsonb(p_photo_ids))::text,'UTF8')),'hex');
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() or not private.can_work_order(p_wo) then
    raise exception 'Scoped office draft authority required' using errcode='42501';end if;
  select * into w from public.work_orders where id=p_wo for update;
  if w.client_company_id is null then
    raise exception 'Explicit client company required before preparing package' using errcode='42501';end if;
  if w.current_run_id is null then raise exception 'Current run required' using errcode='22023';end if;
  select * into prior from private.client_package_actions where action_id=p_action;
  if prior.action_id is not null then
    if prior.actor_user_id is distinct from auth.uid() or prior.action_kind<>'DRAFT'
      or prior.request_fingerprint<>fingerprint then
      raise exception 'Package action UUID reused with changed inputs' using errcode='22023';end if;
    return prior.result;
  end if;
  select * into k from private.client_packages
    where work_order_id=p_wo and run_id=w.current_run_id for update;
  if k.id is not null and k.status<>'DRAFT' then
    raise exception 'Approved or queued package is immutable' using errcode='40001';end if;
  if (case when k.id is null then null else k.revision end) is distinct from p_expected_revision then
    raise exception 'Draft changed; reload' using errcode='40001';end if;
  for n in 1..coalesce(array_length(p_photo_ids,1),0) loop
    selected:=p_photo_ids[n];
    if selected=any(p_photo_ids[1:n-1]) or not exists(
      select 1 from private.photo_transfers t
      join private.photo_transfer_receipts r on r.photo_id=t.photo_id and r.transfer_version=t.version
      where t.photo_id=selected and t.work_order_id=p_wo
        and t.state='RECEIVED' and exists(
          select 1 from public.work_order_runs cr
          where cr.id=t.run_id and cr.work_order_id=p_wo
            and cr.organization_id=w.organization_id and cr.field_status='FIELD_COMPLETE'
            and (cr.run_sequence=1 or exists(
              select 1 from private.correction_obligations co
              where co.replacement_run_id=cr.id and co.work_order_id=p_wo
                and co.status in ('OPEN','SATISFIED'))))
    ) then raise exception 'Draft contains duplicate, foreign or unreceived evidence' using errcode='42501';end if;
  end loop;
  if k.id is null then
    insert into private.client_packages(organization_id,work_order_id,run_id,company_id,notes)
      values(w.organization_id,p_wo,w.current_run_id,w.client_company_id,p_notes) returning * into k;
  else
    update private.client_packages set notes=p_notes,revision=gen_random_uuid()
      where id=k.id returning * into k;
    delete from private.client_package_photos where package_id=k.id;
  end if;
  for n in 1..coalesce(array_length(p_photo_ids,1),0) loop
    insert into private.client_package_photos(package_id,photo_id,ordinal)
      values(k.id,p_photo_ids[n],n);
  end loop;
  result:=jsonb_build_object('id',k.id,'revision',k.revision,'status','DRAFT');
  insert into private.client_package_actions(action_id,package_id,actor_user_id,action_kind,
    request_fingerprint,result) values(p_action,k.id,auth.uid(),'DRAFT',fingerprint,result);
  return result;
end;
$draft$;
