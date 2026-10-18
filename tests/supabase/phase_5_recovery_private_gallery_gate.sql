-- Disposable 5E exact prepared-JPEG recovery, no live bytes or provider writes.
begin;
do $gate$
declare
  org uuid:=gen_random_uuid(); team uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  capturer uuid:=gen_random_uuid(); actor uuid;
  wo uuid; v_run uuid; instance uuid; v_requirement_revision uuid;
  photo uuid:=gen_random_uuid(); later uuid:=gen_random_uuid();
  finish_set uuid:=gen_random_uuid(); grant_id uuid:=gen_random_uuid();
  object_id uuid:=gen_random_uuid(); transfer private.photo_transfers%rowtype;
  config jsonb; manifest jsonb; digest text; result jsonb; page jsonb; target jsonb;
  prior_access uuid; denied boolean;
begin
  insert into public.organizations(id,name) values(org,'Recovery-view fixture');
  insert into public.admin_teams(id,organization_id,name) values(team,org,'Main');
  foreach actor in array array[admin_id,other_id,capturer] loop
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
      values(actor,actor::text||'@example.invalid',now(),jsonb_build_object(
        'organization_id',org,'role',case when actor=capturer then 'CONTRACTOR' else 'ADMIN' end));
    insert into auth.sessions(id,user_id) values(actor,actor);
    insert into private.account_work_access(organization_id,user_id,work_role,active)
      values(org,actor,case when actor=capturer then 'CONTRACTOR' else 'ADMIN' end,true);
  end loop;
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active)
    values(org,team,admin_id,true);
  insert into private.contractor_team_memberships(organization_id,team_id,user_id,active)
    values(org,team,capturer,true);
  config:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
    'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,
    'session_id',admin_id,'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  select (j->>'work_order_id')::uuid into wo
    from public.admin_create_work_order_v4(false,'RECOVERY-VIEW','TEST','TEST','',
      current_date,capturer,config) j;
  select current_run_id into v_run from public.work_orders where id=wo;
  select id into instance from public.work_order_assignments where run_id=v_run and assignment_ended_at is null;
  select (requirement_snapshot->>'revision')::uuid into v_requirement_revision
    from public.work_order_runs where id=v_run;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',capturer,
    'session_id',capturer,'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  result:=public.accept_field_action_v4(gen_random_uuid(),wo,v_run,instance,'START',
    to_char(now()-interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),v_requirement_revision,null,'');
  if result->>'outcome'<>'APPLIED' then raise exception 'Start fixture rejected';end if;
  manifest:=jsonb_build_array(jsonb_build_object('id',photo,'item_id',null,
    'captured_at',to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  digest:=encode(sha256(convert_to(manifest::text,'UTF8')),'hex');
  result:=public.register_photo_finish_set(finish_set,wo,v_run,instance,v_requirement_revision,
    manifest,digest,manifest::text);
  if result->>'outcome'<>'APPLIED' then raise exception 'Metadata fixture rejected';end if;
  result:=public.accept_field_action_v4(gen_random_uuid(),wo,v_run,instance,'COMPLETE',
    to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),v_requirement_revision,finish_set,digest);
  if result->>'outcome'<>'APPLIED' then raise exception 'Finish fixture rejected';end if;
  execute 'set local role authenticated';
  result:=public.begin_photo_transfer(gen_random_uuid(),photo,repeat('a',64),250000);
  execute 'reset role';
  select * into transfer from private.photo_transfers where photo_id=photo;
  if transfer.photo_id is null then raise exception 'Prepared transfer fixture missing';end if;
  insert into storage.objects(id,bucket_id,name,owner_id,version)
    values(object_id,transfer.bucket,transfer.object_key,capturer::text,'RECOVERY-V1');
  insert into private.photo_transfer_receipts(action_id,photo_id,transfer_version,
    owner_user_id,owner_session_id,object_id,object_version,bucket,object_key,
    observed_sha256,observed_size)
  values(gen_random_uuid(),photo,transfer.version,capturer,capturer,object_id,
    'RECOVERY-V1',transfer.bucket,transfer.object_key,repeat('a',64),250000);
  update private.photo_transfers set state='RECEIVED' where photo_id=photo;
  select revision into prior_access from private.account_work_access where user_id=admin_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,
    'session_id',admin_id,'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  perform private.freeze_photo_recovery_scope(grant_id,org,admin_id,prior_access,array[team],'TEST');
  execute 'set local role authenticated';
  page:=public.photo_recovery_page(null,25);
  if jsonb_array_length(page->'photos')<>0 then raise exception 'PENDING cutoff leaked private bytes';end if;
  execute 'reset role';
  denied:=false;
  begin perform private.photo_recovery_target_for_session(photo,transfer.version,admin_id,admin_id);
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'PENDING cutoff signed a photo';end if;
  perform private.complete_photo_recovery_grant(grant_id);
  update private.admin_team_memberships set active=false where user_id=admin_id;
  update private.account_work_access set active=false,disabled_at=now(),
    suspension_authority='OWNER',suspension_reason='TEST',revision=gen_random_uuid()
    where user_id=admin_id;
  execute 'set local role authenticated';
  page:=public.photo_recovery_page(null,25);
  if jsonb_array_length(page->'photos')<>1
    or page->'photos'->0->>'photo_id'<>photo::text
    or page->'photos'->0->>'transfer_version'<>transfer.version::text
    or page->'photos'->0->>'prepared_sha256'<>repeat('a',64)
    or (page->'photos'->0->>'prepared_size')::integer<>250000
    or page->>'next_photo' is not null
    or page ? 'object_key' or page->'photos'->0 ? 'object_key'
    or page->'photos'->0 ? 'review_reason' or page->'photos'->0 ? 'signed_url'
    or private.can_work_order(wo)
  then raise exception 'Recovery page omitted exact private receipt or exposed work: %',page;end if;
  denied:=false;begin perform public.photo_recovery_page(null,10);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unbounded recovery page limit accepted';end if;
  execute 'reset role';
  target:=private.photo_recovery_target_for_session(photo,transfer.version,admin_id,admin_id);
  if target->>'photo_id'<>photo::text or target->>'object_key'<>transfer.object_key
    or target->>'bucket'<>'fwh-review-private'
  then raise exception 'Verified historical photo target incorrect';end if;
  denied:=false;begin perform private.photo_recovery_target_for_session(
    photo,transfer.version,other_id,other_id);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Other user read historical photo';end if;
  denied:=false;begin perform private.photo_recovery_target_for_session(
    photo,transfer.version,capturer,capturer);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Capturer without recovery grant acquired owner bypass';end if;
  denied:=false;begin perform private.photo_recovery_target_for_session(
    photo,gen_random_uuid(),admin_id,admin_id);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Wrong prepared version signed';end if;
  insert into public.photos(id,work_order_id,run_id,captured_by,captured_at)
    values(later,wo,v_run,capturer,now());
  denied:=false;begin perform private.photo_recovery_target_for_session(
    later,transfer.version,admin_id,admin_id);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Post-cutoff photo signed';end if;
  update auth.sessions set created_at=now()-interval '31 minutes' where id=admin_id;
  execute 'set local role authenticated';
  denied:=false;begin perform public.photo_recovery_page(null,25);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Old recovery session read gallery';end if;
  execute 'reset role';
  denied:=false;begin perform private.photo_recovery_target_for_session(
    photo,transfer.version,admin_id,admin_id);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Old recovery session acquired signed photo';end if;
  update auth.sessions set created_at=now() where id=admin_id;
  update storage.objects set archived_at=now() where id=object_id;
  execute 'set local role authenticated';
  page:=public.photo_recovery_page(null,25);
  if jsonb_array_length(page->'photos')<>0 then raise exception 'Removed storage catalog still listed';end if;
  execute 'reset role';
  denied:=false;begin perform private.photo_recovery_target_for_session(
    photo,transfer.version,admin_id,admin_id);
    exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Removed storage catalog still signed';end if;
  if has_function_privilege('authenticated',
    'public.photo_recovery_target_for_session(uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.photo_recovery_page(uuid,integer)','execute')
    or has_table_privilege('authenticated','private.photo_recovery_members','select')
  then raise exception 'Broad recovery/read privileges';end if;
  raise notice 'Phase 5E private photo recovery page and service-only target PASS';
end;
$gate$;
rollback;
