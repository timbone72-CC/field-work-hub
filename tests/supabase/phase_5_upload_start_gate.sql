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

-- Positive disposable lease: the SAME authorized file may begin exactly once.
-- Test SQL inserts only synthetic rows in this outer ROLLBACK transaction.
do $one_start$
declare
  org uuid:='00000000-0000-0000-0000-000000000001';
  admin_id uuid:='00000000-0000-0000-0000-000000000010';
  contractor uuid:='00000000-0000-0000-0000-000000000011';
  company uuid:=gen_random_uuid();
  destination uuid:=gen_random_uuid();
  pkg uuid:=gen_random_uuid();
  work uuid;
  run_id uuid;
  action_id uuid:=gen_random_uuid();
  file_plan uuid:=gen_random_uuid();
  worker uuid:=gen_random_uuid();
  manifest_hash text:=repeat('a',64);
  response jsonb;
  denied boolean;
  envelope jsonb:=jsonb_build_object('version','1',
    'nonce',repeat('N',22),'payload',repeat('P',64));
begin
  insert into private.client_companies(id,organization_id,name)
   values(company,org,'UPLOAD START FENCE DISPOSABLE');
  insert into private.client_delivery_destinations
    (id,organization_id,company_id,provider,provider_identity,root_folder_id)
   values(destination,org,company,'GOOGLE_DRIVE','test@disposable.invalid',
    'disposable_unverified_root_123456');

  perform set_config('request.jwt.claims',jsonb_build_object(
     'sub',admin_id,'session_id',admin_id,
     'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  execute 'set local role authenticated';
  select (j->>'work_order_id')::uuid into work
   from public.admin_create_work_order_v4(false,'UPLOAD-START-TEST',
     'DISPOSABLE ADDRESS','TEST','',current_date,contractor,
     jsonb_build_object('schema',1,'revision',gen_random_uuid(),
       'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb)) j;
  execute 'reset role';
  select current_run_id into run_id from public.work_orders where id=work;

  insert into private.client_packages
    (id,organization_id,work_order_id,run_id,company_id,status,
     approved_manifest,approved_sha256,approved_by,approved_at,
     destination_id,folder_address_snapshot,folder_address_key)
   values(pkg,org,work,run_id,company,'DELIVERING','{}'::jsonb,
     manifest_hash,admin_id,now(),destination,
     'DISPOSABLE ADDRESS',repeat('b',64));
  insert into private.client_package_actions
    (action_id,package_id,actor_user_id,action_kind,request_fingerprint,result)
   values(action_id,pkg,admin_id,'SEND',repeat('c',64),'{}'::jsonb);
  insert into private.client_delivery_outbox
    (package_id,action_id,approved_sha256,destination_id,state,
     worker_id,lease_generation,lease_until,attempts)
   values(pkg,action_id,manifest_hash,destination,'DELIVERING',
     worker,1,clock_timestamp()+interval '2 minutes',1);
  insert into private.client_delivery_file_plans
    (id,package_id,kind,drive_file_id,drive_parent_id,
     expected_sha256,expected_size,mime_type)
   values(file_plan,pkg,'MANIFEST','disposable_remote_file_123456',
     'disposable_remote_parent_123456',manifest_hash,2,'application/json');

  execute 'set local role service_role';
  response:=public.service_read_upload_session(pkg,worker,1,file_plan);
  if response->>'exists'<>'false' then
    raise exception 'Fresh eligible plan falsely has a stored session';
  end if;
  -- A wrong worker, stale generation, or wrong plan must not mark the attempt.
  denied:=false;
  begin
   perform public.service_begin_upload_session(pkg,gen_random_uuid(),1,file_plan);
  exception when serialization_failure then denied:=true;
  end;
  if not denied then raise exception 'Wrong worker began upload'; end if;
  denied:=false;
  begin
   perform public.service_begin_upload_session(pkg,worker,2,file_plan);
  exception when serialization_failure then denied:=true;
  end;
  if not denied then raise exception 'Stale generation began upload'; end if;
  denied:=false;
  begin
   perform public.service_begin_upload_session(pkg,worker,1,gen_random_uuid());
  exception when serialization_failure then denied:=true;
  end;
  if not denied then raise exception 'Unreserved file began upload'; end if;
  if exists(select 1 from private.client_delivery_upload_starts
    where file_plan_id=file_plan) then
     raise exception 'Invalid attempts left a durable start marker';
  end if;

  response:=public.service_begin_upload_session(pkg,worker,1,file_plan);
  if response->>'plan_id'<>file_plan::text
    or response->>'start_recorded'<>'true' then
    raise exception 'Positive SQL acknowledgement omitted exact durable proof';
  end if;
  if (select count(*) from private.client_delivery_upload_starts
      where file_plan_id=file_plan and package_id=pkg)<>1 then
    raise exception 'Exactly one start marker must be committed';
  end if;
  -- A missing session URL after the start may mean that Google already
  -- processed the POST. It must NEVER be treated as safe to begin again.
  denied:=false;
  begin
   perform public.service_read_upload_session(pkg,worker,1,file_plan);
  exception when serialization_failure then denied:=true;
  end;
  if not denied then raise exception 'Lost session URL was treated as safe absence';end if;
  denied:=false;
  begin
   perform public.service_begin_upload_session(pkg,worker,1,file_plan);
  exception when serialization_failure then denied:=true;
  end;
  if not denied then raise exception 'Second session start was permitted';end if;

  -- The original encrypted session can be saved once, but may never be
  -- silently swapped for a different Google URL or restarted.
  response:=public.service_store_upload_session(pkg,worker,1,file_plan,envelope);
  if response->>'file_plan_id'<>file_plan::text then
    raise exception 'Exact encrypted session was not journaled';
  end if;
  response:=public.service_read_upload_session(pkg,worker,1,file_plan);
  if response->>'exists'<>'true' or response->>'plan_id'<>file_plan::text
    or response->>'total_bytes'<>'2'
    or response->'encrypted'<>envelope then
    raise exception 'Exact original encrypted session not recovered';
  end if;
  denied:=false;
  begin
   perform public.service_store_upload_session(pkg,worker,1,file_plan,
     jsonb_set(envelope,'{payload}',to_jsonb(repeat('Q',64))));
  exception when serialization_failure then denied:=true;
  end;
  if not denied then raise exception 'Existing session was overwritten';end if;
  denied:=false;
  begin
   perform public.service_begin_upload_session(pkg,worker,1,file_plan);
  exception when serialization_failure then denied:=true;
  end;
  if not denied then raise exception 'Saved session allowed another start';end if;
  if (select count(*) from private.client_delivery_upload_starts
       where file_plan_id=file_plan)<>1 then
     raise exception 'Multiple marker rows exist';
  end if;
  execute 'reset role';
end;
$one_start$;
rollback;
