-- Rollback-only accepted-evidence historical handoff; no live accounts or photo bytes.
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
do $historical$
declare
  org uuid:=gen_random_uuid(); team_a uuid:=gen_random_uuid(); team_b uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid(); sup uuid:=gen_random_uuid(); target_admin uuid:=gen_random_uuid();
  contractor uuid:=gen_random_uuid(); actor uuid; rev uuid; photo uuid; unrelated uuid; later uuid;
  wo uuid; run uuid; assignment_id uuid; handoff_id uuid:=gen_random_uuid(); cutoff_id uuid;
  fp text; review jsonb; result jsonb; before_wo jsonb; before_photo jsonb; before_run jsonb; n bigint; denied boolean;
begin
  insert into public.organizations(id,name)values(org,'Historical handoff fixture');
  insert into public.admin_teams(id,organization_id,name)values(team_a,org,'Source'),(team_b,org,'Target');
  foreach actor in array array[admin_id,sup,target_admin,contractor] loop
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values(actor,actor::text||'@example.invalid',now(),
      jsonb_build_object('organization_id',org,'role',case when actor=sup then 'SUPERVISOR' when actor=contractor then 'CONTRACTOR' else 'ADMIN' end));
    insert into auth.sessions(id,user_id)values(actor,actor);
    insert into private.account_work_access(organization_id,user_id,work_role,active)
      select org,actor,raw_app_meta_data->>'role',true from auth.users where id=actor;
  end loop;
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active)values(org,team_a,admin_id,true),(org,team_b,target_admin,true);
  insert into private.contractor_team_memberships(organization_id,team_id,user_id,active)values(org,team_a,contractor,true);
  insert into private.org_work_settings(organization_id,supervisor_work_ready)values(org,true);
  insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)values(org,sup,3,true,admin_id,'TEST');
  photo:=pg_temp.recovery_fixture_photo(admin_id,org,team_a,contractor,true);
  unrelated:=pg_temp.recovery_fixture_photo(admin_id,org,team_a,contractor,true);
  select work_order_id,run_id,assignment_instance_id into wo,run,assignment_id from public.photos where id=photo;
  select to_jsonb(p) into before_photo from public.photos p where id=photo;
  select to_jsonb(r) into before_run from public.work_order_runs r where id=run;
  select to_jsonb(w) into before_wo from public.work_orders w where id=wo;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',sup,'session_id',sup,
    'app_metadata',jsonb_build_object('role','SUPERVISOR','organization_id',org))::text,true);
  review:=public.preview_work_order_team_handoff(wo,team_b,'TEST');
  if review->>'eligible'<>'true' or review->>'handoff_kind'<>'FIELD_COMPLETE'
    or review->>'recovery_recipient_count'<>'1' or review->>'protected_photo_count'<>'1'
    then raise exception 'Historical preview did not bind exact facts: %',review;end if;
  fp:=review->>'review_fingerprint';
  -- Recipient scope changes are part of the reviewed fingerprint.
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active)values(org,team_b,admin_id,true);
  denied:=false;
  begin perform public.handoff_work_order_team(handoff_id,wo,team_b,fp,'Continuity','TEST');exception when serialization_failure then denied:=true;end;
  if not denied or (select responsible_team_id from public.work_orders where id=wo)<>team_a then raise exception 'Stale recovery-recipient set moved work';end if;
  delete from private.admin_team_memberships where user_id=admin_id and team_id=team_b;
  fp:=public.preview_work_order_team_handoff(wo,team_b,'TEST')->>'review_fingerprint';
  result:=public.handoff_work_order_team(handoff_id,wo,team_b,fp,'Continuity','TEST');
  if result->>'status'<>'HANDED_OFF' then raise exception 'Historical handoff failed: %',result;end if;
  if (select to_jsonb(w)-'responsible_team_id'-'updated_at' from public.work_orders w where id=wo)
      is distinct from before_wo-'responsible_team_id'-'updated_at'
    or (select to_jsonb(r)-'updated_at' from public.work_order_runs r where id=run) is distinct from before_run-'updated_at'
    or (select to_jsonb(p) from public.photos p where id=photo) is distinct from before_photo
    then raise exception 'Handoff mutated original assignment, field or photo evidence';end if;
  select g.action_id into cutoff_id from private.photo_recovery_grants g where g.scope_work_order_id=wo and g.user_id=admin_id;
  if cutoff_id is null or not exists(select 1 from private.photo_recovery_grants g where g.action_id=cutoff_id and g.state='READY' and g.member_count=1)
    or not exists(select 1 from private.photo_recovery_members m where m.grant_id=cutoff_id and m.photo_id=photo and m.accepted_finish_at_cutoff)
    or exists(select 1 from private.photo_recovery_members m where m.grant_id=cutoff_id and m.photo_id=unrelated)
    then raise exception 'Handoff recovery widened past exact old-WO cutoff';end if;
  select count(*) into n from private.photo_recovery_grants where scope_work_order_id=wo;
  if public.handoff_work_order_team(handoff_id,wo,team_b,fp,'Continuity','TEST') is distinct from result
    or (select count(*) from private.photo_recovery_grants where scope_work_order_id=wo)<>n
    then raise exception 'Exact retry recreated cutoff or changed receipt';end if;
  -- Old office has exact photo recovery but loses all operational work access for this WO.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  if private.can_work_order(wo) or private.can_read_work_order(wo) or not private.can_recover_photo(photo)
    or private.can_recover_photo(unrelated) then raise exception 'Former office work/recovery boundary failed';end if;
  denied:=false;begin perform private.guard_legacy_work_order(wo,'ADMIN');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Former office mutated handed-off job';end if;
  -- The receiving office can use the normal current-team work owner.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',target_admin,'session_id',target_admin,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  if not private.can_work_order(wo) then raise exception 'Receiving office cannot manage completed work';end if;
  perform public.admin_update_work_order_v4(wo,before_wo->>'wo_number',before_wo->>'property_address',
    before_wo->>'work_type',coalesce(before_wo->>'instructions',''),current_date,contractor,
    (before_run->'requirement_snapshot'->>'revision')::uuid,before_run->'requirement_snapshot');
  -- Original contractor retains completed assignment read and accepted original transfer, never new work.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  if not private.can_read_work_order(wo) or not private.photo_transfer_authorized_for_user(contractor,contractor,photo)
    then raise exception 'Original completed assignment/accepted transfer was stranded';end if;
  perform public.acknowledge_assignment_received(wo);
  if not exists(select 1 from public.work_order_assignments a where a.id=assignment_id
      and a.assignment_received_at is not null and a.end_reason='FIELD_COMPLETE')
    then raise exception 'Delayed durable receipt did not retain exact completed instance';end if;
  denied:=false;begin perform private.guard_legacy_work_order(wo,'CONTRACTOR');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Completed assignment read became new work authority';end if;
  -- A later unaccepted photo under the same WO cannot enter the fixed recovery grant.
  later:=gen_random_uuid();
  insert into public.photos(id,work_order_id,run_id,captured_by,captured_at)values(later,wo,run,contractor,now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  if private.can_recover_photo(later) then raise exception 'Later same-WO photo entered recovery';end if;
  -- Recovery header cannot be redirected after its snapshot is READY.
  denied:=false;begin update private.photo_recovery_grants set scope_work_order_id=(select work_order_id from public.photos where id=unrelated) where action_id=cutoff_id;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Recovery WO scope remained mutable';end if;
  if has_function_privilege('authenticated','private.freeze_photo_recovery_scope(uuid,uuid,uuid,uuid,uuid[],text,uuid)','EXECUTE')
    or has_function_privilege('anon','private.handoff_recovery_recipients(uuid,uuid,uuid)','EXECUTE')
    or has_table_privilege('authenticated','private.work_order_team_handoff_actions','SELECT')
    then raise exception 'Private handoff/cutoff authority exposed';end if;
end;
$historical$;

-- Exact active consent is separate from reassignment and does not yet enable
-- changing a started job's team until the original-instance continuation gate.
do $active_consent$
declare
  org uuid:=gen_random_uuid(); source_team uuid:=gen_random_uuid(); dest_team uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid(); supervisor_id uuid:=gen_random_uuid();
  contractor_id uuid:=gen_random_uuid(); actor uuid; wo uuid; run uuid; assignment_id uuid;
  consent_request_id uuid:=gen_random_uuid(); fp text; preview jsonb; receipt jsonb; req jsonb;
  cfg jsonb; revision uuid; denied boolean; count_pending bigint;
begin
  insert into public.organizations(id,name) values(org,'Active consent fixture');
  insert into public.admin_teams(id,organization_id,name)
    values(source_team,org,'Original office'),(dest_team,org,'Receiving office');
  foreach actor in array array[admin_id,supervisor_id,contractor_id] loop
    insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
      values(actor,actor::text||'@example.invalid',now(),jsonb_build_object(
        'organization_id',org,'role',case when actor=supervisor_id then 'SUPERVISOR'
          when actor=contractor_id then 'CONTRACTOR' else 'ADMIN' end));
    insert into auth.sessions(id,user_id) values(actor,actor);
    insert into private.account_work_access(organization_id,user_id,work_role,active)
      select org,actor,raw_app_meta_data->>'role',true from auth.users where id=actor;
  end loop;
  insert into private.admin_team_memberships(organization_id,team_id,user_id,active)
    values(org,source_team,admin_id,true);
  insert into private.contractor_team_memberships(organization_id,team_id,user_id,active)
    values(org,source_team,contractor_id,true);
  insert into private.org_work_settings(organization_id,supervisor_work_ready) values(org,true);
  insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
    values(org,supervisor_id,3,true,admin_id,'TEST');
  cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
    'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  select (j->>'work_order_id')::uuid into wo from public.admin_create_work_order_v4(
    false,'CONSENT-A','TEST','TEST','',current_date,contractor_id,cfg) j;
  select current_run_id into run from public.work_orders where id=wo;
  select id into assignment_id from public.work_order_assignments
    where run_id=run and assignment_ended_at is null;
  select (requirement_snapshot->>'revision')::uuid into revision
    from public.work_order_runs where id=run;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor_id,'session_id',contractor_id,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  receipt:=public.accept_field_action_v4(gen_random_uuid(),wo,run,assignment_id,'START',
    to_char(now()-interval '30 seconds','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),revision,null,'');
  if receipt->>'outcome'<>'APPLIED' then raise exception 'Active consent fixture Start failed: %',receipt;end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisor_id,'session_id',supervisor_id,
    'app_metadata',jsonb_build_object('role','SUPERVISOR','organization_id',org))::text,true);
  preview:=public.preview_work_order_team_handoff(wo,dest_team,'TEST');
  if preview->>'eligible'<>'false' or preview->>'consent_possible'<>'true'
    or preview->>'consent_status'<>'NOT_REQUESTED' then
    raise exception 'Started job incorrectly eligible or unavailable for consent: %',preview;end if;
  fp:=preview->>'review_fingerprint';
  req:=public.request_work_order_team_handoff_consent(consent_request_id,wo,dest_team,fp,'Office continuity','TEST');
  if req->>'status'<>'PENDING'
    or (select responsible_team_id from public.work_orders where id=wo)<>source_team
    or (select assigned_user_id from public.work_orders where id=wo)<>contractor_id
    then raise exception 'Consent request changed live work or was not saved: %',req;end if;
  if public.request_work_order_team_handoff_consent(consent_request_id,wo,dest_team,fp,'Office continuity','TEST')
    is distinct from req then raise exception 'Same consent request not idempotent';end if;
  denied:=false;
  begin perform public.handoff_work_order_team(gen_random_uuid(),wo,dest_team,fp,'Office continuity','TEST');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Active office job moved before original Contractor consent';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor_id,'session_id',contractor_id,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  select count(*) into count_pending from public.pending_work_order_team_handoff_consents() j
    where j->>'request_id'=consent_request_id::text and j->>'work_order_id'=wo::text;
  if count_pending<>1 then raise exception 'Original Contractor did not receive exact consent request';end if;
  receipt:=public.respond_work_order_team_handoff_consent(consent_request_id,true);
  if receipt->>'status'<>'APPROVED'
    or public.respond_work_order_team_handoff_consent(consent_request_id,true) is distinct from receipt
    then raise exception 'Original Contractor approval not idempotent: %',receipt;end if;
  denied:=false;
  begin perform public.respond_work_order_team_handoff_consent(consent_request_id,false);
  exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Approved consent could be reversed';end if;
  if (select count(*) from public.pending_work_order_team_handoff_consents())<>0 then
    raise exception 'Approved request still appears as a pending phone prompt';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisor_id,'session_id',supervisor_id,
    'app_metadata',jsonb_build_object('role','SUPERVISOR','organization_id',org))::text,true);
  preview:=public.preview_work_order_team_handoff(wo,dest_team,'TEST');
  if preview->>'consent_status'<>'APPROVED' or preview->>'eligible'<>'true'
    or preview->>'handoff_kind'<>'IN_PROGRESS' or preview->>'original_run_id'<>run::text
    or preview->>'original_assignment_id'<>assignment_id::text then
    raise exception 'Approved consent did not bind exact active assignment: %',preview;end if;
  denied:=false;
  begin perform public.handoff_work_order_team(gen_random_uuid(),wo,dest_team,fp,'Changed reason','TEST');
  exception when serialization_failure then denied:=true;end;
  if not denied or (select responsible_team_id from public.work_orders where id=wo)<>source_team then
    raise exception 'Changed reason bypassed the approved Contractor consent';end if;
  receipt:=public.handoff_work_order_team(gen_random_uuid(),wo,dest_team,fp,'Office continuity','TEST');
  if receipt->>'status'<>'HANDED_OFF'
    or (select responsible_team_id from public.work_orders where id=wo)<>dest_team
    or (select assigned_user_id from public.work_orders where id=wo)<>contractor_id
    or (select current_run_id from public.work_orders where id=wo)<>run
    or (select id from public.work_order_assignments where id=assignment_id
        and assignment_ended_at is null and assigned_user_id=contractor_id)<>assignment_id
    or (select decision from private.work_order_team_handoff_consent_requests c
        where c.request_id=consent_request_id)<>'CONSUMED'
    then raise exception 'Audited approved handoff broke original active assignment: %',receipt;end if;
  if not exists(select 1 from private.photo_recovery_grants g
    where g.scope_work_order_id=wo and g.user_id=admin_id and g.state='READY')
    then raise exception 'Former office lost its fixed recovery cutoff';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_id,
    'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
  if private.can_work_order(wo) or private.can_read_work_order(wo) then
    raise exception 'Former office kept live active work authorization';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor_id,'session_id',contractor_id,
    'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
  if not private.can_read_work_order(wo)
    or not private.active_team_handoff_original_assignment(contractor_id,wo) then
    raise exception 'Original Contractor could not read unchanged active assignment';end if;
  perform private.guard_legacy_work_order(wo,'CONTRACTOR');
  if private.contractor_current_team(contractor_id,org)<>source_team then
    raise exception 'Handoff silently moved Contractor to another team';end if;
  if has_table_privilege('authenticated','private.work_order_team_handoff_consent_requests','SELECT')
    or has_table_privilege('authenticated','private.work_order_team_handoff_consent_requests','UPDATE') then
    raise exception 'Private team-handoff consent ledger exposed';end if;
end;$active_consent$;
rollback;
