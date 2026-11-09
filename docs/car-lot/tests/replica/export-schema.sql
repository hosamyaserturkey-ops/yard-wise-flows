-- READ-ONLY. Run on production (SQL editor, or psql -At) to get the public
-- schema's structure as one SQL script: types, sequences, tables,
-- constraints, indexes, views, functions, function grants, triggers, RLS
-- switches and policies (public + storage.objects). No rows are exported.
-- Save the single output value as schema.sql; run-local.sh loads it into a
-- throwaway local database.
with
enums as (select 10 ord, format('create type public.%I as enum (%s);', t.typname, string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder)) ddl
  from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname),
seqs as (select 20, format('create sequence if not exists public.%I;', c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'),
tabs as (select 30, format('create table public.%I (%s);', c.relname, string_agg(format('%I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
      case when d.adbin is null then ''
           when a.attgenerated = 's' then ' generated always as (' || pg_get_expr(d.adbin, d.adrelid) || ') stored'
           else ' default ' || pg_get_expr(d.adbin, d.adrelid) end,
      case when a.attnotnull then ' not null' else '' end), ', ' order by a.attnum))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='public' and c.relkind='r' group by c.relname),
cons as (select case when con.contype='f' then 41 else 40 end, format('alter table public.%I add constraint %I %s;', rel.relname, con.conname, pg_get_constraintdef(con.oid))
  from pg_constraint con join pg_class rel on rel.oid=con.conrelid join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public' and con.contype in ('p','u','c','f','x')),
idx as (select 42, pg_get_indexdef(ix.indexrelid) || ';' from pg_index ix join pg_class t on t.oid=ix.indrelid join pg_namespace n on n.oid=t.relnamespace
  where n.nspname='public' and not exists (select 1 from pg_constraint k where k.conindid=ix.indexrelid)),
views as (select 43, format('create view public.%I%s as %s', c.relname,
    case when c.reloptions is not null then ' with (' || array_to_string(c.reloptions, ', ') || ')' else '' end, pg_get_viewdef(c.oid))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v'),
funcs as (select 50, pg_get_functiondef(p.oid) || ';' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
fgrants as (select 51, format('revoke all on function public.%I(%s) from public, anon, authenticated;', p.proname, pg_get_function_identity_arguments(p.oid))
    || case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then format(' grant execute on function public.%I(%s) to authenticated;', p.proname, pg_get_function_identity_arguments(p.oid)) else '' end
    || case when has_function_privilege('anon', p.oid, 'EXECUTE') then format(' grant execute on function public.%I(%s) to anon;', p.proname, pg_get_function_identity_arguments(p.oid)) else '' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
trigs as (select 60, pg_get_triggerdef(t.oid) || ';' from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public'),
rls as (select 70, format('alter table public.%I enable row level security;', c.relname) || case when c.relforcerowsecurity then format(' alter table public.%I force row level security;', c.relname) else '' end
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity),
pols as (select 80, format('create policy %I on %I.%I as %s for %s to %s%s%s;', pol.polname, n.nspname, c.relname,
    case when pol.polpermissive then 'permissive' else 'restrictive' end,
    case pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
    coalesce((select string_agg(case when ro = 0 then 'public' else quote_ident(r.rolname) end, ', ') from unnest(pol.polroles) ro left join pg_roles r on r.oid = ro), 'public'),
    case when pol.polqual is not null then ' using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')' else '' end,
    case when pol.polwithcheck is not null then ' with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')' else '' end)
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage'))
select string_agg(ddl, E'\n\n' order by ord, ddl) from (
  select * from enums union all select * from seqs union all select * from tabs union all select * from cons union all select * from idx union all select * from views
  union all select * from funcs union all select * from fgrants union all select * from trigs union all select * from rls union all select * from pols) x;
