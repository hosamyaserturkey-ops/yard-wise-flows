# Multi-Yard (Multi-Tenant) Architecture

Convert the app so each yard is an isolated tenant with its own admin, users, containers, bookings, port data, payments, and accounting. A platform super-admin sits above all yards.

## Roles

- **super_admin** — you. Creates yards, creates the first admin of each yard, can view/manage anything across all yards. Not bound to a single yard.
- **admin** (yard admin) — manages users and all data inside one yard. Can create yard users, edit/delete any record in their yard.
- **user** — operator inside one yard. Standard gate-in / gate-out / bookings work, scoped to their yard.

Each non-super user belongs to exactly **one** yard.

## Existing data

Wipe: all containers, bookings, container_port_data, demurrage_payments, shipping_line_transfers, edi_transmissions, all profiles/user_roles, and all auth users. Start clean. After migration we re-create one super-admin account.

## Database changes

New table:
- `yards` — `id`, `name`, `code` (short unique slug), `created_by`, `created_at`

Extend enum `app_role` with `super_admin`.

Add `yard_id uuid references yards(id)` to:
- `profiles` (nullable — super_admin has no yard)
- `containers`, `bookings`, `container_port_data`, `demurrage_payments`, `shipping_line_transfers`, `edi_transmissions` (NOT NULL)

New helper functions (SECURITY DEFINER, search_path=public):
- `is_super_admin(uid)`
- `current_yard_id()` — returns the caller's `profiles.yard_id`
- `is_yard_admin(uid, yard_id)` — true if user is admin of that yard

### RLS pattern (applied to every data table)

- **SELECT**: `is_super_admin(auth.uid()) OR yard_id = current_yard_id()`
- **INSERT**: `yard_id = current_yard_id() AND created_by = auth.uid()` (super-admin can insert anywhere)
- **UPDATE**: `is_super_admin(...) OR (yard_id = current_yard_id() AND (owner OR is_yard_admin(...)))`
- **DELETE**: `is_super_admin(...) OR is_yard_admin(auth.uid(), yard_id)`

`yards` table:
- SELECT: super_admin sees all; everyone else sees only their own yard.
- INSERT/UPDATE/DELETE: super_admin only.

`profiles` and `user_roles`:
- super_admin: full access.
- yard admin: can view/update/delete profiles and user_roles for users whose `profiles.yard_id` matches theirs (cannot promote to super_admin).
- user: own row only.

`handle_new_user` trigger reads `raw_user_meta_data.yard_id` and `raw_user_meta_data.role` (defaults to 'user') to provision the new profile + user_roles row in one shot. The `prevent_role_change` trigger stays in place.

## Frontend changes

- **AuthContext**: load `profile.yard_id`, `profile.yard_name`, `role` (`super_admin | admin | user`). Expose `isSuperAdmin()`, `isAdmin()`, `currentYardId`.
- **Layout header**: show current yard name next to the user. Super-admin sees "All Yards" plus a yard switcher dropdown that filters their view.
- **Routing / nav**:
  - Super-admin only: `/admin/yards` (create yards, list yards, create yard's first admin).
  - Yard admin: existing admin pages (Import, Port Data, Accounting, Users) — scoped to their yard automatically by RLS.
  - User: existing operator pages.
- **Auth page**: remove public sign-up. Login only. Account creation is done by super-admin (creates yard admins) and yard admins (create users in their yard).
- **New page `Yards` (super-admin)**: create yard (name + code), list yards, "Create yard admin" button (username, password, full name → calls signup with `yard_id` + role=admin in metadata).
- **UserManagement**: yard admins see only users in their yard, and the "Create user" form auto-assigns the new user to their yard. Super-admin sees everyone.
- **All data queries** stay the same — RLS does the filtering. We just remove any client-side role checks that don't account for super_admin and add `yard_id` to all `INSERT` payloads.

## Out of scope (this pass)

- Per-yard branding / theming.
- Cross-yard reporting dashboards for super-admin (basic list only for now).
- Billing / subscription per yard.

## Order of execution

1. SQL migration (wipe + schema + RLS + trigger update).
2. Update `AuthContext`, `ProtectedRoute`, `Layout` for super_admin + yard awareness.
3. Add `Yards` page + super-admin nav.
4. Update `UserManagement` for yard-scoped user creation.
5. Update every data-insert call site to include `yard_id`.
6. Remove sign-up UI from `Auth` page.
7. Manually create the first super-admin account (instructions provided).
