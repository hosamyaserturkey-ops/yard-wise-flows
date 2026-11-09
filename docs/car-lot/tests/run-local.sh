#!/usr/bin/env bash
# Local, schema-only test of the car-lot migration. Never connects to Supabase.
#
#   run-local.sh <schema.sql> [--pending-first | --pending-after]
#
# <schema.sql>  output of replica/export-schema.sql (read-only, run on production)
# --pending-*   also apply the repo migrations that production does not have yet
#               (20261011120000, 20261011130000, 20261021120000) before / after
#
# Needs a local PostgreSQL 15+ superuser reachable through the usual PG* env
# vars (PGHOST, PGPORT, PGUSER). Creates and drops database $DB (default
# carlot_test). Results land in $OUT (default: a new temp dir).
#
# What it checks
#   1. container yard: every pre-existing table's rows (on their original
#      columns), and what each container-yard user and anon can see and do,
#      before vs after the migration - on the same database;
#   2. car lot: the RLS / storage matrix (rls-matrix.sql), as real signed-in users.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
CARLOT=$(dirname "$HERE")
MIGRATIONS=$(cd "$CARLOT/../../supabase/migrations" && pwd)
SCHEMA=${1:?usage: run-local.sh <schema.sql> [--pending-first|--pending-after]}
MODE=${2:-}
DB=${DB:-carlot_test}
OUT=${OUT:-$(mktemp -d)}
mkdir -p "$OUT"
PENDING=(
  "$MIGRATIONS/20261011120000_lock_down_security_definer_functions.sql"
  "$MIGRATIONS/20261011130000_rls_initplan_fk_indexes_policy_merges.sql"
  "$MIGRATIONS/20261021120000_admin_delete_container.sql"
)
P=(psql -X -q -v ON_ERROR_STOP=1)

apply() {
  local log="$OUT/apply-$(basename "$1").log"
  "${P[@]}" -d "$DB" -f "$1" >"$log" 2>&1 || { echo "APPLY FAILED: $1"; tail -3 "$log"; exit 1; }
}

probe() {
  mkdir -p "$OUT/$1"
  "${P[@]}" -d "$DB" -At -f "$OUT/fingerprint.sql" >"$OUT/$1/_data.txt"
  local u
  for u in owner:11111111-0000-0000-0000-000000000001 cy_admin:11111111-0000-0000-0000-000000000002 \
           cy_insp:11111111-0000-0000-0000-000000000003 cy_user:11111111-0000-0000-0000-000000000004 \
           cy_rep:11111111-0000-0000-0000-000000000005 anon:; do
    psql -X -q -d "$DB" -v uid="${u#*:}" -v role="$([ "${u%%:*}" = anon ] && echo anon || echo authenticated)" \
      -v fingerprint="$OUT/fingerprint.sql" -f "$HERE/container-probe.sql" >"$OUT/$1/${u%%:*}.txt" 2>&1
  done
}

echo "== building replica in database $DB (results: $OUT)"
"${P[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
"${P[@]}" -d "$DB" -f "$HERE/replica/supabase-stubs.sql" >/dev/null
PGOPTIONS="-c check_function_bodies=off" "${P[@]}" -d "$DB" -f "$SCHEMA" >/dev/null
"${P[@]}" -d "$DB" -c "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();" >/dev/null
"${P[@]}" -d "$DB" -f "$HERE/replica/seed-container-yard.sql" >/dev/null

# Fingerprint queries use the PRE-migration column lists, so added columns don't count as changes.
"${P[@]}" -d "$DB" -At >"$OUT/fingerprint.sql" <<'SQL'
select format('select %L as tbl, count(*) as n, md5(coalesce(string_agg(row(%s)::text, %L order by row(%s)::text), %L)) as fp from %I.%I;',
  table_schema||'.'||table_name, string_agg(quote_ident(column_name), ', ' order by ordinal_position), '|',
  string_agg(quote_ident(column_name), ', ' order by ordinal_position), '', table_schema, table_name)
from information_schema.columns
where (table_schema='public' and table_name in (select tablename from pg_tables where schemaname='public'))
   or (table_schema='storage' and table_name in ('objects','buckets'))
group by table_schema, table_name order by 1;
SQL

probe before
if [ "$MODE" = "--pending-first" ]; then for f in "${PENDING[@]}"; do apply "$f"; done; fi
apply "$CARLOT/car-lot-part1-enum.sql"
apply "$CARLOT/car-lot-part2-schema.sql"
if [ "$MODE" = "--pending-after" ]; then for f in "${PENDING[@]}"; do apply "$f"; done; fi
probe after

echo "== container yard, before vs after (expected: +1 yards row, owner sees 2 yards)"
for f in "$OUT"/before/*.txt; do
  n=$(basename "$f")
  if diff -q "$f" "$OUT/after/$n" >/dev/null; then echo "SAME     $n"; else echo "CHANGED  $n"; { diff "$f" "$OUT/after/$n" || true; } | sed 's/^/    /'; fi
done

echo "== car-lot RLS matrix"
"${P[@]}" -d "$DB" -v photos=vehicle_inspection_photos -f "$HERE/carlot-seed.sql" >/dev/null
"${P[@]}" -d "$DB" -v photos=vehicle_inspection_photos -f "$HERE/rls-matrix.sql" >"$OUT/matrix.txt" 2>&1
grep -E "\| FAIL" "$OUT/matrix.txt" || true
grep -A2 "pass | fail" "$OUT/matrix.txt" | tail -1
! grep -q "| FAIL" "$OUT/matrix.txt"
