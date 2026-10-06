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
