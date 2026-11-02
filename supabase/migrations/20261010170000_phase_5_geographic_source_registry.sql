-- Phase 5D geographic hierarchy foundation (candidate only).
-- Keeps the existing client root -> ADDRESS -> WORK_ORDER -> PACKAGE runtime
-- path unchanged until verified geography and all parent-CAS gates are ready.
-- Do not auto-infer a county/city or activate delivery from this registry.
create table private.client_delivery_geography (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  company_id uuid not null,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  state_name text not null,
  county_name text not null,
  city_name text not null,
  normalized_state text generated always as
    (lower(btrim(state_name))) stored,
  normalized_county text generated always as
    (lower(btrim(county_name))) stored,
  normalized_city text generated always as
    (lower(btrim(city_name))) stored,
  verification_source text not null,
  verified_by uuid not null,
  verified_at timestamptz not null,
  revision uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, company_id)
    references private.client_companies(organization_id,id) on delete restrict,
  unique (organization_id,company_id,work_order_id),
  check (char_length(btrim(state_name)) between 2 and 100
    and char_length(btrim(county_name)) between 2 and 100
    and char_length(btrim(city_name)) between 2 and 100),
  check (state_name=btrim(state_name) and county_name=btrim(county_name)
    and city_name=btrim(city_name)),
  check (char_length(btrim(verification_source)) between 3 and 200)
);
-- Never permit direct browser/Contractor writes. An authorized revisioned
-- verification RPC must be built and tested before any records are created.
alter table private.client_delivery_geography enable row level security;
revoke all on private.client_delivery_geography from public,anon,authenticated,service_role;
create index client_delivery_geography_lookup
  on private.client_delivery_geography
  (organization_id,company_id,normalized_state,normalized_county,normalized_city);
