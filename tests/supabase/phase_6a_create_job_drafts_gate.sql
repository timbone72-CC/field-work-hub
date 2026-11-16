-- Disposable local/CI only: incomplete new-work entries must remain drafts.
begin;
do $gate$
declare
 org uuid:='00000000-0000-0000-0000-000000000001'; actor uuid:='00000000-0000-0000-0000-000000000010';
 contractor uuid:='00000000-0000-0000-0000-000000000011'; other_actor uuid:=gen_random_uuid();
 cfg jsonb; payload jsonb; saved jsonb; replay jsonb; rev uuid; request_id uuid:=gen_random_uuid();
 before_work bigint; before_runs bigint; denied boolean; created jsonb; created_replay jsonb; creation_rev uuid;
begin
 select count(*) into before_work from public.work_orders;select count(*) into before_runs from public.work_order_runs;
 insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) values(other_actor,'create-draft@example.invalid',jsonb_build_object('role','ADMIN','organization_id',org),now());
 insert into auth.sessions(id,user_id) values(other_actor,other_actor);
 insert into private.account_work_access(organization_id,user_id,work_role,active) values(org,other_actor,'ADMIN',true);
 insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(org,'00000000-0000-0000-0000-000000000020',other_actor,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 execute 'set local role authenticated';
 cfg:=jsonb_build_object('schema',1,'revision',gen_random_uuid(),'total',jsonb_build_object('enabled',false,'minimum',0),'items','[]'::jsonb);
 payload:=jsonb_build_object('woNumber','NEW-CUSTOM','propertyAddress','Unfinished address','workType','','instructions','draft instructions','dueDate','','assignedUserId','',
 'requirements',cfg,'requirementsLegacy',false,'expectedRevision',null,'numberMode','custom','rememberNumberMode',true,'sourceTemplateId',gen_random_uuid());
 if public.admin_job_draft_state(null)->'draft'<>'null'::jsonb then raise exception 'Unexpected new-work draft';end if;
 saved:=public.admin_save_job_draft(null,payload,null,null,request_id);rev:=(saved->'draft'->>'revision')::uuid;
 if saved->'work_order_id'<>'null'::jsonb or saved->'draft'->'payload' is distinct from payload
  or saved->'draft'->'base_run_id'<>'null'::jsonb or saved->'draft'->>'stale'<>'false'
 then raise exception 'New draft invented active binding or lost fields';end if;
 if public.admin_job_draft_state(null)->'draft'->'payload' is distinct from payload then raise exception 'Draft readback lost unfinished fields';end if;
 replay:=public.admin_save_job_draft(null,payload,null,null,request_id);
 if replay->'draft'->>'revision'<>rev::text then raise exception 'Replay changed revision';end if;
 denied:=false;begin perform public.admin_save_job_draft(null,payload,null,null,gen_random_uuid());exception when sqlstate 'PT409' then denied:=true;end;
 if not denied then raise exception 'Stale tab created a second new-work draft';end if;
 denied:=false;begin perform public.admin_save_job_draft(null,payload||'{"organization_id":"bad"}',rev,null,gen_random_uuid());exception when sqlstate '22023' then denied:=true;end;
 if not denied then raise exception 'Caller org accepted';end if;
 denied:=false;begin perform public.admin_save_job_draft(null,payload,rev,now(),gen_random_uuid());exception when sqlstate '22023' then denied:=true;end;
 if not denied then raise exception 'New draft accepted active WO base';end if;
 saved:=public.admin_save_job_draft(null,payload||'{"instructions":"new revision"}',rev,null,gen_random_uuid());
 if saved->'draft'->>'revision'=rev::text then raise exception 'Draft update did not advance revision';end if;
 denied:=false;begin perform public.admin_discard_job_draft(null,rev);exception when sqlstate 'PT409' then denied:=true;end;
 if not denied then raise exception 'Stale discard removed latest draft';end if;
 rev:=(saved->'draft'->>'revision')::uuid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_actor,'session_id',other_actor,'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 if public.admin_job_draft_state(null)->'draft'<>'null'::jsonb then raise exception 'Another Admin saw personal new draft';end if;
 perform public.admin_save_job_draft(null,payload,null,null,gen_random_uuid());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',contractor,'session_id',contractor,'role','authenticated','app_metadata',jsonb_build_object('role','CONTRACTOR','organization_id',org))::text,true);
 denied:=false;begin perform public.admin_job_draft_state(null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Contractor reached new draft';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 perform public.admin_discard_job_draft(null,rev);
 if public.admin_job_draft_state(null)->'draft'<>'null'::jsonb then raise exception 'New draft discard failed';end if;
 execute 'reset role';
 if (select count(*) from public.work_orders)<>before_work or (select count(*) from public.work_order_runs)<>before_runs then raise exception 'Draft created or dispatched work';end if;
 if (select count(*) from private.admin_job_drafts where work_order_id is null)<>1 then raise exception 'Other Admin draft lost';end if;
 -- Explicit creation delegates to the existing owner, consumes the draft and
 -- replays one durable receipt after a lost response; no second WO is made.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_actor,'session_id',other_actor,'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 execute 'set local role authenticated';
 saved:=public.admin_job_draft_state(null);creation_rev:=(saved->'draft'->>'revision')::uuid;
 denied:=false;begin perform public.admin_create_work_order_from_draft(creation_rev);exception when others then denied:=true;end;
 if not denied then raise exception 'Incomplete draft dispatched';end if;
 if public.admin_job_draft_state(null)->'draft'->>'revision'<>creation_rev::text then raise exception 'Failed creation lost draft';end if;
 payload:=payload||jsonb_build_object('propertyAddress','Synthetic ready address','workType','INSPECTION',
  'dueDate',current_date::text,'assignedUserId',contractor::text,'woNumber','CREATED-DRAFT-'||gen_random_uuid());
 saved:=public.admin_save_job_draft(null,payload,creation_rev,null,gen_random_uuid());creation_rev:=(saved->'draft'->>'revision')::uuid;
 select j into created from public.admin_create_work_order_from_draft(creation_rev) j;
 select j into created_replay from public.admin_create_work_order_from_draft(creation_rev) j;
 if created is distinct from created_replay or created->>'work_order_id' is null then raise exception 'Creation replay mismatch';end if;
 if public.admin_job_draft_state(null)->'draft'<>'null'::jsonb then raise exception 'Confirmed creation left a resumable draft';end if;
 execute 'reset role';
 if (select count(*) from public.work_orders)<>before_work+1 or (select count(*) from public.work_order_runs)<>before_runs+1 then raise exception 'Creation retry duplicated work';end if;
 denied:=false;begin update private.admin_job_draft_creations set result='{}'::jsonb where draft_revision=creation_rev;exception when others then denied:=true;end;
 if not denied then raise exception 'Creation receipt mutable';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,'role','authenticated','app_metadata',jsonb_build_object('role','ADMIN','organization_id',org))::text,true);
 execute 'set local role authenticated';
 denied:=false;begin perform public.admin_create_work_order_from_draft(creation_rev);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Different actor replayed a creation receipt';end if;
 execute 'reset role';

end;$gate$;
rollback;
