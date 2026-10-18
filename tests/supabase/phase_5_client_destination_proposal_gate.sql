-- Transactional disposable company/role/destination tests; no hosted writes.
begin;
do $gate$
declare
 org1 uuid:=gen_random_uuid(); org2 uuid:=gen_random_uuid();
 team1 uuid:=gen_random_uuid(); team2 uuid:=gen_random_uuid();
 admin1 uuid:=gen_random_uuid(); admin2 uuid:=gen_random_uuid();
 contractor uuid:=gen_random_uuid();
 client1 uuid:=gen_random_uuid(); client2 uuid:=gen_random_uuid();
 action1 uuid:=gen_random_uuid(); first_result jsonb; second_result jsonb;
 proposed_id uuid; d private.client_delivery_destinations%rowtype;
 proof jsonb; proof2 jsonb; preflight_action uuid:=gen_random_uuid();
 root_id text:='fwh_disposable_root_123456789';
 denied boolean;
begin
 insert into public.organizations(id,name)
 values(org1,'DESTINATION DISPOSABLE ONE'),(org2,'DESTINATION DISPOSABLE TWO');
 insert into public.admin_teams(id,organization_id,name)
 values(team1,org1,'TEST TEAM ONE'),(team2,org2,'TEST TEAM TWO');
 insert into private.client_companies(id,organization_id,name)
 values(client1,org1,'TEST CLIENT ONE'),(client2,org2,'TEST CLIENT TWO');
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
 values(admin1,'dest-admin1@disposable.invalid',now(),jsonb_build_object('organization_id',org1,'role','ADMIN')),
  (admin2,'dest-admin2@disposable.invalid',now(),jsonb_build_object('organization_id',org2,'role','ADMIN')),
  (contractor,'dest-contractor@disposable.invalid',now(),jsonb_build_object('organization_id',org1,'role','CONTRACTOR'));
 insert into auth.sessions(id,user_id)
 values(admin1,admin1),(admin2,admin2),(contractor,contractor);
 insert into private.account_work_access(organization_id,user_id,work_role,active)
 values(org1,admin1,'ADMIN',true),(org2,admin2,'ADMIN',true),
  (org1,contractor,'CONTRACTOR',true);
 insert into private.admin_team_memberships(organization_id,team_id,user_id,active)
 values(org1,team1,admin1,true),(org2,team2,admin2,true);

 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub',admin1,'session_id',admin1,
  'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org1))::text,true);
 execute 'set local role authenticated';
 first_result:=public.admin_propose_client_delivery_destination(
  action1,client1,'OFFICE@DISPOSABLE.INVALID',root_id);
 if first_result->>'verified'<>'false' or first_result->>'active'<>'false'
  or first_result->>'replayed'<>'false' then
  raise exception 'Unverified proposal improperly activated';end if;
 proposed_id:=(first_result->>'destination_id')::uuid;
 second_result:=public.admin_propose_client_delivery_destination(
  action1,client1,'office@disposable.invalid',root_id);
 if second_result->>'destination_id'<>proposed_id::text
  or second_result->>'replayed'<>'true' then
  raise exception 'Exact proposal replay created a second destination';end if;

 denied:=false;
 begin
  perform public.admin_propose_client_delivery_destination(
   action1,client1,'office@disposable.invalid','different_test_root_7654321');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Changed payload reused action UUID';end if;
 denied:=false;
 begin
  perform public.admin_propose_client_delivery_destination(
   gen_random_uuid(),client1,'office@disposable.invalid',root_id);
 exception when unique_violation then denied:=true;end;
 if not denied then raise exception 'Duplicate remote root allowed';end if;

 -- Both direct writes and role spoofing must be denied; no Google proof is
 -- possible in an ordinary authenticated browser.
 denied:=false;
 begin
  update private.client_delivery_destinations set verified=true,active=true
    where id=proposed_id;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Authenticated actor could self-verify destination';end if;

 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub',contractor,'session_id',contractor,
  'app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org1))::text,true);
 denied:=false;
 begin perform public.admin_propose_client_delivery_destination(
  gen_random_uuid(),client1,'office@disposable.invalid','contractor_root_123456789');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor registered provider root';end if;

 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub',admin2,'session_id',admin2,
  'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org2))::text,true);
 denied:=false;
 begin perform public.admin_propose_client_delivery_destination(
  gen_random_uuid(),client1,'office@disposable.invalid','cross_company_root_123456789');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Wrong-organization Admin registered client root';end if;
 denied:=false;
 begin perform public.admin_propose_client_delivery_destination(
  gen_random_uuid(),client2,'office@disposable.invalid',root_id);
 exception when unique_violation then denied:=true;end;
 if not denied then raise exception 'Same Google root bound to a second company';end if;

 -- An authenticated Admin cannot invoke either trusted service-only RPC.
 denied:=false;
 begin perform public.service_read_client_destination_candidate(proposed_id);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Office actor could inspect trusted destination candidate';end if;
 denied:=false;
 begin perform public.service_record_client_destination_preflight(
  preflight_action,proposed_id,(first_result->>'revision')::uuid,
  'office@disposable.invalid',root_id,'fwh_distinct_drive_123456');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Office actor could spoof a verified provider read';end if;

 -- Only the existing service role can read exact same-organization company/root
 -- and record a preflight. Proof does NOT verify or activate the destination.
 execute 'set local role service_role';
 proof:=public.service_read_client_destination_candidate(proposed_id);
 if proof->>'organization_id'<>org1::text or proof->>'company_id'<>client1::text
    or proof->>'root_folder_id'<>root_id
    or proof->>'provider_identity'<>'office@disposable.invalid'
    or proof->>'active'<>'false' or proof->>'verified'<>'false'
 then raise exception 'Service read lost immutable TEST client binding';end if;
 proof:=public.service_record_client_destination_preflight(
  preflight_action,proposed_id,(first_result->>'revision')::uuid,
  'office@disposable.invalid',root_id,'fwh_distinct_drive_123456');
 if proof->>'preflight_recorded'<>'true' or proof->>'active'<>'false'
    or proof->>'verified'<>'false' or proof->>'replayed'<>'false'
 then raise exception 'Trusted GET preflight incorrectly activated a destination';end if;
 proof2:=public.service_record_client_destination_preflight(
  preflight_action,proposed_id,(first_result->>'revision')::uuid,
  'office@disposable.invalid',root_id,'fwh_distinct_drive_123456');
 if proof2->>'replayed'<>'true'
 then raise exception 'Same verified GET journal did not replay';end if;
 denied:=false;
 begin
  perform public.service_record_client_destination_preflight(
   preflight_action,proposed_id,(first_result->>'revision')::uuid,
   'office@disposable.invalid',root_id,'different_drive_123456789');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Changed Drive ID silently reused provider evidence';end if;
 denied:=false;
 begin
  perform public.service_record_client_destination_preflight(
   gen_random_uuid(),proposed_id,gen_random_uuid(),
   'office@disposable.invalid',root_id,'fwh_distinct_drive_123456');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Stale destination revision could be attested';end if;

 execute 'reset role';
 if (select count(*) from private.client_delivery_destination_preflights
     where destination_id=proposed_id and organization_id=org1 and company_id=client1)<>1
 then raise exception 'Service preflight journal had unexpected rows';end if;
 select * into d from private.client_delivery_destinations where id=proposed_id;
 if d.id is null or d.organization_id<>org1 or d.company_id<>client1
  or d.provider<>'GOOGLE_DRIVE' or d.provider_identity<>'office@disposable.invalid'
  or d.root_folder_id<>root_id or d.verified or d.active or d.verified_at is not null
  or d.verification_receipt is not null then
  raise exception 'Safe destination proposal persisted unexpected authority';end if;
 if (select count(*) from private.client_delivery_destinations
    where organization_id in (org1,org2))<>1 then
  raise exception 'Proposal negative tests leaked extra destinations';end if;
end;
$gate$;
rollback;
