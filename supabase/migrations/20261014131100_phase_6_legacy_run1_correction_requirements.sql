-- Phase 6C approved legacy Run 1 read compatibility, not an evidence backfill.
-- Preserve completed legacy '{}' Run 1 snapshots and existing photo actions.
-- Stop on any unexpected installed source/authority drift.
do $preflight$
declare p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid='private.admin_correction_basis(uuid)'::regprocedure;
 if p.oid is null or md5(p.prosrc)<>'72fb67b7296dab77ce634442284eee33'
   or p.proowner<>'postgres'::regrole or not p.prosecdef
   or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
   or p.proacl is distinct from
      '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
 then raise exception 'Run 1 legacy correction: unexpected authority/source drift';end if;
end;
$preflight$;

CREATE OR REPLACE FUNCTION private.admin_correction_basis(p_wo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare w public.work_orders%rowtype; oldrun public.work_order_runs%rowtype;
    req jsonb; kind text; refs jsonb;
begin
 if p_wo is null or not private.current_identity_valid()
   or not private.can_work_order(p_wo)
   or private.phase4_admin_org() is null
 then raise exception 'Current scoped office work required' using errcode='42501';end if;
 select * into w from public.work_orders where id=p_wo;
 if w.id is null or w.field_status<>'FIELD_COMPLETE'
    or w.client_company_id is null or w.responsible_team_id is null
 then raise exception 'Current completed client work required' using errcode='PT409';end if;
 select * into oldrun from public.work_order_runs
    where id=w.current_run_id and work_order_id=w.id;
 if oldrun.id is null or oldrun.field_status<>'FIELD_COMPLETE'
   or oldrun.field_completed_at is null or
   not exists(select 1 from public.field_actions a where a.run_id=oldrun.id
      and a.work_order_id=w.id and a.action_kind='COMPLETE')
 then raise exception 'Accepted Finish required before correction' using errcode='PT409';end if;
 if exists(select 1 from public.photos p where p.work_order_id=w.id
    and p.run_id=w.current_run_id and not exists(
       select 1 from private.photo_transfers t
       join private.photo_transfer_receipts r
         on r.photo_id=t.photo_id and r.transfer_version=t.version
       where t.photo_id=p.id and t.run_id=p.run_id and t.state='RECEIVED'))
 then raise exception 'Private photo transfers still pending' using errcode='PT409';end if;
 if exists(select 1 from private.client_packages k where k.work_order_id=w.id
   and k.status in ('QUEUED','DELIVERING','FAILED','UNCERTAIN'))
 then raise exception 'Unresolved client delivery blocks correction' using errcode='PT409';end if;
 -- Original Run 1 '{}' is an explicit historic migration/backfill state,
 -- not a photo rule the Admin can edit. For exactly this old snapshot, use
 -- the already persisted validated release backfill on the same WO.
 -- Non-empty malformed/foreign snapshots still fail validation; do not
 -- rewrite the completed run, accepted Finish or historical photo minima.
 req:=case
    when w.current_run_sequence=1 and oldrun.requirement_snapshot='{}'::jsonb
      then w.release_requirement_snapshot
    when w.current_run_sequence=1 then oldrun.requirement_snapshot
    else w.release_requirement_snapshot end;
 perform private.validate_photo_requirements(req);
 kind:=case when exists(select 1 from private.client_packages k
    where k.work_order_id=w.id and k.status='DELIVERED')
    then 'CLIENT_RETURN' else 'INTERNAL_CORRECTION' end;
 return jsonb_build_object('work_order_id',w.id,'client_wo_number',w.wo_number,
   'client_company_id',w.client_company_id,'work_type',w.work_type,
   'origin_run_id',w.current_run_id,'expected_wo_updated_at',w.updated_at,
   'kind',kind,'release_requirements',req,'release_revision',w.release_requirement_revision,
   'current_assignee',w.assigned_user_id,'current_due_date',w.due_date);
end;$function$;

do $postflight$
declare p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid='private.admin_correction_basis(uuid)'::regprocedure;
 if p.oid is null or p.proowner<>'postgres'::regrole or not p.prosecdef
   or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
   or p.proacl is distinct from
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
   or position('oldrun.requirement_snapshot=''{}''::jsonb' in p.prosrc)=0
   or position('private.validate_photo_requirements(req)' in p.prosrc)=0
   or position('private.can_work_order(p_wo)' in p.prosrc)=0
 then raise exception 'Run 1 correction source or protected authorization changed';end if;
end;
$postflight$;
