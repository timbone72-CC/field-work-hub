-- Catalog/permission and invalid-lease gate for durable session-start authority.
-- No actual Google request or live destination is involved.
begin;
do $gate$
declare denied boolean:=false;
begin
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname='client_delivery_upload_starts'
      and c.relrowsecurity) then
   raise exception 'One-shot upload start table must have RLS enabled';
 end if;
 if has_table_privilege('authenticated',
      'private.client_delivery_upload_starts','INSERT')
    or has_table_privilege('service_role',
      'private.client_delivery_upload_starts','INSERT') then
   raise exception 'No direct start-marker writes permitted';
 end if;
 if has_function_privilege('authenticated',
      'public.service_begin_upload_session(uuid,uuid,bigint,uuid)','EXECUTE')
   or not has_function_privilege('service_role',
      'public.service_begin_upload_session(uuid,uuid,bigint,uuid)','EXECUTE') then
   raise exception 'Session-start RPC must be service-only';
 end if;
 execute 'set local role service_role';
 begin
   perform public.service_begin_upload_session(gen_random_uuid(),
     gen_random_uuid(),1,gen_random_uuid());
 exception when serialization_failure then denied:=true;
 end;
 execute 'reset role';
 if not denied then
   raise exception 'Unclaimed lease began a remote session';
 end if;
end;
$gate$;
rollback;
