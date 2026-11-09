# Car Lot Module - Implementation Plan (for Claude Code)

Put this file, `car-lot-part1-enum.sql` and `car-lot-part2-schema.sql` in the repo root of the EVL Yard Manager app, then tell Claude Code: "Read car-lot-plan-for-claude-code.md and follow it phase by phase. Stop at every checkpoint."

## 1. Context

- **App:** EVL Yard Manager, a multi-tenant container depot web app backed by Supabase (project name "Container Yard", ref `qctvjwlaxnidprhcxodj`, eu-north-1). Used by Everest Logistics (EVL) in Aqaba, Jordan.
- **Goal:** reuse the same codebase and database for a second, separate operation: a **car storage lot** at a nearby location, same company, for vehicles of different manufacturers.
- **Team on the lot:** the manager (the app owner, who also runs the container yard) plus 2 staff.
- **Hard requirements (all confirmed):**
  1. The lot has its own users, accounting logic (own price lists, invoice numbering, revenue totals) and reports.
  2. Manufacturers log in and see **only their own** stock, read-only.
  3. Car inspections use a **new, separate** private storage bucket.
  4. The existing container yard must keep working exactly as it does today.
- **Language:** the team works in English and Arabic. Check how the app handles i18n/RTL today and follow it.

### Existing backend facts (verified by reading the live database)

- Tenancy is by `yard_id`. `public.yards` currently has 1 row (`evl`, "Everest Logistics Services"). `profiles.yard_id` links a user to a yard.
- Helper functions (SECURITY DEFINER): `current_yard_id()`, `has_role(uid, role)`, `get_user_role(uid)`, `is_super_admin(uid)`, `is_yard_admin(uid, yard)`, `is_line_rep(uid)`, `line_scope_ok(line)`, `has_approved_inspection_for_trip(container_id)`.
- Enum `app_role`: admin, user, super_admin, inspector, line_rep. Roles live in `user_roles`; `profiles.role` also exists.
- Container tables: `containers` (no yard_id), `container_visits` (ticket sequence, gate in/out, yard_block/yard_row), `inspector_checks` (photo_urls jsonb, grades A-D), `bookings`, `demurrage_payments`, `shipping_line_transfers`, `cash_counts`, `accounting_month_closes`, `edi_transmissions`, `activity_log` (action enum, shift enum).
- Existing buckets: `inspection-photos` (private, 5 MB, images), `transfer-receipts` (private).
- **Known weaknesses found (the migration fences them):** `containers` has no yard scoping; the two existing buckets are role-based, not yard-based.
- **Not yet read (read these first):** the bodies of `is_line_rep`, `line_scope_ok`, `is_yard_admin`; how new users/profiles are created (trigger or edge function); whether sign-up is open or invite-only.

## 2. Rules for Claude Code

1. **Never apply anything to the production project** (`qctvjwlaxnidprhcxodj`) without explicit approval from the user in chat. Work on a Supabase **branch** first. Creating a branch costs money: get the cost and ask before confirming.
2. Do not change container-yard behavior. Any change to existing tables, policies, queries or screens must be additive or guarded by unit type / yard kind. List every touched existing file in your summary.
3. Never hardcode yard IDs, manufacturer IDs or URLs. Derive location from the logged-in user's profile.
4. Security must be enforced in Postgres (RLS and storage policies), never only in the UI.
5. Regenerate the Supabase TypeScript types after each schema change and fix all type errors (adding enum value `manufacturer_rep` may break exhaustive switches on `app_role`).
6. Do not delete or edit inspection photos or closed inspections anywhere in the app. Corrections are new photos with a note.
7. Do not print secrets, keys or test passwords in chat. Put test credentials in the project's seed/example-config file only.
8. After each phase, run the project's lint, type-check and tests, and report results honestly, including failures.
9. Ask before guessing on anything listed in section 7.

## 3. Phase 0 - Discovery (read-only, no changes)

- Inspect the repo: framework, routing, state/data layer, how Supabase is called, how roles/yard are read on the client, i18n/RTL, existing inspection photo upload code, print/ticket code, reports code.
- Read the three unread helper functions and the user-creation flow in the database (read-only SQL).
- Review `car-lot-part1-enum.sql` and `car-lot-part2-schema.sql` line by line. Report anything wrong, risky, or inconsistent with the live schema before going further.
- **Checkpoint:** post a short summary (stack, where each change will go, schema review findings). Wait for approval.

## 4. Phase 1 - Database (on a branch)

1. Create a branch of the project (get cost, ask first).
2. Apply `car-lot-part1-enum.sql`, then `car-lot-part2-schema.sql` as two separate migrations.
3. Seed on the branch only: the car-lot yard, 2 test manufacturers (A and B), and test users: lot admin, lot inspector, lot office user, manufacturer A rep, manufacturer B rep. Container-yard test users already exist or must be created (admin, inspector, line rep).
4. Run the RLS test matrix (section 6). Fix the migration files, not the branch by hand, so the files stay the source of truth.
5. Run the Supabase security and performance advisors and fix anything the new objects introduced.
6. **Checkpoint:** show the test matrix results. Wait for approval before touching production.

## 5. Phase 2 - Application

Build in this order, each as a small reviewable change:

