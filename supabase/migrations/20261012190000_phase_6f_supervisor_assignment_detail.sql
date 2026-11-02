-- Phase 6F: Supervisor assignment visibility is an exact selected-work projection.
-- The same scoped/detail authority remains the only owner; this adds no work
-- mutation, broad contractor roster, photo access or inferred human Accept.
-- A durable download receipt and the human's explicit Accept stay distinct.
create or replace function public.office_supervisor_work_detail(
  p_org uuid, p_work_order uuid, p_expected_scope_fingerprint text
) returns jsonb
language plpgsql security definer set search_path='' as $detail$
declare
  caller_tier smallint;
  scope_fingerprint text;
  selected jsonb;
begin
  if p_org is null or p_work_order is null
    or p_expected_scope_fingerprint is null
    or p_expected_scope_fingerprint !~ '^[0-9a-f]{32}$'
    or not private.current_identity_valid()
    or private.current_work_role(p_org) is distinct from 'SUPERVISOR'
    or not exists(select 1 from private.org_work_settings s
      where s.organization_id=p_org and s.supervisor_work_ready) then
    raise exception 'Current Supervisor work authorization required'
      using errcode='42501';
  end if;
  select g.tier into caller_tier from private.supervisor_grants g
    where g.organization_id=p_org and g.user_id=auth.uid() and g.active;
  if caller_tier is null or caller_tier not between 1 and 3 then
    raise exception 'Current Supervisor tier required' using errcode='42501';
  end if;
  -- Exact formula shared with office_supervisor_work_page; a grant/tier
  -- change refuses stale selection rather than mixing authorized scopes.
  select md5(p_org::text || '|' || caller_tier::text || '|' ||
    coalesce(string_agg(t.id::text, ',' order by t.id),''))
    into scope_fingerprint
    from public.admin_teams t where t.organization_id=p_org and t.active
      and private.has_team_capability(p_org,t.id,'WORK');
  if scope_fingerprint is distinct from p_expected_scope_fingerprint then
    raise exception 'Supervisor work scope changed; reload before viewing details'
      using errcode='40001';
  end if;
  -- Only the selected exact-team WO, never photos, release, staff or account data.
  select jsonb_build_object(
    'work_order_id',w.id,'team_id',w.responsible_team_id,'team_name',t.name,
    'wo_number',w.wo_number,'property_address',w.property_address,
    'work_type',w.work_type,'instructions',w.instructions,
    'due_date',w.due_date,'field_status',w.field_status,
    'created_at',w.created_at,'updated_at',w.updated_at,
    'work_revision',md5(to_jsonb(w)::text),
    'assignment',jsonb_build_object(
      'assignee_id',w.assigned_user_id,
      'assignee_label',case when w.assigned_user_id is null then 'Unassigned'
        else coalesce(nullif(btrim(assignee.email),''),'Assigned account (identity unavailable)') end,
      'download_received_at',coalesce(assignment.assignment_received_at,w.assignment_received_at),
      'human_accepted_at',assignment.acknowledgment_received_at,
      'pending_assignee_id',w.pending_assignee_user_id,
      'pending_assignee_label',case when w.pending_assignee_user_id is null then null
        else coalesce(nullif(btrim(pending.email),''),'Pending account (identity unavailable)') end,
      'reassignment_requested_at',w.reassignment_requested_at
    )
  ) into selected from public.work_orders w
    join public.admin_teams t on t.id=w.responsible_team_id
      and t.organization_id=w.organization_id and t.active
    left join auth.users assignee on assignee.id=w.assigned_user_id
      and assignee.deleted_at is null
      and assignee.raw_app_meta_data->>'organization_id'=p_org::text
    left join auth.users pending on pending.id=w.pending_assignee_user_id
      and pending.deleted_at is null
      and pending.raw_app_meta_data->>'organization_id'=p_org::text
    left join lateral (
      select a.assignment_received_at,a.acknowledgment_received_at
        from public.work_order_assignments a
        where a.run_id=w.current_run_id and a.organization_id=p_org
          and a.assigned_user_id=w.assigned_user_id
        order by a.assignment_started_at desc,a.id desc limit 1
    ) assignment on true
    where w.id=p_work_order and w.organization_id=p_org
      and private.has_team_capability(w.organization_id,w.responsible_team_id,'WORK');
  if selected is null then
    raise exception 'Work order unavailable in current Supervisor scope'
      using errcode='42501';
  end if;
  return jsonb_build_object('organization_id',p_org,'caller_tier',caller_tier,
    'scope_fingerprint',scope_fingerprint,'work_order',selected);
end;
$detail$;

revoke all on function public.office_supervisor_work_detail(uuid,uuid,text) from public,anon;
grant execute on function public.office_supervisor_work_detail(uuid,uuid,text) to authenticated;
