-- Disposable Phase 6F handoff boundary regression. No hosted data or photo bytes.
begin;
do $gate$
declare
 org uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
 outsider uuid:=gen_random_uuid(); contractor uuid:=gen_random_uuid(); sup uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid();
 wo uuid; blocked_wo uuid; act uuid:=gen_random_uuid(); fp text; result jsonb; denied boolean;
 actor_id uuid;
begin
 insert into public.organizations(id,name) values(org,'Handoff gate');
 insert into public.admin_teams(id,organization_id,name) values(a,org,'Source'),(b,org,'Target');
 foreach actor_id in array array[owner_id,sup,outsider,contractor] loop
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
   values(actor_id,actor_id::text||'@example.invalid',now(),
   jsonb_build_object('organization_id',org,'role',case when actor_id=sup then 'SUPERVISOR' when actor_id=contractor then 'CONTRACTOR' else 'ADMIN' end));
  insert into auth.sessions(id,user_id) values(actor_id,actor_id);
 end loop;
 insert into private.account_work_access(organization_id,user_id,work_role,active)
  values(org,sup,'SUPERVISOR',true),(org,outsider,'ADMIN',true),(org,contractor,'CONTRACTOR',true);
 insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values(org,a,contractor,true);
 insert into private.org_work_settings(organization_id,supervisor_work_ready) values(org,true);
 insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason)
  values(org,sup,3,true,owner_id,'test');
 insert into public.work_orders(organization_id,responsible_team_id,wo_number,property_address,work_type,due_date)
  values(org,a,'HANDOFF-A','Test','TEST',current_date) returning id into wo;
 insert into public.work_orders(organization_id,responsible_team_id,assigned_user_id,wo_number,property_address,work_type,due_date)
  values(org,a,contractor,'HANDOFF-B','Test','TEST',current_date) returning id into blocked_wo;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',sup,'session_id',sup,
  'app_metadata',jsonb_build_object('role','SUPERVISOR','organization_id',org))::text,true);
 result:=public.preview_work_order_team_handoff(wo,b,'TEST');
 if result->>'eligible'<>'true' then raise exception 'Undispatched preview unexpectedly blocked: %',result;end if;
 fp:=result->>'review_fingerprint';
 result:=public.handoff_work_order_team(act,wo,b,fp,'Coverage','TEST');
 if result->>'status'<>'HANDED_OFF' or (select responsible_team_id from public.work_orders where id=wo)<>b
 then raise exception 'Audited undispatched handoff failed: %',result;end if;
 if public.handoff_work_order_team(act,wo,b,fp,'Coverage','TEST') is distinct from result
 then raise exception 'Exact handoff retry changed receipt';end if;
 denied:=false;
 begin perform public.handoff_work_order_team(act,wo,b,fp,'Changed','TEST');
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Changed action UUID payload accepted';end if;
 if (public.preview_work_order_team_handoff(blocked_wo,b,'TEST')->>'eligible')::boolean
 then raise exception 'Assigned work wrongly eligible for history-free handoff';end if;
 denied:=false;
 begin perform public.handoff_work_order_team(gen_random_uuid(),blocked_wo,b,
  public.preview_work_order_team_handoff(blocked_wo,b,'TEST')->>'review_fingerprint','No','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied or (select responsible_team_id from public.work_orders where id=blocked_wo)<>a
 then raise exception 'Assigned work moved without consent/recovery';end if;
 update private.supervisor_grants set active=false where user_id=sup;
 denied:=false;
 begin perform public.handoff_work_order_team(act,wo,b,fp,'Coverage','TEST');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Revoked supervisor replayed privileged handoff';end if;
end;
$gate$;
rollback;
