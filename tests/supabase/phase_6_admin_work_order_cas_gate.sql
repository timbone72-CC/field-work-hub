-- Rolled-back, synthetic Phase 6A work-order revision CAS proof.
-- This file is run only against disposable PostgreSQL CI, NEVER hosted.
begin;
do $gate$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 admin_id uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011';
 wo uuid; original_updated timestamptz; cfg jsonb;
 req_revision uuid; result jsonb; n integer; denied boolean;
begin
 if to_regprocedure('public.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb)') is null
  or to_regprocedure('private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb)') is null
 then raise exception 'Published-main Admin edit surface was broken during staged revision rollout';end if;
 if to_regprocedure('public.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb,timestamptz)') is null
  or to_regprocedure('private.admin_update_work_order_v4(uuid,text,text,text,text,date,uuid,uuid,jsonb,timestamptz)') is null
 then raise exception 'Revision-aware Admin edit overload missing';end if;
 perform set_config('request.jwt.claims',jsonb_build_object(
   'sub',admin_id,'session_id',admin_id,'role','authenticated',
   'app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 execute 'set local role authenticated';
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),
  'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 select (j->>'work_order_id')::uuid into wo
  from public.admin_create_work_order_v4(
   false,'CAS-'||gen_random_uuid(),'Synthetic Address','INSPECTION','original',
   current_date,contractor,cfg) j;
 select updated_at into original_updated from public.work_orders where id=wo;
 select nullif(requirement_snapshot->>'revision','')::uuid into req_revision
  from public.work_order_runs where work_order_id=wo and id=(
    select current_run_id from public.work_orders where id=wo);
 if wo is null or original_updated is null then raise exception 'CAS fixture missing';end if;
 -- A known stale revision is denied before ANY requirement or ordinary-field write.
 denied:=false;
 begin
  perform public.admin_update_work_order_v4(
   wo,'NEW-WO','Synthetic Address','INSPECTION','wrong',current_date,
   contractor,req_revision,cfg,original_updated - interval '1 microsecond');
 exception when sqlstate 'PT409' then denied:=true;end;
 if not denied then raise exception 'Stale Admin edit incorrectly accepted';end if;
 if (select instructions from public.work_orders where id=wo) is distinct from 'original'
 then raise exception 'Rejected edit changed persisted data';end if;
 -- Exact current revision succeeds once through the existing narrow owner.
 select count(*) into n from public.admin_update_work_order_v4(
  wo,'CAS-SAVED-'||wo,'Synthetic Address','INSPECTION','confirmed',
  current_date,contractor,req_revision,cfg,original_updated);
 if n<>1 or (select instructions from public.work_orders where id=wo)<>'confirmed'
 then raise exception 'Current Admin edit failed';end if;
 denied:=false;
 begin
  perform public.admin_update_work_order_v4(
   wo,'CAS-OTHER','Synthetic Address','INSPECTION','bad null revision',
   current_date,contractor,req_revision,cfg,null);
 exception when sqlstate 'PT409' then denied:=true;end;
 if not denied then raise exception 'Missing revision accepted';end if;
 if (select instructions from public.work_orders where id=wo)<>'confirmed'
 then raise exception 'Missing revision mutated job';end if;
 execute 'reset role';
end;
$gate$;
rollback;
