# Plan: Operations Visibility Upgrade

Four focused additions built on the existing Supabase schema. All scoped per yard via existing RLS patterns (`current_yard_id()`).

---

## 1. Shift-aware activity log

**Data**
- New table `activity_log`: `user_id`, `yard_id`, `action` (`gate_in` | `gate_out` | `reserve` | `demurrage_collected`), `container_id`, `container_number`, `shift` (`day` | `night`), `occurred_at`, `metadata jsonb`.
- Shift computed from `occurred_at` hour: **Day 06:00–18:00**, **Night 18:00–06:00** (adjustable constant).
- Attribution comes automatically from `auth.uid()` (logged-in user) → joined to `profiles.full_name`.

**Write path**
- Insert a row from `GateIn.tsx`, `GateOut.tsx`, `ReserveContainerDialog.tsx`, and `DemurrageCollectionDialog.tsx` after each successful action.

**Read path**
- New page `/activity` (admin + super_admin): filterable table by date range, operator, shift, action. Summary tiles: moves per operator, per shift, per day.

---

## 2. Yard map (Block + Row)

**Data**
- Add `yard_block text` and `yard_row text` columns to `containers`.
- Admin-configurable list of blocks/rows per yard via a small `yard_layout` table (`yard_id`, `blocks text[]`, `rows_per_block int`), or free text if the user prefers.
- On Gate In: two dropdowns (Block, Row) — required.
- On Gate Out: slot is cleared.

**View**
- New page `/yard-map`: grid of blocks × rows; each cell shows count and expands to list containers (number, line, size, days in yard). Search box jumps to a container's cell.

---

## 3. Photo evidence archive (inspector gate-in photos)

**Approach**
- No new upload flow. Reuse existing `inspector_checks` + `inspection-photos` bucket.
- New page `/photos`: search by container number → shows all inspector photos for that container with timestamp, inspector name, and check notes. Thumbnails + lightbox.
- Add a "View photos" link from the container detail dialog and from Gate Out (so operators can review gate-in condition before releasing).

---

## 4. Live stock dashboard (extends existing Dashboard)

Extend `src/pages/Dashboard.tsx` with:

- **Per-line stock table**: rows = shipping line, columns = 20FT / 40FT / 40HC / Reefer / Total (in-yard only).
- **Today's activity**: gate-in count, gate-out count, reservations, demurrage collected (JOD) — all filtered to today in the current yard.
- **Aging buckets**: containers in-yard grouped by 0–7, 8–14, 15–21, 22+ days. Click a bucket → filtered list.
- **Top aging units**: table of 10 oldest in-yard containers with days-in-yard, line, size, block/row.

All widgets query `containers` + `demurrage_payments` + new `activity_log`; scoped to `current_yard_id()`.

---

## Technical details

**Migrations (one migration)**
- `CREATE TABLE public.activity_log (...)` + GRANTs + RLS (yard-scoped read for members, insert for authenticated users in own yard, full access for super_admin).
- `ALTER TABLE public.containers ADD COLUMN yard_block text, ADD COLUMN yard_row text;`
- Optional `yard_layout` table for admin-configured blocks/rows.

**Files added**
- `src/pages/ActivityLog.tsx`
- `src/pages/YardMap.tsx`
- `src/pages/PhotoArchive.tsx`
- `src/lib/shifts.ts` (shift calc helper)
- `src/lib/activityLog.ts` (single `logActivity()` helper called from write paths)

**Files edited**
- `src/pages/Dashboard.tsx` — new widgets
- `src/pages/GateIn.tsx` — Block/Row inputs + `logActivity()`
- `src/pages/GateOut.tsx` — clear slot + `logActivity()` + photos link
- `src/components/ReserveContainerDialog.tsx` — `logActivity()`
- `src/components/DemurrageCollectionDialog.tsx` — `logActivity()`
- `src/components/ContainerDetailDialog.tsx` — show block/row + photos link
- `src/components/AppSidebar.tsx` — nav entries for Activity, Yard Map, Photos
- `src/App.tsx` — routes

**Access**
- Dashboard, Yard Map, Photos: any signed-in user in the yard.
- Activity Log: admin + super_admin.

**Out of scope (say if you want them)**
- Manual shift roster / operator picker (you chose auto-from-user).
- New photo uploads at gate-in (you chose inspector-only).
- Slot-level (3rd) granularity.
