-- Phase 5D native PostgreSQL source regression. All effects ROLLBACK.
-- This validates exact function ownership/grants and canonical immutable
-- destination-proof semantics WITHOUT calling Google or changing live data.
begin;
do $gate$
declare
  target constant text:='private.service_confirm_delivery_parent(uuid,uuid,bigint,uuid,jsonb)';
  exposed constant text:='public.service_confirm_delivery_parent(uuid,uuid,bigint,uuid,jsonb)';
  package_target constant text:='private.service_confirm_delivery_folder(uuid,uuid,bigint,uuid,jsonb)';
  package_public constant text:='public.service_confirm_delivery_folder(uuid,uuid,bigint,uuid,jsonb)';
  package_definition text;
  definition text;
  saved jsonb:=jsonb_build_object('shared_drive_id','immutable_test_drive_001',
                                  'drive_id','wrong_legacy_drive_002');
  correct jsonb:=jsonb_build_object('drive_id','immutable_test_drive_001');
  mismatch jsonb:=jsonb_build_object('drive_id','wrong_legacy_drive_002');
  missing jsonb:='{}'::jsonb;
  empty jsonb:=jsonb_build_object('shared_drive_id','');
begin
  if to_regprocedure(target) is null or to_regprocedure(exposed) is null
    or not has_function_privilege('service_role',target,'EXECUTE')
    or not has_function_privilege('service_role',exposed,'EXECUTE')
    or has_function_privilege('anon',target,'EXECUTE')
    or has_function_privilege('authenticated',target,'EXECUTE')
    or has_function_privilege('anon',exposed,'EXECUTE')
    or has_function_privilege('authenticated',exposed,'EXECUTE')
  then raise exception 'Original parent RPC owner/grants changed';end if;

  definition:=pg_get_functiondef(to_regprocedure(target));
  if position('private.service_delivery_parent_guard(' in definition)=0
    or position('nullif(d.verification_receipt ->> ''shared_drive_id''::text' in definition)=0
       and position('nullif(d.verification_receipt->>''shared_drive_id''' in definition)=0
    or position('p_proof ->> ''drive_id''::text' in definition)=0
       and position('p_proof->>''drive_id''' in definition)=0
    or position('d.verification_receipt ->> ''drive_id''::text' in definition)>0
    or position('d.verification_receipt->>''drive_id''' in definition)>0
    or position('p_proof' in definition)=0
    or position('appProperties' in definition)=0
    or position('create_attempts' in definition)=0
    or position('f.remote_folder_id' in definition)=0
    or position('f.parent_remote_id' in definition)=0
    or position('f.remote_name' in definition)=0
    or position('f.remote_evidence' in definition)=0
  then raise exception 'Parent confirmation lost exact identity/attempt guard or canonical shared-drive proof';end if;

  -- The same canonical verified-destination key must guard the existing
  -- package-folder receipt path. Its public wrapper is NOT client-executable.
  if to_regprocedure(package_target) is null or to_regprocedure(package_public) is null
    or not has_function_privilege('service_role',package_target,'EXECUTE')
    or not has_function_privilege('service_role',package_public,'EXECUTE')
    or has_function_privilege('authenticated',package_target,'EXECUTE')
    or has_function_privilege('anon',package_target,'EXECUTE')
    or has_function_privilege('authenticated',package_public,'EXECUTE')
    or has_function_privilege('anon',package_public,'EXECUTE')
  then raise exception 'Package confirmation grants changed';end if;
  package_definition:=pg_get_functiondef(to_regprocedure(package_target));
  if position('private.service_delivery_package_folder_guard(' in package_definition)=0
    or position('shared_drive_id' in package_definition)=0
    or position('d.verification_receipt ->> ''drive_id''::text' in package_definition)>0
    or position('d.verification_receipt->>''drive_id''' in package_definition)>0
    or position('f.drive_file_id' in package_definition)=0
    or position('f.drive_parent_id' in package_definition)=0
    or position('a.remote_evidence' in package_definition)=0
    or position('create' in lower(package_definition))=0
    or position('appProperties' in package_definition)=0
  then raise exception 'Package folder confirmation changed protected proof or guard';end if;

  -- Exercise the same PostgreSQL JSONB operator semantics with deliberately
  -- conflicting legacy and canonical key values: only the canonical proof wins.
  if nullif(saved->>'shared_drive_id','') is null
     or correct->>'drive_id' is distinct from saved->>'shared_drive_id'
     or not (mismatch->>'drive_id' is distinct from saved->>'shared_drive_id')
     or nullif(missing->>'shared_drive_id','') is not null
     or nullif(empty->>'shared_drive_id','') is not null
  then raise exception 'Canonical immutable shared-drive comparison regression';end if;
  raise notice 'PASS: canonical shared_drive_id protects parent and package folder receipts; legacy/wrong/empty/missing denied and service-only grants preserved';
end;
$gate$;
rollback;
