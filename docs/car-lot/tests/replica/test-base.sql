-- Small test base for the car-lot SQL tests (run-base.sh): production's shape BEFORE the
-- car lot, for the objects the car-lot migrations build on. Table definitions, policies and
-- helper bodies were read from production (read-only) on 2026-11-21. The car-lot columns
-- (yards.kind, profiles.manufacturer_id, the extra roles) are left for the car-lot files to
-- add, as they did on production. Container tables are empty stand-ins: enough for part 2's
-- fences, not for container-data checks (rls-matrix check 102 needs a full export).
\set ON_ERROR_STOP 1

-- Supabase's default privileges: everything in public is granted to the API
-- roles; row-level security decides.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create type public.app_role as enum ('admin', 'user', 'super_admin', 'inspector', 'line_rep');

create table public.profiles (id uuid default gen_random_uuid() not null, user_id uuid not null, full_name text,
  role app_role default 'user'::app_role not null, created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null, username text, yard_id uuid, shipping_line text);
create table public.user_roles (id uuid default gen_random_uuid() not null, user_id uuid not null, role app_role not null);
create table public.yards (id uuid default gen_random_uuid() not null, name text not null, code text not null,
  created_by uuid not null, created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_user_id_key UNIQUE (user_id);
alter table public.profiles add constraint profiles_username_key UNIQUE (username);
alter table public.user_roles add constraint user_roles_pkey PRIMARY KEY (id);
alter table public.user_roles add constraint user_roles_user_id_role_key UNIQUE (user_id, role);
alter table public.yards add constraint yards_code_key UNIQUE (code);
alter table public.yards add constraint yards_pkey PRIMARY KEY (id);
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.yards enable row level security;

-- The container tables part 2 fences: only their existence matters here.
create table public.shipping_lines (id uuid primary key default gen_random_uuid(), code text);
do $stub$
declare t text;
begin
  foreach t in array array['containers', 'container_visits', 'inspector_checks', 'bookings', 'demurrage_payments',
    'container_port_data', 'edi_transmissions', 'shipping_line_transfers', 'cash_counts', 'accounting_month_closes'] loop
    execute format('create table public.%I (id uuid primary key default gen_random_uuid())', t);
  end loop;
end $stub$;

-- Helpers, as on production (schema private since the lock-down migration).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_line_rep(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'line_rep'); $function$;
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $function$;
CREATE OR REPLACE FUNCTION private.is_super_admin(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'super_admin'); $function$;
CREATE OR REPLACE FUNCTION private.is_yard_admin(_uid uuid, _yard uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.profiles p ON p.user_id = ur.user_id
  WHERE ur.user_id = _uid AND ur.role = 'admin' AND p.yard_id = _yard); $function$;
CREATE OR REPLACE FUNCTION private.current_yard_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT yard_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1; $function$;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _yard_id uuid; _role public.app_role; _line text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('container_yard.new_user_id', true) IS DISTINCT FROM NEW.id::text THEN
      RETURN NEW;
    END IF;
    DELETE FROM public.user_roles WHERE user_id = NEW.id;
    DELETE FROM public.profiles WHERE user_id = NEW.id;
  END IF;
  _yard_id := NULLIF(NEW.raw_app_meta_data ->> 'yard_id', '')::uuid;
  _role := COALESCE(NULLIF(NEW.raw_app_meta_data ->> 'role', ''), 'user')::public.app_role;
  _line := NULLIF(btrim(NEW.raw_app_meta_data ->> 'shipping_line'), '');
  IF _line IS NOT NULL THEN
    _line := COALESCE((SELECT sl.code FROM public.shipping_lines sl WHERE lower(sl.code) = lower(_line) LIMIT 1), _line);
  END IF;
  INSERT INTO public.profiles (user_id, full_name, username, role, yard_id, shipping_line)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'username', NEW.email),
          NEW.raw_user_meta_data ->> 'username', _role, _yard_id, CASE WHEN _role = 'line_rep' THEN _line END);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role);
  IF TG_OP = 'INSERT' THEN
    PERFORM set_config('container_yard.new_user_id', NEW.id::text, true);
  END IF;
  RETURN NEW;
END;
$function$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- yards / profiles policies as on production (read 2026-11-21).
CREATE OR REPLACE FUNCTION private.own_profile_identity_unchanged(_yard_id uuid, _username text, _shipping_line text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
     AND p.yard_id IS NOT DISTINCT FROM _yard_id AND p.username IS NOT DISTINCT FROM _username
     AND p.shipping_line IS NOT DISTINCT FROM _shipping_line);
