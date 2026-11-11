-- FWH-F04 / 5D-T02. Allow only an *approved frozen* zero-photo manifest
-- through the existing package-scoped, service-only dispatch. Approval and
-- requirements/review checks remain in admin/package owners. All identity,
-- destination, permit, provider receipt and cleanup fences are unchanged.
-- Additive source migration; no dispatch flag, Send or Drive operation here.
create or replace function private.service_bounded_frozen_photo_ids(p_photos jsonb)
returns boolean language plpgsql immutable security invoker
set search_path='' as $photos$
declare valid boolean;
begin
  if jsonb_typeof(p_photos) is distinct from 'array' then return false;end if;
  if jsonb_array_length(p_photos)>200 then return false;end if;
  -- No selected JPEGs is legitimate only after the *same* approved manifest
  -- and authorization checks in the existing service definer RPCs.
  if jsonb_array_length(p_photos)=0 then return true;end if;
  select count(*)=count(distinct lower(photo_id))
      and coalesce(bool_and(photo_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),false)
  into valid
  from (select v->>'photo_id' as photo_id from jsonb_array_elements(p_photos) as v) x;
  return coalesce(valid,false);
end;
$photos$;

-- Preserve the private helper's original non-exposed execution boundary.
revoke all on function private.service_bounded_frozen_photo_ids(jsonb)
from public,anon,authenticated,service_role;
