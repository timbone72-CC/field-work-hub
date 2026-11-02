-- Disposable CI PostgreSQL context only. Never apply to hosted Supabase.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
 id uuid primary key default gen_random_uuid(), email text,
 raw_app_meta_data jsonb not null default '{}'::jsonb,
 raw_user_meta_data jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 deleted_at timestamptz, banned_until timestamptz, email_confirmed_at timestamptz, last_sign_in_at timestamptz
);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid;$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.jwt(),auth.uid() to anon,authenticated,service_role;
-- Controlled sessions for new current-session authorization gates only.
create table auth.sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), not_after timestamptz
);


-- Minimal disposable Storage catalog surface for candidate RLS verification only.
-- Hosted Supabase owns its real storage schema/tables; never apply this test fixture there.
create schema storage;
create table storage.objects (
 id uuid primary key default gen_random_uuid(),
 bucket_id text not null,
 name text not null,
 owner uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_accessed_at timestamptz not null default now(),
 metadata jsonb,
 path_tokens text[],
 version text,
 owner_id text,
 user_metadata jsonb,
 archived_at timestamptz,
 is_delete_marker boolean not null default false,
 is_versioned boolean not null default false,
 unique(bucket_id,name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select,insert on storage.objects to authenticated;
grant select,insert,update,delete on storage.objects to service_role;
