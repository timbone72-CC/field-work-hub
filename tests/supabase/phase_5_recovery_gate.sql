-- Synthetic rollback-only metadata; no real bytes, accounts or live revocation.
begin;
set local timezone='UTC';
create function pg_temp.recovery_fixture_photo(p_admin uuid,p_org uuid,p_team uuid,p_actor uuid,p_complete boolean)
returns uuid language plpgsql as $$
declare wo uuid; run uuid; instance uuid; rev uuid; set_id uuid:=gen_random_uuid(); photo uuid:=gen_random_uuid();
  cfg jsonb; photos jsonb; digest text; result jsonb;
begin
  cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_admin,'session_id',p_admin,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',p_org))::text,true);
  select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(false,'RECOVERY-'||photo,'TEST','TEST','',current_date,p_actor,cfg) j;
  update public.work_orders set responsible_team_id=p_team where id=wo;
  select current_run_id into run from public.work_orders where id=wo;
  select id into instance from public.work_order_assignments where run_id=run and assignment_ended_at is null;
  select (requirement_snapshot->>'revision')::uuid into rev from public.work_order_runs where id=run;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'session_id',p_actor,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',p_org))::text,true);
  result:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'START',to_char(now()-interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),rev,null,'');
  if result->>'outcome'<>'APPLIED' then raise exception 'Fixture Start failed: %',result;end if;
  photos:=jsonb_build_array(jsonb_build_object('id',photo,'item_id',null,'captured_at',to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  digest:=encode(sha256(convert_to(photos::text,'UTF8')),'hex');
  result:=public.register_photo_finish_set(set_id,wo,run,instance,rev,photos,digest,photos::text);
  if result->>'outcome'<>'APPLIED' then raise exception 'Fixture metadata failed: %',result;end if;
  if p_complete then
    result:=public.accept_field_action_v4(gen_random_uuid(),wo,run,instance,'COMPLETE',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),rev,set_id,digest);
    if result->>'outcome'<>'APPLIED' then raise exception 'Fixture Finish failed: %',result;end if;
  end if;
  return photo;
end;
$$;
do $gate$
declare
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); team_a uuid:=gen_random_uuid(); team_b uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); other_admin uuid:=gen_random_uuid();
  contractor uuid:=gen_random_uuid(); other_contractor uuid:=gen_random_uuid(); foreign_contractor uuid:=gen_random_uuid();
  supervisors uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()]; actor uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; later uuid:=gen_random_uuid(); action uuid:=gen_random_uuid(); contractor_action uuid:=gen_random_uuid();
  rev uuid; contractor_rev uuid; supervisor_rev uuid; frozen_grant uuid; accepted_grant uuid; r jsonb; f public.photo_finish_sets%rowtype;
  denied boolean; tier_no integer; n bigint; baseline_count bigint;
