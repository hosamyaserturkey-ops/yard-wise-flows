# Container Schema Refactor

All container-related tables are currently empty, so this is a pure schema + code change with no data migration.

## 1. Database migration

Runs as a single migration. Approximate order:

**Drop old constraints and dependencies**
- Drop RLS policies, FKs, and the composite PK on `public.containers`.
- Drop the `shipping_line IN ('SLD','SLG')` CHECK from every table that has it (containers, bookings, container_port_data, shipping_line_transfers, demurrage_payments, edi_transmissions — whichever apply).
- Drop any FKs from `inspector_checks`, `demurrage_payments`, `activity_log`, `edi_transmissions`, `container_port_data` that point at `containers.id` (composite). They'll be recreated to point at `container_visits(id)` where appropriate, or kept referencing `containers(id)` for master-data links (see below).

**Rebuild `containers` as master data**
- Keep only: `id uuid PK`, `container_number text UNIQUE NOT NULL`, `container_type text NOT NULL`, `shipping_line text NOT NULL`, `created_at`, `updated_at`.
- Drop all other columns (driver_name, truck_number, gate_in_time, gate_out_time, status, booking_number, fees, port_arrival_date, free_days, daily_demurrage, yard_block, yard_row, yard_id, created_by, booking_id, etc.).
- Primary key becomes `(id)` only.
- Recreate RLS: authenticated users can read; insert/update by authenticated (a container is master data shared across yards).

**Create `container_visits`**
```
id uuid PK
container_id uuid NOT NULL REFERENCES containers(id) ON DELETE CASCADE
yard_id uuid NOT NULL REFERENCES yards(id)
gate_in_time timestamptz NOT NULL DEFAULT now()
gate_out_time timestamptz NULL
status text NOT NULL CHECK (status IN ('in-yard','out','reserved'))
driver_name text
truck_number text
booking_id uuid NULL REFERENCES bookings(id)
booking_number text
fees numeric
port_arrival_date date
free_days int DEFAULT 7
daily_demurrage numeric
yard_block text
yard_row text
created_by uuid REFERENCES auth.users(id)
created_at, updated_at
```
- Partial unique index: `UNIQUE (container_id) WHERE gate_out_time IS NULL`.
- Grants: `SELECT/INSERT/UPDATE/DELETE` to authenticated, `ALL` to service_role.
- RLS mirrors current containers policies (yard-scoped via `current_yard_id()` / role checks).
- `updated_at` trigger.

**Repoint dependent tables**
- `inspector_checks.container_id` → `container_visits(id)`.
- `demurrage_payments.container_id` → `container_visits(id)` (visit-scoped charge).
- `activity_log.container_id` → `container_visits(id)`.
- `edi_transmissions.container_id` → `container_visits(id)`.
- `container_port_data` stays keyed to the master `containers(id)` (port arrival data is per physical container).

**Create `shipping_lines`**
```
id uuid PK
code text UNIQUE NOT NULL
name text NOT NULL
contact_email text NULL
default_free_days int NOT NULL DEFAULT 7
default_daily_demurrage numeric NULL
active boolean NOT NULL DEFAULT true
created_at timestamptz
```
- Seed rows: `SLD` / `Shipping Line D`, `SLG` / `Shipping Line G`.
- Grants: SELECT to authenticated, ALL to service_role.
- RLS: authenticated read; only `is_super_admin(auth.uid())` may insert/update/delete.

## 2. App code updates

Every file that reads/writes containers is updated to use `container_visits` for visit state and `containers` for identity.

- `src/types/container.ts` — split into `Container` (master) and `ContainerVisit`; keep a combined view type for UI.
- `src/pages/GateIn.tsx` — upsert into `containers` by `container_number`, then insert a `container_visits` row (status `in-yard`).
- `src/pages/GateOut.tsx` — update the open visit (`gate_out_time`, `fees`, status `out`); read demurrage from the visit; log activity + EDI referencing the visit id.
- `src/pages/Dashboard.tsx`, `src/pages/Reports.tsx`, `src/pages/Accounting.tsx`, `src/pages/YardMap.tsx`, `src/components/CommandPalette.tsx`, `src/components/ReserveContainerDialog.tsx` — query `container_visits` joined to `containers` for stock, status, and search.
- `src/components/ContainerDetailDialog.tsx` — load the container master row + list all its visits (history).
- `src/pages/BookingDetail.tsx` — list visits assigned to a booking; assignment writes `container_visits.booking_id/booking_number`.
- `src/pages/PortDemurrageData.tsx` — still keyed on master container.
- `src/lib/activityLog.ts` — accepts a `visitId`; no shape change beyond that.
- `src/lib/shippingLines.ts` — becomes a runtime loader that fetches `shipping_lines` (falls back to `[]` before load). All dropdowns (`GateIn`, filters, port data, transfers) use the fetched list. Zod validation checks against the loaded set.
- `scripts/import-containers.ts` — rewritten to insert master + visit rows (kept but not run; tables are empty).

## 3. `create-user` edge function

- `supabase/functions/create-user/index.ts`: change `if (password.length < 6)` to `if (password.length < 10)` and update the error message. Nothing else — `verify_jwt` untouched.

## 4. Verification

After migration + code changes:
- Run `tsgo` to confirm the type surface compiles.
- Spot-check Dashboard/GateIn/GateOut queries against the new schema types.

## 5. Files to be modified (for GitHub review)

Migration (new):
- `supabase/migrations/<timestamp>_containers_refactor.sql`

Edge function:
- `supabase/functions/create-user/index.ts`

Frontend:
- `src/types/container.ts`
- `src/lib/shippingLines.ts`
- `src/lib/validation.ts`
- `src/lib/activityLog.ts`
- `src/pages/GateIn.tsx`
- `src/pages/GateOut.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/Reports.tsx`
- `src/pages/Accounting.tsx`
- `src/pages/YardMap.tsx`
- `src/pages/BookingDetail.tsx`
- `src/pages/PortDemurrageData.tsx`
- `src/components/CommandPalette.tsx`
- `src/components/ReserveContainerDialog.tsx`
- `src/components/ContainerDetailDialog.tsx`
- `scripts/import-containers.ts` (and `scripts/import-containers-full.ts` if it has the same shape)

The final "files modified" list in the closing message will match what actually changes on disk.
