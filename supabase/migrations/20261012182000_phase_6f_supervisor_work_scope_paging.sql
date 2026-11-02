-- Phase 6F: freeze an opaque current authorized-team fingerprint across
-- Supervisor work pages. A scope change must not mix old and new browser rows.
create or replace function public.office_supervisor_work_page(
  p_org uuid, p_after uuid default null, p_limit integer default 25
) returns jsonb
language plpgsql security definer set search_path='' as $work$
declare
  caller_tier smallint;
  page_rows jsonb;
  next_cursor text;
  scope_fingerprint text;
begin
  if p_org is null or p_limit is null or p_limit not between 1 and 50
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

  -- The same predicate used for rows identifies the current authorized team set.
  -- Tier and organization are included so the browser cannot mix older pages
  -- after a grant, team-scope, team-active, or tier change.
  select md5(p_org::text || '|' || caller_tier::text || '|' ||
    coalesce(string_agg(t.id::text, ',' order by t.id),''))
    into scope_fingerprint
    from public.admin_teams t where t.organization_id=p_org and t.active
      and private.has_team_capability(p_org,t.id,'WORK');

  -- The same current work capability also guards every row after a revoke.
  -- Stable UUID order makes the cursor independent of mutable WO display data.
  with eligible as (
    select w.id,w.wo_number,w.property_address,w.work_type,w.due_date,
      w.field_status,w.responsible_team_id,t.name as team_name
    from public.work_orders w
    join public.admin_teams t on t.id=w.responsible_team_id
      and t.organization_id=w.organization_id and t.active
    where w.organization_id=p_org and (p_after is null or w.id>p_after)
      and private.has_team_capability(w.organization_id,w.responsible_team_id,'WORK')
    order by w.id limit p_limit+1
  ), numbered as (
    select e.*,row_number() over(order by e.id) as rn from eligible e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'work_order_id',id,'wo_number',wo_number,'property_address',property_address,
      'work_type',work_type,'due_date',due_date,'field_status',field_status,
      'team_id',responsible_team_id,'team_name',team_name
    ) order by id) filter(where rn<=p_limit),'[]'::jsonb),
    case when count(*)>p_limit then max(id::text) filter(where rn=p_limit) else null end
  into page_rows,next_cursor from numbered;

  return jsonb_build_object('organization_id',p_org,'caller_tier',caller_tier,
    'work_orders',page_rows,'next_after',next_cursor,
    'scope_fingerprint',scope_fingerprint);
end;
$work$;
revoke all on function public.office_supervisor_work_page(uuid,uuid,integer)
  from public,anon;
grant execute on function public.office_supervisor_work_page(uuid,uuid,integer)
  to authenticated;
