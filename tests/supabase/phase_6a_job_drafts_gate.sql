-- Disposable CI only. All synthetic writes roll back; never run on hosted TEST.
begin;
do $gate$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 actor uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011';
 second_actor uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); foreign_actor uuid:=gen_random_uuid();
 wo uuid; base timestamptz; cfg jsonb; body jsonb; saved jsonb; checked jsonb; rev uuid; write_id uuid:=gen_random_uuid();
 before_row jsonb; denied boolean;
begin
 insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) values
  (second_actor,'second-draft@example.invalid',jsonb_build_object('role','ADMIN','organization_id',org),now());
 insert into auth.sessions(id,user_id) values(second_actor,second_actor);
 insert into private.account_work_access(organization_id,user_id,work_role,active) values(org,second_actor,'ADMIN',true);
 insert into private.admin_team_memberships(organization_id,team_id,user_id,active)
 values(org,'00000000-0000-0000-0000-000000000020',second_actor,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,
  'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 execute 'set local role authenticated';
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 select (j->>'work_order_id')::uuid into wo from fwh_test_fixtures.legacy_create_work_order_v4(false,
  'DRAFT-'||gen_random_uuid(),'Synthetic draft address','Inspection','active original',current_date,contractor,cfg) j;
 select updated_at,to_jsonb(w) into base,before_row from public.work_orders w where id=wo;
 body:=jsonb_build_object('woNumber','','propertyAddress','','workType','Inspection','instructions','Unapplied draft',
  'dueDate','','assignedUserId',contractor,'requirements',cfg,'requirementsLegacy',false,'expectedRevision',cfg->>'revision');
 checked:=public.admin_job_draft_state(wo);
 if checked->'draft'<>'null'::jsonb then raise exception 'Fresh job exposed a draft';end if;
 saved:=public.admin_save_job_draft(wo,body,null,base,write_id);rev:=(saved->'draft'->>'revision')::uuid;
 if saved->'draft'->'payload' is distinct from body or saved->'draft'->>'stale'<>'false'
 then raise exception 'Draft not saved exactly';end if;
 if (select to_jsonb(w) from public.work_orders w where id=wo) is distinct from before_row
 then raise exception 'Draft save mutated active work';end if;
 checked:=public.admin_save_job_draft(wo,body,null,base,write_id);
 if checked->'draft'->>'revision' is distinct from rev::text then raise exception 'Lost-response retry changed draft revision';end if;
 denied:=false;begin
  perform public.admin_save_job_draft(wo,body,null,base,gen_random_uuid());
 exception when sqlstate 'PT409' then denied:=true;end;
 if not denied then raise exception 'Second tab overwrote first draft';end if;
 denied:=false;begin
  perform public.admin_save_job_draft(wo,body||'{"instructions":"wrong identity reuse"}',rev,base,write_id);
 exception when sqlstate 'PT409' then denied:=true;end;
 if not denied then raise exception 'Reused write identity changed data';end if;
 denied:=false;begin
  perform public.admin_save_job_draft(wo,body||jsonb_build_object('organization_id',org),rev,base,gen_random_uuid());
 exception when sqlstate '22023' then denied:=true;end;
 if not denied then raise exception 'Caller organization override accepted';end if;
 denied:=false;begin execute 'select * from private.admin_job_drafts';
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Draft table exposed directly';end if;
 -- Another office user in the SAME team sees only their own independent draft.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',second_actor,'session_id',second_actor,
  'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 if public.admin_job_draft_state(wo)->'draft'<>'null'::jsonb then raise exception 'Other Admin draft leaked';end if;
 checked:=public.admin_save_job_draft(wo,body||'{"instructions":"second actor"}',null,base,gen_random_uuid());
 if checked->'draft'->'payload'->>'instructions'<>'second actor' then raise exception 'Independent actor draft blocked';end if;
 -- Contractor, stale session, same-org missing-team and foreign org all deny.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor,
  'role','authenticated','app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
 denied:=false;begin perform public.admin_job_draft_state(wo);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor read a job draft';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',gen_random_uuid(),
  'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 denied:=false;begin perform public.admin_job_draft_state(wo);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Invalid session read draft';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,
  'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 -- Changed active details hold the draft rather than applying or silently rebasing it.
 perform public.admin_update_work_order_v4(wo,'DRAFT-CHANGED','Synthetic draft address','Inspection','new active',current_date,contractor,
  (cfg->>'revision')::uuid,null,base);
 -- now() is constant in this rolled-back transaction. Age only the synthetic
 -- draft's base timestamp to represent a save from an earlier transaction.
 execute 'reset role';
 base:=base-interval '1 microsecond';
 update private.admin_job_drafts set base_updated_at=base where work_order_id=wo and owner_user_id=actor;
 execute 'set local role authenticated';
 checked:=public.admin_job_draft_state(wo);
 if checked->'draft'->>'stale'<>'true' or checked->'draft'->'payload' is distinct from body
 then raise exception 'Stale draft was lost or silently rebased';end if;
 denied:=false;begin perform public.admin_save_job_draft(wo,body,rev,base,gen_random_uuid());
 exception when sqlstate 'PT409' then denied:=true;end;
 if not denied then raise exception 'Stale base accepted';end if;
 checked:=public.admin_save_job_draft(wo,body,null,base,write_id);
 if checked->'draft'->>'revision'<>rev::text then raise exception 'Exact retry lost after job change';end if;
 denied:=false;begin perform public.admin_discard_job_draft(wo,gen_random_uuid());
 exception when sqlstate 'PT409' then denied:=true;end;
 if not denied then raise exception 'Stale discard accepted';end if;
 checked:=public.admin_discard_job_draft(wo,rev);
 if checked->'draft'<>'null'::jsonb then raise exception 'Discard did not clear own draft';end if;
 if (select instructions from public.work_orders where id=wo)<>'new active' then raise exception 'Discard changed active work';end if;
 execute 'reset role';
 insert into public.organizations(id,name) values(other_org,'Synthetic foreign draft org');
 insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) values(foreign_actor,
  'foreign-draft@example.invalid',jsonb_build_object('role','ADMIN','organization_id',other_org),now());
 insert into auth.sessions(id,user_id) values(foreign_actor,foreign_actor);
 insert into private.account_work_access(organization_id,user_id,work_role,active) values(other_org,foreign_actor,'ADMIN',true);
 insert into public.admin_teams(id,organization_id,name) values(other_org,other_org,'Foreign draft team');
 insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(other_org,other_org,foreign_actor,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',foreign_actor,'session_id',foreign_actor,
  'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',other_org))::text,true);
 execute 'set local role authenticated';
 denied:=false;begin perform public.admin_job_draft_state(wo);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Foreign organization accessed draft';end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,
  'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 -- Current scope removal denies access even with the previously valid JWT.
 update private.admin_team_memberships set active=false where user_id=actor;
 execute 'set local role authenticated';
 denied:=false;begin perform public.admin_job_draft_state(wo);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Revoked scope read draft';end if;
 execute 'reset role';execute 'set local role anon';
 denied:=false;begin perform public.admin_job_draft_state(wo);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Anonymous caller reached draft endpoint';end if;
 execute 'reset role';
 if (select count(*) from private.admin_job_drafts where work_order_id=wo)<>1
 then raise exception 'Other Admin draft was removed';end if;
end;$gate$;
rollback;
