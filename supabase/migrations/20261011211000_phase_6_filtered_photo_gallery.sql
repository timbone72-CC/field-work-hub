-- Phase 6C: bounded server-reviewed photo pages ordered by newest run and
-- stable photo UUID. No all-photo download or guessed category/stage.
create function private.admin_review_photo_page(
 p_wo uuid,p_limit integer,p_after_sequence integer,p_after_photo uuid,
 p_run uuid,p_item uuid,p_extra boolean,p_stage text,p_decision text
) returns jsonb language plpgsql stable security definer set search_path='' as $page$
declare items jsonb; extra_count integer; last_seq integer; last_photo uuid;
begin
 if p_wo is null or p_limit not in (25,50)
   or ((p_after_sequence is null) is distinct from (p_after_photo is null))
   or (p_after_sequence is not null and p_after_sequence<1)
   or (p_stage is not null and p_stage not in ('NONE','BEFORE','DURING','AFTER'))
   or (p_decision is not null and p_decision not in ('PENDING','APPROVED','REJECTED'))
   or (p_item is not null and coalesce(p_extra,false))
   or not private.current_identity_valid() or not private.can_work_order(p_wo)
 then raise exception 'Current bounded scoped review page required' using errcode='42501';end if;
 if p_run is not null and not exists(select 1 from public.work_order_runs r
   where r.id=p_run and r.work_order_id=p_wo)
 then raise exception 'Run outside reviewed work' using errcode='42501';end if;
 with eligible as(
   select t.photo_id,t.run_id,run.run_sequence,ph.requirement_item_id,
     ph.captured_at,t.version as transfer_version,receipt.observed_sha256,
     receipt.verified_at,coalesce(dec.decision,'PENDING') as decision,
     dec.revision as decision_revision,dec.reason,
     coalesce(goal.value->>'label','Extra') as item_label,
     coalesce(goal.value->>'stage','NONE') as item_stage
   from private.photo_transfer_receipts receipt
   join private.photo_transfers t on t.photo_id=receipt.photo_id
     and t.version=receipt.transfer_version
   join public.photos ph on ph.id=t.photo_id and ph.work_order_id=p_wo and ph.run_id=t.run_id
   join public.work_order_runs run on run.id=t.run_id and run.work_order_id=p_wo
   join storage.objects o on o.id=receipt.object_id and o.version=receipt.object_version
     and o.bucket_id=receipt.bucket and o.name=receipt.object_key
     and o.owner_id=receipt.owner_user_id::text
     and o.archived_at is null and not coalesce(o.is_delete_marker,false)
   left join private.photo_review_decisions dec on dec.photo_id=t.photo_id
   left join lateral jsonb_array_elements(run.requirement_snapshot->'items') goal(value)
     on goal.value->>'id'=ph.requirement_item_id::text
   where t.work_order_id=p_wo and t.state='RECEIVED'
     and (p_run is null or t.run_id=p_run)
     and (p_item is null or ph.requirement_item_id=p_item)
     and (not coalesce(p_extra,false) or ph.requirement_item_id is null)
     and (p_stage is null or coalesce(goal.value->>'stage','NONE')=p_stage)
     and (p_decision is null or coalesce(dec.decision,'PENDING')=p_decision)
     and (p_after_sequence is null or run.run_sequence<p_after_sequence
       or (run.run_sequence=p_after_sequence and t.photo_id>p_after_photo))
   order by run.run_sequence desc,t.photo_id asc limit p_limit+1
 ), numbered as(
   select e.*,row_number() over(order by run_sequence desc,photo_id asc) rn from eligible e
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'photo_id',photo_id,'run_id',run_id,'run_sequence',run_sequence,
   'requirement_item_id',requirement_item_id,'requirement_label',item_label,
   'stage',item_stage,'captured_at',captured_at,'transfer_version',transfer_version,
   'observed_sha256',observed_sha256,'verified_at',verified_at,
   'decision',decision,'decision_revision',decision_revision,'reason',reason)
     order by run_sequence desc,photo_id asc) filter (where rn<=p_limit),'[]'::jsonb),
   count(*) filter(where rn>p_limit),
   min(run_sequence) filter(where rn=p_limit),
   (min(photo_id::text) filter(where rn=p_limit))::uuid
 into items,extra_count,last_seq,last_photo
 from numbered;
 return jsonb_build_object('work_order_id',p_wo,'photos',items,
   'next_sequence',case when extra_count>0 then last_seq else null end,
   'next_photo',case when extra_count>0 then last_photo else null end);
end;$page$;
create function public.admin_review_photo_page(
 p_wo uuid,p_limit integer,p_after_sequence integer,p_after_photo uuid,
 p_run uuid,p_item uuid,p_extra boolean,p_stage text,p_decision text
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_review_photo_page(p_wo,p_limit,p_after_sequence,p_after_photo,
   p_run,p_item,p_extra,p_stage,p_decision)
$$;
revoke all on function private.admin_review_photo_page(uuid,integer,integer,uuid,uuid,uuid,boolean,text,text),
 public.admin_review_photo_page(uuid,integer,integer,uuid,uuid,uuid,boolean,text,text)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_review_photo_page(uuid,integer,integer,uuid,uuid,uuid,boolean,text,text),
 public.admin_review_photo_page(uuid,integer,integer,uuid,uuid,uuid,boolean,text,text)
 to authenticated,service_role;
