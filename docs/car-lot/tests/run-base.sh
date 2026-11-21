#!/usr/bin/env bash
# Car-lot SQL tests on a small local base: no production export needed, never touches Supabase.
#
#   run-base.sh [--without-slots]
#
# Builds database $DB (default carlot_base) from replica/supabase-stubs.sql and
# replica/test-base.sql (production's pre-car-lot shape of yards / profiles / user_roles and
# the helpers the car lot builds on), then the car-lot files in production's order, then the
# fixtures (carlot-seed.sql). Runs slots.sql (unless --without-slots), history.sql,
# retention.sql (with a throwaway token set in this local database only) and rls-matrix.sql.
#
# Needs a local PostgreSQL 15+ superuser reachable through the usual PG* env vars.
# Known: rls-matrix check 102 ("owner reads all containers") needs container data that this
# base does not have; it fails here and passes on a full replica (run-local.sh).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
CARLOT=$(dirname "$HERE")
MIGRATIONS=$(cd "$CARLOT/../../supabase/migrations" && pwd)
DB=${DB:-carlot_base}
OUT=${OUT:-$(mktemp -d)}
P=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

apply() {
  local f=$1; shift
  "${P[@]}" "$@" -f "$f" >"$OUT/apply-$(basename "$f").log" 2>&1 \
    || { echo "APPLY FAILED: $f"; grep -m1 -iE 'error|fatal' "$OUT/apply-$(basename "$f").log"; exit 1; }
}

psql -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
apply "$HERE/replica/supabase-stubs.sql"
apply "$HERE/replica/test-base.sql"
apply "$CARLOT/car-lot-part1-enum.sql"
apply "$CARLOT/car-lot-part2-schema.sql"
apply "$MIGRATIONS/20261115000000_car_lot_retention.sql"
apply "$MIGRATIONS/20261121000000_car_lot_history_hold_gateout.sql"
[ "${1:-}" != "--without-slots" ] && apply "$MIGRATIONS/20261121180000_car_lot_slots.sql"
apply "$HERE/carlot-seed.sql" -v photos=vehicle_inspection_photos

TOKEN="local-test-token-$$"
"${P[@]}" -c "update private.retention_settings set token_hash = encode(sha256(convert_to('$TOKEN', 'UTF8')), 'hex')"

run() {
  local f=$1; shift
  psql -X -q -d "$DB" -v photos=vehicle_inspection_photos "$@" -f "$HERE/$f" >"$OUT/$f.txt" 2>&1
  echo "$f: $(grep -E '^ *[0-9]+ *\| *[0-9]+ *$' "$OUT/$f.txt" | tail -1 | tr -s ' ') (pass | fail)"
  grep -E '^ *FAIL|\| FAIL|ERROR' "$OUT/$f.txt" | cut -c1-200 | head -10
}
[ "${1:-}" != "--without-slots" ] && run slots.sql
run history.sql
run retention.sql -v token="$TOKEN"
run rls-matrix.sql
echo "full output: $OUT"
