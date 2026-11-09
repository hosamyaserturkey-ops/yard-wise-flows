-- Minimal stand-ins for the parts of Supabase the app schema depends on.
-- auth.uid()/role()/jwt() and storage.foldername() are copied from the live project.
-- gen_random_uuid() is built in (PG13+); no extension needed.

do $$ begin
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null; end $$;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb LANGUAGE sql STABLE
AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$function$;
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text LANGUAGE sql STABLE
AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$function$;
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid LANGUAGE sql STABLE
AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$function$;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner_id text
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid default auth.uid(),
  created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text, owner_id text, user_metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[] LANGUAGE plpgsql IMMUTABLE
AS $function$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;
CREATE OR REPLACE FUNCTION storage.filename(name text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE
AS $function$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[array_length(_parts, 1)];
END
$function$;

-- Same default privileges the live project has in public (from pg_default_acl):
-- every new table, sequence and function is granted to anon + authenticated.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
