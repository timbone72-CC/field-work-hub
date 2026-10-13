-- Approved Phase 5A late first-time client assignment; never change an established
-- company, historic Finish/photo IDs, package/destination or provider facts.
-- Stop if the reviewed original function or its execution authority drifted.
do $preflight$
declare p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid=
  'private.admin_assign_client_company(uuid,uuid,uuid,uuid)'::regprocedure;
 if p.oid is null or md5(p.prosrc)<>'9cc57bdd2c09c3d52e367cecdfcdacbc'
   or p.proowner<>'postgres'::regrole or not p.prosecdef
   or p.proconfig is distinct from array['search_path=""','lock_timeout=5s']
   or p.proacl is distinct from
     '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
 then raise exception 'Late client binding stopped: reviewed function or ACL drift';end if;
end;
$preflight$;

create table private.client_company_assignment_actions (
 action_id uuid primary key,
 work_order_id uuid not null references public.work_orders(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 company_id uuid not null references private.client_companies(id) on delete restrict,
 expected_revision uuid not null,
 result jsonb not null,
 recorded_at timestamptz not null default now()
);
create index client_company_assignment_actions_work_order
 on private.client_company_assignment_actions(work_order_id);
revoke all on private.client_company_assignment_actions from public,anon,authenticated;
alter table private.client_company_assignment_actions enable row level security;

CREATE OR REPLACE FUNCTION private.admin_assign_client_company(p_action uuid, p_work_order uuid, p_company uuid, p_expected_policy_revision uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare w public.work_orders%rowtype; c private.client_companies%rowtype; result jsonb;
  prior private.client_company_assignment_actions%rowtype;
  evidence_exists boolean;
begin
  if p_action is null or p_work_order is null or p_company is null
    or p_expected_policy_revision is null then
    raise exception 'Explicit company, action and revision required' using errcode='22023';end if;
  perform private.lock_account_lifecycle();
  if not private.current_identity_valid() or not private.can_work_order(p_work_order) then
    raise exception 'Current office authority required' using errcode='42501';end if;
  select * into w from public.work_orders where id=p_work_order for update;
  if w.id is null then raise exception 'Job unavailable' using errcode='42501';end if;
  select * into prior from private.client_company_assignment_actions where action_id=p_action;
  if prior.action_id is not null then
    if row(prior.work_order_id,prior.actor_user_id,prior.company_id,prior.expected_revision)
       is distinct from row(p_work_order,auth.uid(),p_company,p_expected_policy_revision) then
      raise exception 'Client company action UUID reused with different inputs' using errcode='22023';end if;
    return prior.result;
  end if;
  if w.review_policy_revision is distinct from p_expected_policy_revision then
    raise exception 'Client binding changed; reload' using errcode='PT409';end if;
  select * into c from private.client_companies where id=p_company
    and organization_id=w.organization_id and active;
  if c.id is null then raise exception 'Company not configured for this organization' using errcode='42501';end if;
  if w.client_company_id is not null and w.client_company_id is distinct from p_company then
    raise exception 'Dispatched client binding cannot change' using errcode='42501';end if;
  -- First-time legacy binding is allowed only for accepted completed work
  -- with no previous client release or old provider identity. Other started
  -- work remains frozen; no previously bound company can be changed.
  if w.client_company_id is null then
    select exists(select 1 from public.field_actions where work_order_id=w.id)
      or exists(select 1 from public.photos where work_order_id=w.id)
      into evidence_exists;
    if evidence_exists and (
      w.field_status is distinct from 'FIELD_COMPLETE'
      or not exists(select 1 from public.field_actions
          where work_order_id=w.id and run_id=w.current_run_id
          and action_kind='COMPLETE')
    ) then
      raise exception 'Unfinished field evidence cannot be bound to a client' using errcode='42501';end if;
    if exists(select 1 from private.client_packages where work_order_id=w.id)
      or exists(select 1 from public.photos
         where work_order_id=w.id and (remote_file_id is not null
           or uploaded_at is not null or sync_status='UPLOADED')) then
      raise exception 'Existing client delivery identity cannot be rebound' using errcode='42501';end if;
  end if;
  if w.client_company_id is null then
    update public.work_orders set client_company_id=c.id,review_policy_revision=gen_random_uuid()
      where id=w.id returning * into w;
  end if;
  result:=jsonb_build_object('work_order_id',w.id,'company_id',w.client_company_id,
    'review_policy_revision',w.review_policy_revision);
  insert into private.client_company_assignment_actions(action_id,work_order_id,
    actor_user_id,company_id,expected_revision,result)
  values(p_action,w.id,auth.uid(),p_company,p_expected_policy_revision,result);
  return result;
end;
$function$


do $verify$
declare p pg_proc%rowtype;
begin
 select * into p from pg_proc where oid=
  'private.admin_assign_client_company(uuid,uuid,uuid,uuid)'::regprocedure;
 if p.oid is null or not p.prosecdef or p.proowner<>'postgres'::regrole
    or p.proconfig is distinct from array['search_path=""','lock_timeout=5s']
    or p.proacl is distinct from
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
    or position('private.client_company_assignment_actions' in p.prosrc)=0
    or position('Existing client delivery identity cannot be rebound' in p.prosrc)=0
    or position('PT409' in p.prosrc)=0
    or has_table_privilege('authenticated','private.client_company_assignment_actions','SELECT')
 then raise exception 'Late client binding stopped: post-change source or protected grants drift';end if;
end;
$verify$;
