-- Do not copy or replace the evolved Phase 5 delivery engine: multiple
-- later migrations add immutable provider-file, path, ancestor and receipt
-- guards. Rename that FINAL exact engine and extend its successful result.
-- This wrapper cannot skip or weaken ANY Phase 5 provider check.
alter function private.service_finish_delivery(uuid,uuid,bigint)
  rename to service_finish_delivery_phase5_engine;
revoke all on function private.service_finish_delivery_phase5_engine(uuid,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function private.service_finish_delivery_phase5_engine(uuid,uuid,bigint)
  to service_role;
create function private.service_finish_delivery(
 p_package uuid,p_worker uuid,p_generation bigint
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' as $closure$
declare result jsonb; k private.client_packages%rowtype;
begin
 -- The complete final provider implementation is still the ONLY delivery
 -- engine. It locks/validates exact current worker, folder/manifest/photos,
 -- verified parent chain, immutable Drive IDs and expected provider bytes.
 result:=private.service_finish_delivery_phase5_engine(
    p_package,p_worker,p_generation);
 if result->>'status'<>'DELIVERED' then
   raise exception 'Verified delivery required for correction closure'
      using errcode='42501';end if;
 select * into k from private.client_packages where id=p_package for update;
 if k.status<>'DELIVERED' or k.approved_manifest is null then
   raise exception 'Frozen confirmed client package required'
     using errcode='42501';end if;
 update private.correction_obligations co set status='SATISFIED'
  where co.work_order_id=k.work_order_id and co.status='OPEN'
    and exists(select 1 from jsonb_array_elements(
      coalesce(k.approved_manifest->'correction_obligations','[]'::jsonb)) active
      where active.value->>'obligation_id'=co.id::text
        and active.value->>'replacement_run_id'=co.replacement_run_id::text);
 return result;
end;
$closure$;
revoke all on function private.service_finish_delivery(uuid,uuid,bigint)
 from public,anon,authenticated,service_role;
grant execute on function private.service_finish_delivery(uuid,uuid,bigint)
 to service_role;

-- Refresh this original public entrance's function binding after the rename.
-- It retains the original service-role-only execution grant.
create or replace function public.service_finish_delivery(
 p_package uuid,p_worker uuid,p_generation bigint
) returns jsonb language sql security invoker set search_path='' as $wrap$
 select private.service_finish_delivery(p_package,p_worker,p_generation)
$wrap$;
revoke all on function public.service_finish_delivery(uuid,uuid,bigint)
 from public,anon,authenticated,service_role;
grant execute on function public.service_finish_delivery(uuid,uuid,bigint)
 to service_role;
