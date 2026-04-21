

## Goal

Wipe all operational data from the database (keeping schema, users, and roles intact) and seed `container_port_data` with realistic fake test data so you can test the demurrage workflow end-to-end.

## What gets cleared

All rows from these tables will be deleted:
- `containers` — all gate-in/gate-out records
- `container_port_data` — all port arrival rows (will be re-seeded)
- `demurrage_payments` — all collected payments
- `shipping_line_transfers` — all payout transfers
- `bookings` — all bookings
- `edi_transmissions` — all EDI logs

What stays untouched:
- `auth.users`, `profiles`, `user_roles` (your login + admin role preserved)
- All table structures, RLS policies, functions, triggers
- Storage bucket `transfer-receipts` (files remain; we only clear DB rows)

## Fake port data to seed (15 containers)

Mix of overdue (demurrage due), borderline, and within-free-days cases across the 12 supported shipping lines. Free days = 7 for all. Port arrival dates are relative to today (2026-04-21).

| # | Container | Shipping Line | Port Arrival | Free Days | Daily Demurrage (JOD) | Expected status |
|---|-----------|---------------|--------------|-----------|----------------------|-----------------|
| 1  | SLGU1234567 | SLG | 2026-03-15 | 7 | 25 | Overdue (~30 chargeable days) |
| 2  | SLDU2345678 | SLD | 2026-03-20 | 7 | 25 | Overdue (~25 days) |
| 3  | SFSU3456789 | SFS | 2026-04-01 | 7 | 30 | Overdue (~13 days) |
| 4  | MDKU4567890 | MDK | 2026-04-05 | 7 | 20 | Overdue (~9 days) |
| 5  | INXU5678901 | INX | 2026-04-08 | 7 | 35 | Overdue (~6 days) |
| 6  | ICRU6789012 | ICR | 2026-04-10 | 7 | 28 | Overdue (~4 days) |
| 7  | EMKU7890123 | EMK | 2026-04-12 | 7 | 22 | Borderline (~2 days) |
| 8  | BLTU8901234 | BLT | 2026-04-14 | 7 | 25 | Just due (1 day) |
| 9  | AXLU9012345 | AXL | 2026-04-15 | 7 | 30 | Free period ends today |
| 10 | XSLU0123456 | XSL | 2026-04-17 | 7 | 25 | Within free days |
| 11 | TRLU1122334 | TRL | 2026-04-18 | 7 | 25 | Within free days |
| 12 | 2XXU2233445 | 2   | 2026-04-19 | 7 | 25 | Within free days |
| 13 | SEKU1157908 | SLD | 2026-03-10 | 7 | 30 | Heavily overdue (~35 days, matches your earlier test) |
| 14 | MSCU3344556 | SLG | 2026-04-19 | 7 | 25 | Within free days |
| 15 | CMAU4455667 | SFS | 2026-04-02 | 7 | 30 | Overdue (~12 days) |

This gives you variety: containers with payment due, containers right at the cutoff, and containers still in their free period.

## Technical execution

1. Run a single SQL transaction via `psql` (data-only, no schema changes):
   - `TRUNCATE` the 6 operational tables (with `RESTART IDENTITY CASCADE` where needed) — `TRUNCATE` is fast and resets everything cleanly.
   - `INSERT` the 15 rows above into `container_port_data` with `last_source = 'manual'`.
2. Verify with a `SELECT COUNT(*)` per table and a `SELECT *` from `container_port_data`.
3. Output the seeded data back to you in chat as a clean table for reference.

No code changes, no migrations — schema is preserved exactly. After this runs, your dashboard will show zero containers/bookings/payments, and any of the 15 container numbers above will trigger the demurrage flow on the Gate In page.