$function$;
revoke all on function private.own_profile_identity_unchanged(uuid, text, text) from public, anon;
grant execute on function private.own_profile_identity_unchanged(uuid, text, text) to authenticated, service_role;
create policy profiles_delete_admin on public.profiles as permissive for delete to public using ((( SELECT private.is_super_admin(( SELECT auth.uid() AS uid)) AS is_super_admin) OR ((yard_id IS NOT NULL) AND private.is_yard_admin(( SELECT auth.uid() AS uid), yard_id))));
create policy profiles_insert_self on public.profiles as permissive for insert to public with check (((( SELECT auth.uid() AS uid) = user_id) AND (role = 'user'::app_role) AND (yard_id IS NULL) AND (shipping_line IS NULL)));
create policy profiles_select on public.profiles as permissive for select to public using ((( SELECT private.is_super_admin(( SELECT auth.uid() AS uid)) AS is_super_admin) OR (user_id = ( SELECT auth.uid() AS uid)) OR ((yard_id IS NOT NULL) AND (yard_id = ( SELECT private.current_yard_id() AS current_yard_id)) AND (NOT ( SELECT private.is_line_rep(( SELECT auth.uid() AS uid)) AS is_line_rep)))));
create policy profiles_update on public.profiles as permissive for update to authenticated using ((( SELECT private.is_super_admin(( SELECT auth.uid() AS uid)) AS is_super_admin) OR ((user_id <> ( SELECT auth.uid() AS uid)) AND (yard_id IS NOT NULL) AND private.is_yard_admin(( SELECT auth.uid() AS uid), yard_id)) OR (( SELECT auth.uid() AS uid) = user_id))) with check ((( SELECT private.is_super_admin(( SELECT auth.uid() AS uid)) AS is_super_admin) OR ((user_id <> ( SELECT auth.uid() AS uid)) AND (yard_id IS NOT NULL) AND private.is_yard_admin(( SELECT auth.uid() AS uid), yard_id)) OR ((( SELECT auth.uid() AS uid) = user_id) AND (role = 'user'::app_role) AND private.own_profile_identity_unchanged(yard_id, username, shipping_line))));
create policy yards_delete_super on public.yards as permissive for delete to public using (( SELECT private.is_super_admin(( SELECT auth.uid() AS uid)) AS is_super_admin));
create policy yards_insert_super on public.yards as permissive for insert to public with check ((( SELECT private.is_super_admin(( SELECT auth.uid() AS uid)) AS is_super_admin) AND (created_by = ( SELECT auth.uid() AS uid))));
create policy yards_select on public.yards as permissive for select to public using ((( SELECT private.is_super_admin(( SELECT auth.uid() AS uid)) AS is_super_admin) OR (id = ( SELECT private.current_yard_id() AS current_yard_id))));
create policy yards_update_super on public.yards as permissive for update to public using (( SELECT private.is_super_admin(( SELECT auth.uid() AS uid)) AS is_super_admin)) with check (( SELECT private.is_super_admin(( SELECT auth.uid() AS uid)) AS is_super_admin));

-- The activity log only has to exist (and hide its rows) for the matrix.
create table public.activity_log (id uuid primary key default gen_random_uuid());
alter table public.activity_log enable row level security;

-- Container-yard people and the container yard, as the car-lot tests expect them.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000001', 'owner@containeryard.app', '{"username":"owner","role":"super_admin"}');
insert into public.yards (id, name, code, created_by) values
  ('00000000-0000-0000-0000-0000000000e1', 'Everest Logistics Services', 'evl', '11111111-0000-0000-0000-000000000001');
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000002', 'cy_admin@containeryard.app', '{"username":"cy_admin","role":"admin","yard_id":"00000000-0000-0000-0000-0000000000e1"}'),
  ('11111111-0000-0000-0000-000000000003', 'cy_insp@containeryard.app',  '{"username":"cy_insp","role":"inspector","yard_id":"00000000-0000-0000-0000-0000000000e1"}'),
  ('11111111-0000-0000-0000-000000000004', 'cy_user@containeryard.app',  '{"username":"cy_user","role":"user","yard_id":"00000000-0000-0000-0000-0000000000e1"}'),
  ('11111111-0000-0000-0000-000000000005', 'cy_rep@containeryard.app',   '{"username":"cy_rep","role":"line_rep","shipping_line":"WOM"}');
