# Car-lot migration tests

Two checks, run as real signed-in users (role `authenticated` + a JWT `sub`), never as the service role:

1. **Container yard unchanged.** On one database, before and after the migration: every pre-existing table's rows (hashed on their original columns), what each container-yard user and anon can see, and the outcome of 15 everyday actions (gate-in, gate-out, inspection, demurrage, booking, port data, uploads, admin RPCs). Writes are rolled back. Script: `container-probe.sql`.
2. **Car-lot RLS matrix.** Plan section 6, 107 checks, each in its own rolled-back subtransaction. Scripts: `carlot-seed.sql` (fixtures), `rls-matrix.sql`.

## Run locally (no Supabase, no cost)

```bash
# 1. Export production's schema (read-only, no rows). Run replica/export-schema.sql
#    in the Supabase SQL editor and save the single output value as schema.sql.
# 2. Point PG* at a local PostgreSQL 15+ superuser, then:
docs/car-lot/tests/run-local.sh schema.sql                  # car lot on today's production schema
docs/car-lot/tests/run-local.sh schema.sql --pending-after  # ...then the 3 repo migrations prod lacks
docs/car-lot/tests/run-local.sh schema.sql --pending-first  # those 3 first, then the car lot
```

The replica is the production schema plus small stand-ins for Supabase's `auth` and `storage` schemas (`replica/supabase-stubs.sql`), filled with made-up container-yard data (`replica/seed-container-yard.sql`). It exercises Postgres (RLS, triggers, the upload-key function) but not Supabase's HTTP layers (PostgREST, Auth) or the Worker and R2, so a staging run on real Supabase is still required before production.

## On a Supabase staging project or branch

`carlot-seed.sql` and `rls-matrix.sql` also run in the SQL editor of a **non-production** project after the migration (they insert test users into `auth.users`). Set the `photos` variable by replacing `:photos` / `:'photos'` with `vehicle_inspection_photos` when not using psql. Never run them on production.

## History, hold reason and the gate-out rule

`history.sql` tests `supabase/migrations/20261121000000_car_lot_history_hold_gateout.sql`
(41 checks, every step as a real signed-in user, rolled back at the end). Run it on the
database `run-local.sh` builds, after applying `20261115000000_car_lot_retention.sql` and
that migration:

    psql -X -d carlot_test -f history.sql

## Slots, scan-to-move and the full-slot rule

`slots.sql` tests `supabase/migrations/20261121180000_car_lot_slots.sql` (60 checks, as real
signed-in users, rolled back at the end):
- who may add and see slots;
- normalised names and look-alike codes;
- moving by scan, from the list, or typed;
- the full-slot rule, including when the code is typed, a direct update, or a hand-set override flag;
- overrides (admin or owner only, with a reason);
- slots of another lot or out of use;
- slots with cars in them;
- released cars;
- `car_lot_edit_car()`;
- the history, and the typed-spot rule's test vectors (shared with `src/lib/__tests__/lotSlots.test.ts`).

## Quick run without a production export

`run-base.sh` builds a small base (`replica/test-base.sql`: production's pre-car-lot `yards`,
`profiles` and `user_roles` with their policies, plus the helpers the car lot builds on, read from
production on 2026-11-21). It then applies the car-lot files in production's order and the
fixtures, and runs `slots.sql`, `history.sql`, `retention.sql` (with a throwaway token in the
local database only) and `rls-matrix.sql`:

    PGHOST=... PGPORT=... PGUSER=postgres docs/car-lot/tests/run-base.sh

Results on 2026-11-21:
- `slots.sql` 60/60;
- `history.sql` 41/41;
- `retention.sql` 36/36;
- `rls-matrix.sql` 107/108. The one failure is check 102, "owner reads all containers": it needs container data this base doesn't hold and passes on a full replica.
- `--without-slots` gives the same history / retention / matrix results, so the migration changes none of them.
- The rollback (`../car-lot-slots-rollback.sql`) was tested on this base:
  - it refuses once a car has a slot;
  - otherwise it leaves nothing behind, and the visit guard, history trigger and `car_lot_edit_car()` are byte-identical to before.
