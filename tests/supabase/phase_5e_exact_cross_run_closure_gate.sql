-- FWH 5E-T01: changed cross-run coverage boundary only.
-- Disposable PostgreSQL, synthetic identities, rollback; no provider or cleanup.
begin;
do $gate$
declare
  photo uuid:='aaaaaaaa-0000-4000-8000-000000000001';
  unrelated_photo uuid:='aaaaaaaa-0000-4000-8000-000000000002';
  accepted_run uuid:='bbbbbbbb-0000-4000-8000-000000000001';
  foreign_run uuid:='bbbbbbbb-0000-4000-8000-000000000002';
  version uuid:='cccccccc-0000-4000-8000-000000000001';
  other_version uuid:='cccccccc-0000-4000-8000-000000000002';
  hash text:=repeat('a',64);
  selected jsonb;
  frozen jsonb;
  guard_code text;
  writer_code text;
  finder_code text;
  before_count bigint;
begin
  selected:=jsonb_build_array(jsonb_build_object(
    'photo_id',photo,'run_id',accepted_run,'transfer_version',version,
    'observed_sha256',hash,'observed_size',1234));
  frozen:=jsonb_build_array(
    jsonb_build_object('id',photo),
    jsonb_build_object('id',unrelated_photo));

  if private.fwh_exact_frozen_run_photo(
      selected,frozen,photo,accepted_run,version,hash,1234) is distinct from true
  then raise exception 'Exact selected frozen photo was rejected';end if;

  if private.fwh_exact_frozen_run_photo(
      selected,frozen,unrelated_photo,accepted_run,version,hash,1234)
     or private.fwh_exact_frozen_run_photo(
      selected,frozen,photo,foreign_run,version,hash,1234)
     or private.fwh_exact_frozen_run_photo(
      selected,frozen,photo,accepted_run,other_version,hash,1234)
     or private.fwh_exact_frozen_run_photo(
      selected,frozen,photo,accepted_run,version,repeat('b',64),1234)
     or private.fwh_exact_frozen_run_photo(
      selected,frozen,photo,accepted_run,version,hash,1235)
     or private.fwh_exact_frozen_run_photo(
      selected,jsonb_build_array(jsonb_build_object('id',unrelated_photo)),
      photo,accepted_run,version,hash,1234)
     or private.fwh_exact_frozen_run_photo(
      '[]'::jsonb,frozen,photo,accepted_run,version,hash,1234)
     or private.fwh_exact_frozen_run_photo(
      '{}'::jsonb,frozen,photo,accepted_run,version,hash,1234)
     or private.fwh_exact_frozen_run_photo(
      selected,'null'::jsonb,photo,accepted_run,version,hash,1234)
  then raise exception 'Foreign, excluded or mismatched run/photo accepted';end if;

  if private.fwh_verified_additional_package_run(
     gen_random_uuid(),accepted_run,gen_random_uuid())
  then raise exception 'Unverified/unknown package coverage accepted';end if;
  if has_function_privilege('anon',
      'private.fwh_exact_frozen_run_photo(jsonb,jsonb,uuid,uuid,uuid,text,bigint)',
      'EXECUTE')
     or has_function_privilege('authenticated',
      'private.fwh_exact_frozen_run_photo(jsonb,jsonb,uuid,uuid,uuid,text,bigint)',
      'EXECUTE')
     or has_function_privilege('service_role',
      'private.fwh_verified_additional_package_run(uuid,uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated',
      'private.fwh_verified_additional_package_run(uuid,uuid,uuid)','EXECUTE')
  then raise exception 'New private cross-run helpers exposed to clients';end if;

  select pg_get_functiondef(
    'private.guard_client_package_run_closure()'::regprocedure)
    into guard_code;
  select pg_get_functiondef(
    'private.record_verified_terminal_run_closure()'::regprocedure)
    into writer_code;
  select pg_get_functiondef(
    'private.fwh_verified_additional_package_run(uuid,uuid,uuid)'::regprocedure)
    into finder_code;

  if position('private.fwh_verified_additional_package_run' in guard_code)=0
     or position('private.photo_transfer_receipts' in guard_code)=0
     or position('Immutable package/run closure' in guard_code)=0
     or position('private.client_delivery_final_receipts' in guard_code)=0
     or position('fs.digest' in guard_code)=0
     or position('old.status' in lower(writer_code))=0
     or position('new.status' in lower(writer_code))=0
     or position('DELIVERING' in writer_code)=0
     or position('private.client_package_photos' in writer_code)=0
     or position('private.fwh_verified_additional_package_run' in writer_code)=0
     or position('private.client_package_runs' in writer_code)=0
     or position('private.client_delivery_file_plans' in finder_code)=0
     or position('private.photo_transfer_receipts' in finder_code)=0
     or position('private.correction_obligations' in finder_code)=0
     or position('private.fwh_exact_frozen_run_photo' in finder_code)=0
     or not exists(select 1 from pg_trigger
       where tgrelid='private.client_packages'::regclass
         and tgname='client_package_terminal_run_closure'
         and not tgisinternal)
  then raise exception 'Approved exact-identity delivery/closure owner missing';end if;

  select count(*) into before_count from private.client_package_runs;
  if (select count(*) from private.client_package_runs)<>before_count
  then raise exception 'Read-only cross-run selection changed closure state';end if;
  raise notice 'PASS: exact frozen selection, mismatches denied, immutable closure retained, no external writes';
end;
$gate$;
rollback;
