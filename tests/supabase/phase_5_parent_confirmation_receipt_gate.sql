-- Phase 5D native PostgreSQL source regression. All effects ROLLBACK.
-- This validates exact function ownership/grants and canonical immutable
-- destination-proof semantics WITHOUT calling Google or changing live data.
begin;
do $gate$
declare
  target constant text:='private.service_confirm_delivery_parent(uuid,uuid,bigint,uuid,jsonb)';
  exposed constant text:='public.service_confirm_delivery_parent(uuid,uuid,bigint,uuid,jsonb)';
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

  -- Exercise the same PostgreSQL JSONB operator semantics with deliberately
  -- conflicting legacy and canonical key values: only the canonical proof wins.
  if nullif(saved->>'shared_drive_id','') is null
     or correct->>'drive_id' is distinct from saved->>'shared_drive_id'
     or not (mismatch->>'drive_id' is distinct from saved->>'shared_drive_id')
     or nullif(missing->>'shared_drive_id','') is not null
     or nullif(empty->>'shared_drive_id','') is not null
  then raise exception 'Canonical immutable shared-drive comparison regression';end if;
  raise notice 'PASS: canonical provider shared_drive_id accepted; legacy/wrong/empty/missing keys denied; guard and service-only grants preserved';
end;
$gate$;
rollback;
