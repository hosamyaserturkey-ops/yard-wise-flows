# Car-lot migration tests

Two checks, run as real signed-in users (role `authenticated` + a JWT `sub`), never as the service role:

1. **Container yard unchanged.** On one database, before and after the migration: every pre-existing table's rows (hashed on their original columns), what each container-yard user and anon can see, and the outcome of 15 everyday actions (gate-in, gate-out, inspection, demurrage, booking, port data, uploads, admin RPCs). Writes are rolled back. Script: `container-probe.sql`.
2. **Car-lot RLS matrix.** Plan section 6, 89 checks, each in its own rolled-back subtransaction. Scripts: `carlot-seed.sql` (fixtures), `rls-matrix.sql`.

## Run locally (no Supabase, no cost)

```bash
# 1. Export production's schema (read-only, no rows). Run replica/export-schema.sql
#    in the Supabase SQL editor and save the single output value as schema.sql.
# 2. Point PG* at a local PostgreSQL 15+ superuser, then:
docs/car-lot/tests/run-local.sh schema.sql                  # car lot on today's production schema
docs/car-lot/tests/run-local.sh schema.sql --pending-after  # ...then the 3 repo migrations prod lacks
docs/car-lot/tests/run-local.sh schema.sql --pending-first  # those 3 first, then the car lot
```

The replica is the production schema plus small stand-ins for Supabase's `auth` and `storage` schemas (`replica/supabase-stubs.sql`), filled with made-up container-yard data (`replica/seed-container-yard.sql`). It exercises Postgres (RLS, triggers, storage policies) but not Supabase's HTTP layers (PostgREST, Storage API, Auth), so a staging run on real Supabase is still required before production.

## On a Supabase staging project or branch

`carlot-seed.sql` and `rls-matrix.sql` also run in the SQL editor of a **non-production** project after the migration (they insert test users into `auth.users`). Set the `photos` variable by replacing `:photos` / `:'photos'` with `vehicle_inspection_photos` when not using psql. Never run them on production.
