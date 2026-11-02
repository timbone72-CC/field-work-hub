-- Phase 6C additive bulk review using the authoritative private Phase 5
-- review engine for every photo. One transaction, sorted photo locks, exact
-- content+decision revisions and immutable action UUID. No bypass via Off mode.
create table private.photo_bulk_review_actions(
 action_id uuid primary key,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 run_id uuid,
 photo_set jsonb not null check(jsonb_typeof(photo_set)='array'),
 decision text not null check(decision in ('APPROVED','REJECTED')),
 reason text not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.photo_bulk_review_actions enable row level security;
revoke all on private.photo_bulk_review_actions from public,anon,authenticated,service_role;
grant select on private.photo_bulk_review_actions to service_role;
create trigger photo_bulk_review_actions_immutable before update or delete
 on private.photo_bulk_review_actions for each row
 execute function private.protect_photo_transfer_ledger();

create function private.admin_review_photos_bulk(
 p_action uuid,p_work_order uuid,p_run uuid,p_photos jsonb,p_decision text,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $bulk$
declare act private.photo_bulk_review_actions%rowtype; item jsonb; n integer;
 pid uuid; ver uuid; expected uuid; prior private.photo_review_decisions%rowtype;
 transfer private.photo_transfers%rowtype; receipt private.photo_transfer_receipts%rowtype;
 conflicts jsonb:='[]'::jsonb; results jsonb:='[]'::jsonb;
 explanation text:=btrim(coalesce(p_reason,'')); actor uuid:=auth.uid();
begin
 if p_action is null or p_work_order is null or p_photos is null
   or jsonb_typeof(p_photos)<>'array'
   or jsonb_array_length(p_photos) not between 1 and 50
   or p_decision not in ('APPROVED','REJECTED')
   or length(explanation)>1000
   or (p_decision='REJECTED' and explanation='')
   or (p_decision='APPROVED' and explanation<>'')
 then raise exception 'Bounded exact bulk review, decision and reason required' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_photos) v
   where jsonb_typeof(v.value)<>'object'
      or (select count(*) from jsonb_object_keys(v.value))<>3
      or not(v.value ? 'photo_id' and v.value ? 'transfer_version' and v.value ? 'expected_revision')
      or jsonb_typeof(v.value->'photo_id')<>'string'
      or jsonb_typeof(v.value->'transfer_version')<>'string'
      or jsonb_typeof(v.value->'expected_revision') not in ('string','null'))
 then raise exception 'Exact per-photo content and revision required' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_photos) v
   group by v.value->>'photo_id' having count(*)>1)
 then raise exception 'Duplicate photo selection' using errcode='22023';end if;
 perform private.lock_account_lifecycle();
 if not private.current_identity_valid() or not private.can_work_order(p_work_order)
 then raise exception 'Current scoped office photo review required' using errcode='42501';end if;
 -- Idempotent exact replay and different photo-set/action denial. Single WO lock
 -- prevents two bulk writes on the same job from silently interleaving.
 perform 1 from public.work_orders where id=p_work_order for update;
 select * into act from private.photo_bulk_review_actions where action_id=p_action;
 if act.action_id is not null then
   if row(act.actor_id,act.work_order_id,act.run_id,act.photo_set,act.decision,act.reason)
      is distinct from row(actor,p_work_order,p_run,p_photos,p_decision,explanation)
   then raise exception 'Changed bulk review action identity' using errcode='40001';end if;
   return act.result;
 end if;
 if p_run is not null and not exists(
   select 1 from public.work_order_runs r
    where r.id=p_run and r.work_order_id=p_work_order)
 then raise exception 'Run does not belong to reviewed work order' using errcode='42501';end if;
 for item in select value from jsonb_array_elements(p_photos)
     order by value->>'photo_id'
 loop
   begin
     pid:=(item->>'photo_id')::uuid;
     ver:=(item->>'transfer_version')::uuid;
     expected:=nullif(item->>'expected_revision','')::uuid;
   exception when invalid_text_representation then
     raise exception 'Invalid photo/version/revision UUID' using errcode='22023';
   end;
   perform pg_advisory_xact_lock(hashtextextended('fwh.review.photo.'||pid::text,0));
 end loop;
 for item in select value from jsonb_array_elements(p_photos)
     order by value->>'photo_id'
 loop
   pid:=(item->>'photo_id')::uuid;
   ver:=(item->>'transfer_version')::uuid;
   expected:=nullif(item->>'expected_revision','')::uuid;
   select * into transfer from private.photo_transfers where photo_id=pid;
   select * into receipt from private.photo_transfer_receipts where photo_id=pid;
   select * into prior from private.photo_review_decisions where photo_id=pid for update;
   if transfer.photo_id is null or transfer.work_order_id is distinct from p_work_order
      or (p_run is not null and transfer.run_id is distinct from p_run)
      or transfer.version is distinct from ver or transfer.state<>'RECEIVED'
      or receipt.photo_id is null or receipt.transfer_version is distinct from ver
      or not exists(select 1 from public.photos ph
         where ph.id=pid and ph.work_order_id=p_work_order and ph.run_id=transfer.run_id)
      or not exists(select 1 from storage.objects ob
         where ob.id=receipt.object_id and ob.version=receipt.object_version
           and ob.bucket_id=receipt.bucket and ob.name=receipt.object_key
           and ob.owner_id=receipt.owner_user_id::text
           and ob.archived_at is null and not coalesce(ob.is_delete_marker,false))
      or (case when prior.photo_id is null then null else prior.revision end)
           is distinct from expected
      or (prior.photo_id is not null and (
          prior.transfer_version is distinct from ver
          or prior.observed_sha256 is distinct from receipt.observed_sha256))
   then conflicts:=conflicts||jsonb_build_array(jsonb_build_object(
     'photo_id',pid,'reason','CONTENT_OR_REVISION_CHANGED'));
   end if;
 end loop;
 if jsonb_array_length(conflicts)>0 then
   return jsonb_build_object('outcome','CONFLICT','work_order_id',p_work_order,
      'conflicts',conflicts,'applied',0);
 end if;
 -- An unrelated photo stays outside the selected set; the underlying single-
 -- photo engine supplies its existing review action/receipt audit, atomically.
 for item in select value from jsonb_array_elements(p_photos)
    order by value->>'photo_id'
 loop
   pid:=(item->>'photo_id')::uuid;
   results:=results||jsonb_build_array(private.admin_review_photo(
      md5(p_action::text||':'||pid::text)::uuid,
      p_work_order,pid,(item->>'transfer_version')::uuid,
      nullif(item->>'expected_revision','')::uuid,
      p_decision,explanation));
 end loop;
 insert into private.photo_bulk_review_actions(
   action_id,work_order_id,actor_id,run_id,photo_set,decision,reason,result)
 values(p_action,p_work_order,actor,p_run,p_photos,p_decision,explanation,
   jsonb_build_object('outcome','APPLIED','work_order_id',p_work_order,
     'applied',jsonb_array_length(p_photos),'photos',results));
 return jsonb_build_object('outcome','APPLIED','work_order_id',p_work_order,
   'applied',jsonb_array_length(p_photos),'photos',results);
end;$bulk$;
create function public.admin_review_photos_bulk(
 p_action uuid,p_work_order uuid,p_run uuid,p_photos jsonb,p_decision text,p_reason text
) returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_review_photos_bulk(p_action,p_work_order,p_run,p_photos,p_decision,p_reason)
$$;
revoke all on function private.admin_review_photos_bulk(uuid,uuid,uuid,jsonb,text,text),
 public.admin_review_photos_bulk(uuid,uuid,uuid,jsonb,text,text)
 from public,anon,authenticated,service_role;
grant execute on function private.admin_review_photos_bulk(uuid,uuid,uuid,jsonb,text,text),
 public.admin_review_photos_bulk(uuid,uuid,uuid,jsonb,text,text)
 to authenticated,service_role;