1. **Location awareness:** read the user's yard `kind`. Staff of the car lot see the vehicle UI; container-yard staff see the container UI; the owner (`super_admin`) can switch location. Manufacturer users get a separate, minimal portal layout (they have no yard).
2. **Vehicle registry:** create/search vehicles by VIN (17 chars, no I/O/Q; uppercase; show a clear validation message). Fields: manufacturer, model, year, colour.
3. **Gate-in flow:** pick or create vehicle, create `vehicle_visit` (lot zone/slot, odometer, key count, running yes/no, driver/truck), then open the gate-in inspection.
4. **Inspection + photos (mobile-first):**
   - Fixed shot list: front, rear, four corners, roof, both sides, interior, dashboard/odometer, keys; plus free-form "damage" photos with a note.
   - Compress on the device (about 1600 px wide, JPEG, moderate quality) before upload; keep under the 5 MB bucket limit.
   - Compute SHA-256 of the uploaded file and store it in `file_sha256`.
   - Upload path must be exactly `{manufacturer_id}/{vehicle_id}/{inspection_id}/{unique-file-name}` (unique name so no overwrite/upsert is needed), then insert the `inspection_photos` row.
   - "Close inspection" locks it. Show a clear read-only state afterwards.
   - Show photos through short-lived signed URLs, never public URLs.
5. **Gate-out flow:** gate-out inspection with the same shot list, side-by-side comparison against gate-in photos, then set the visit to `out` with gate-out driver/truck, odometer, and the staff member who released it. Block gate-out of a vehicle on `on-hold`.
6. **Lot map:** flat 2D list/grid of zones and slots (cars do not stack). Show occupancy and which cars are blocked in. Keep this simple first (zone + slot text), a visual map comes later.
7. **Manufacturer portal (read-only):** current stock with status, days stored per car, gate-in/out history, inspection photos and notes, statements/invoices (once phase 3 exists). Nothing else is reachable: no navigation to container pages, other manufacturers, staff, tariffs of others.
8. **Reports (car lot only):** dwell time, occupancy, inventory by manufacturer, monthly activity. Owner gets a read-only combined view of both locations.
9. **Activity log:** reuse existing `gate_in` / `gate_out` actions with the VIN and visit id in `metadata`. Add new action values only if truly needed (separate migration, own approval).
10. **Tickets:** gate-in/gate-out tickets using `vehicle_visits.ticket_number`, same print approach as container tickets.

## 6. RLS / security test matrix (must pass before production)

Run each as a real signed-in user (not the service role). Expected result in brackets.

| Actor | Action | Expected |
|---|---|---|
| Manufacturer A rep | list vehicles / visits / inspections / photos | only A's rows |
| Manufacturer A rep | read B's vehicle by id, B's photo by path or signed URL | denied / empty |
| Manufacturer A rep | insert/update/delete anything on vehicle tables | denied |
| Manufacturer A rep | read `containers`, `container_visits`, `bookings`, `activity_log`, `profiles` of others, `inspection-photos`, `transfer-receipts` | denied / empty |
| Manufacturer A rep | update own profile `manufacturer_id` to B | denied |
| Lot inspector | create vehicle, visit, inspection, upload photo to open inspection | allowed |
| Lot inspector | upload to a closed inspection, to another yard's path, or with a path that does not match the inspection | denied |
| Lot inspector | update/delete a photo; edit a closed inspection | denied |
| Lot inspector | read container tables, container photos, receipts | denied / empty |
| Lot office user | read lot data; write anything | read ok, write denied |
| Lot admin | manage manufacturers, vehicles, visits | allowed, own yard only |
| Container yard admin / inspector | read or write any car-lot table, photo or bucket path | denied / empty |
| Container yard users | every existing screen and action | unchanged |
| Owner (`super_admin`) | read both locations | allowed |
| Anonymous | anything | denied |

Also confirm: only one open visit per vehicle (unique index), VIN format rejection, duplicate VIN rejection.

## 7. Open decisions (ask the user, do not guess)

1. **Office role:** read-only (current draft) or allowed to register vehicles/visits?
2. **Owner access:** is `super_admin` (can also edit) acceptable for the boss, or add a read-only owner role?
3. **Manufacturer account creation:** who creates them and how (super_admin dashboard, edge function with service role, invite email)? Sign-up must not be open.
4. **Free days / tariff model:** per manufacturer defaults exist (`default_free_days`, `default_daily_rate`); confirm billing rule (per vehicle per day, handling/damage charges, currency, rounding).
5. **Retention:** how long photos and visits are kept after release (suggest at least several months for late damage claims).
6. **Insurance/liability wording** on tickets and the portal: needs wording from the user's employer.
7. **Languages for the manufacturer portal:** English only or Arabic too.

## 8. Phase 3 - Car lot accounting (needs its own design, not yet in the SQL)

The draft migration only has `daily_rate` and `fees` on visits. Before building accounting, propose and get approval for a second migration covering: per-manufacturer price lists, charge lines (storage days, handling, damage), invoices with their own number series, payments, voids with reason (mirror how `demurrage_payments` voids work), monthly close (mirror `accounting_month_closes`), and statements per manufacturer. Same legal entity, so company name and tax details are shared; numbering, totals and reports are separate from the container yard.

## 9. Phase 4 - Rollout

1. Final review of all migration files and the app diff by the user.
2. With explicit approval, apply part 1, then part 2, to production. Immediately run the sanity checks at the bottom of part 2.
3. Create the real manufacturers and users. Test once with one real manufacturer account before inviting others.
4. Train the 2 staff on the shot list and the closed-inspection rule.
5. Keep the rollback block from part 2 available for the first days.

## 10. Definition of done

- All matrix rows in section 6 pass on the branch and again on production after rollout.
- Container yard: no behavior change (smoke test gate-in, gate-out, inspection, demurrage payment, EDI).
- Types regenerated, lint/type-check/tests green, no new advisor warnings from the new objects.
- A short handover note: what was added, what existing files changed, and the open items left.