begin
  insert into public.organizations(id,name) values(org,'RECOVERY TEST'),(other_org,'FOREIGN TEST');
  insert into public.admin_teams(id,organization_id,name) values(team_a,org,'A'),(team_b,org,'B'),(other_team,other_org,'OTHER');
  foreach actor in array array[admin_id,owner_id,other_admin,contractor,other_contractor,foreign_contractor]||supervisors loop
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
    values(actor,'fixture@example.invalid',now(),jsonb_build_object('organization_id',case when actor in (other_admin,foreign_contractor) then other_org else org end,
      'role',case when actor in (contractor,other_contractor,foreign_contractor) then 'CONTRACTOR' when actor=any(supervisors) then 'SUPERVISOR' else 'ADMIN' end));
    insert into auth.sessions(id,user_id) values(actor,actor);
    insert into private.account_work_access(organization_id,user_id,work_role,active)
    select (raw_app_meta_data->>'organization_id')::uuid,actor,raw_app_meta_data->>'role',true from auth.users where id=actor;
  end loop;
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(org,team_a,admin_id,true),(other_org,other_team,other_admin,true);
  insert into private.platform_owner_capabilities(user_id,active,environment,verified_at) values(owner_id,true,'TEST',now());
  insert into private.org_work_settings(organization_id,supervisor_work_ready) values(org,true);
  for tier_no in 1..3 loop
    insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason) values(org,supervisors[tier_no],tier_no,true,owner_id,'TEST');
    insert into private.supervisor_team_scopes(organization_id,user_id,team_id) values(org,supervisors[tier_no],team_a);
  end loop;
  p1:=pg_temp.recovery_fixture_photo(admin_id,org,team_a,contractor,true);
  p2:=pg_temp.recovery_fixture_photo(admin_id,org,team_a,contractor,false);
  p3:=pg_temp.recovery_fixture_photo(admin_id,org,team_b,other_contractor,true);
  p4:=pg_temp.recovery_fixture_photo(other_admin,other_org,other_team,foreign_contractor,true);
  select revision into rev from private.account_work_access where user_id=admin_id;
  select revision into contractor_rev from private.account_work_access where user_id=contractor;
  if not private.photo_has_accepted_finish(p1) or private.photo_has_accepted_finish(p2) then raise exception 'Registered metadata confused with accepted Finish';end if;
  select count(*) into baseline_count from public.photos;
  denied:=false;
  begin perform private.freeze_photo_recovery_scope(gen_random_uuid(),org,admin_id,gen_random_uuid(),array[team_a],'TEST');exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Stale access revision allowed cutoff';end if;
  denied:=false;
  begin perform private.freeze_photo_recovery_scope(gen_random_uuid(),org,admin_id,rev,array[team_b],'TEST');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Wrong-team cutoff allowed';end if;
  denied:=false;
  begin perform private.freeze_photo_recovery_scope(gen_random_uuid(),org,admin_id,rev,array[other_team],'TEST');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Cross-org cutoff allowed';end if;
  select revision into supervisor_rev from private.account_work_access where user_id=owner_id;
  denied:=false;
  begin perform private.freeze_photo_recovery_scope(gen_random_uuid(),org,owner_id,supervisor_rev,array[team_a],'TEST');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Owner capability granted customer photos';end if;

  -- No client can mint a grant or look up another user's current capabilities.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id)::text,true);
  execute 'set local role authenticated';
  denied:=false;
  begin perform private.freeze_photo_recovery_scope(action,org,admin_id,rev,array[team_a],'TEST');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Authenticated client minted recovery';end if;
  denied:=false;
  begin perform private.team_capability_for_user(other_admin,other_org,other_team,'WORK');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Client queried other account capabilities';end if;
  execute 'reset role';
  execute 'set local role service_role';
  frozen_grant:=private.freeze_photo_recovery_scope(action,org,admin_id,rev,array[team_a],'TEST');
  if private.can_recover_photo(p1) then raise exception 'PENDING snapshot exposed';end if;
  execute 'reset role';
  -- Later metadata under the SAME old WO must not enter a retried snapshot.
  insert into public.photos(id,work_order_id,run_id,captured_by,captured_at)
    select later,work_order_id,run_id,captured_by,now() from public.photos where id=p1;
  update private.admin_team_memberships set active=false where user_id=admin_id;
  update private.account_work_access set active=false,suspension_authority='OWNER',suspension_reason='TEST',disabled_at=now(),revision=gen_random_uuid() where user_id=admin_id;
  if private.freeze_photo_recovery_scope(action,org,admin_id,rev,array[team_a],'TEST')<>frozen_grant then raise exception 'Retry lost fixed snapshot';end if;
  n:=private.complete_photo_recovery_grant(action);
  if n<>2 or private.complete_photo_recovery_grant(action)<>2 then raise exception 'Snapshot widened on completion/retry';end if;
  if not private.can_recover_photo(p1) or not private.can_recover_photo(p2) or private.can_recover_photo(later)
    or private.can_recover_photo(p3) or private.can_recover_photo(p4) or private.can_work_order((select work_order_id from public.photos where id=p1)) then
    raise exception 'Removed Admin exact recovery/work boundary failed';end if;
  denied:=false;
  begin perform private.freeze_photo_recovery_scope(action,org,admin_id,rev,array[team_a],'Changed');exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Changed recovery retry payload allowed';end if;

  -- Contractor recovery contains only their own IDs. Complete after cutoff cannot
  -- retrospectively grant accepted pre-cutoff upload authority to an unfinished set.
  perform private.freeze_photo_recovery_scope(contractor_action,org,contractor,contractor_rev,'{}','TEST');
  perform private.complete_photo_recovery_grant(contractor_action);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  select fs.* into f from public.photo_finish_sets fs join public.photos p on p.finish_set_id=fs.id where p.id=p2;
  r:=public.accept_field_action_v4(gen_random_uuid(),f.work_order_id,f.run_id,f.assignment_instance_id,'COMPLETE',
    to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),f.requirement_revision,f.id,f.digest);
  if r->>'outcome'<>'APPLIED' then raise exception 'Fixture late Finish failed';end if;
  update private.account_work_access set active=false,suspension_authority='OWNER',suspension_reason='TEST',disabled_at=now() where user_id=contractor;
  if not private.can_recover_photo(p1) or not private.has_pre_cutoff_finish(p1)
    or private.has_pre_cutoff_finish(p2) or private.can_recover_photo(p3) or private.can_recover_photo(p4) then
    raise exception 'Contractor cutoff owner/accepted-Finish boundary failed';end if;
  -- Binding drift cannot be exposed or resume transfer under an old digest.
  update public.photo_finish_sets set digest=repeat('a',64) where id=(select finish_set_id from public.photos where id=p1);
  if private.has_pre_cutoff_finish(p1) or private.can_recover_photo(p1) then raise exception 'Changed frozen content survived cutoff checks';end if;
  update public.photo_finish_sets set digest=(select finish_digest from private.photo_recovery_members where grant_id=contractor_action and photo_id=p1)
    where id=(select finish_set_id from public.photos where id=p1);
  -- Session/identity checks are independent of old app claims/work role.
  update auth.sessions set created_at=now()-interval '31 minutes' where id=contractor;
  if private.can_recover_photo(p1) or not private.has_pre_cutoff_finish(p1) then raise exception 'Recovery gallery/continuation freshness conflated';end if;
  update auth.sessions set created_at=now(),not_after=now() where id=contractor;
  if private.can_recover_photo(p1) or private.has_pre_cutoff_finish(p1) then raise exception 'Expired session recovered';end if;
  update auth.sessions set not_after=null where id=contractor;
  update auth.users set banned_until=now()+interval '1 day' where id=contractor;
  if private.can_recover_photo(p1) or private.has_pre_cutoff_finish(p1) then raise exception 'Security lock recovered';end if;
  update auth.users set banned_until=null where id=contractor;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_contractor,'session_id',other_contractor)::text,true);
  if private.can_recover_photo(p1) or private.has_pre_cutoff_finish(p1) then raise exception 'Reused email/new UUID recovered prior evidence';end if;

  for tier_no in 1..3 loop
    select revision into supervisor_rev from private.account_work_access where user_id=supervisors[tier_no];
    accepted_grant:=gen_random_uuid();
    perform private.freeze_photo_recovery_scope(accepted_grant,org,supervisors[tier_no],supervisor_rev,
      case when tier_no=3 then array[team_a,team_b] else array[team_a] end,'TEST');
    perform private.complete_photo_recovery_grant(accepted_grant);
    update private.supervisor_grants set active=false where user_id=supervisors[tier_no];
    perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisors[tier_no],'session_id',supervisors[tier_no])::text,true);
    if not private.can_recover_photo(p1) or private.can_recover_photo(p3) is distinct from (tier_no=3)
      or private.can_recover_photo(p4) or private.has_pre_cutoff_finish(p1) then raise exception 'Tier % recovery broadened scope or capturing authority',tier_no;end if;
  end loop;
  denied:=false;
  begin update public.photos set captured_by=other_contractor where id=p1;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Photo capturing identity rebound';end if;
  denied:=false;
  begin update private.photo_recovery_members set photo_id=later where grant_id=action and photo_id=p1;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Fixed recovery member overwritten';end if;
  denied:=false;
  begin update private.photo_recovery_grants set user_id=owner_id where action_id=action;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Fixed recovery user rebound';end if;
  if has_table_privilege('authenticated','private.photo_recovery_members','select')
    or has_function_privilege('anon','private.can_recover_photo(uuid)','execute')
    or has_table_privilege('service_role','private.photo_recovery_members','insert') then raise exception 'Broad recovery grants';end if;
  if (select count(*) from public.photos)<>baseline_count+1 or exists(select 1 from public.photos where id in (p1,p2,p3,p4,later) and (remote_file_id is not null or uploaded_at is not null)) then
    raise exception 'Recovery mutated evidence or invented client delivery';end if;
  raise notice 'Phase 5 exact recovery snapshot, Finish cutoff, tier/user/session isolation and immutability PASS';
end;
$gate$;
rollback;
