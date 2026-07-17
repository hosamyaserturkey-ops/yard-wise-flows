## Migrating to a new Supabase account

Short answer: **very doable, roughly 30–60 minutes of careful work**, but it's not a one-click operation. Below is what's involved and the plan I'd follow.

### What has to move

1. **Database schema + data** — all tables (`profiles`, `user_roles`, `yards`, `containers`, `container_visits`, `bookings`, `activity_log`, `demurrage_payments`, `shipping_lines`, `shipping_line_transfers`, `inspector_checks`, `container_port_data`, `edi_transmissions`), enums (`app_role`), functions (`handle_new_user`, `has_role`, `is_super_admin`, `is_yard_admin`, `current_yard_id`, etc.), triggers, RLS policies, GRANTs.
2. **Auth users** — every account in `auth.users` (evladmin, superadmin, test, and any others), with password hashes preserved so people don't need password resets.
3. **Storage buckets + files** — `inspection-photos` and `transfer-receipts` (private buckets), plus every object inside them.
4. **Edge functions** — `create-user` (and any others), redeployed to the new project.
5. **Edge function secrets** — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `SUPABASE_DB_URL`, and the JWKS/publishable/secret key bundles.
6. **Project config** — the Lovable ↔ Supabase connection, the `.env` values (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`), the hardcoded values in `src/integrations/supabase/client.ts`, and `supabase/config.toml`.
7. **GitHub backup workflow** — the `SUPABASE_DB_URL` repo secret used by `.github/workflows/backup.yml`.

### Difficulty breakdown

| Piece | Difficulty | Notes |
|---|---|---|
| Schema + data | Easy | `pg_dump` from old, `psql` restore to new. We already have a daily backup workflow producing exactly the right dump. |
| Auth users w/ password hashes | Medium | Must dump `auth.users` + `auth.identities` rows directly (Supabase's UI export doesn't include hashes). Done via SQL. Users keep their passwords. |
| Storage files | Medium | Not in `pg_dump`. Requires a small script that lists objects in each bucket on the old project and re-uploads to the new one using the service role key. |
| Edge functions | Easy | Redeploy from `supabase/functions/`. Automatic once the new project is connected. |
| Reconnect Lovable → new Supabase | Easy | Disconnect current project, connect the new one. `.env` and the generated `types.ts` refresh automatically. |
| Hardcoded URL/key in `client.ts` | Trivial | One-line edit after reconnection. |

### Plan of attack (once you've created the new Supabase project)

1. **Snapshot the current DB** — run the existing GitHub `backup` workflow (or `pg_dump` locally) to get a fresh `.sql.gz` including `auth`, `storage`, and `public` schemas.
2. **Restore into the new project** via `psql "$NEW_DB_URL" < backup.sql`. Confirm row counts match for each table and `auth.users` count matches.
3. **Copy storage objects** with a short Node/Deno script: list objects in `inspection-photos` and `transfer-receipts` on the old project (service role), download, re-upload to the same paths on the new project. Recreate the buckets first as private.
4. **Disconnect old Supabase in Lovable, connect the new one.** This updates `.env`, `client.ts` constants, and regenerates `src/integrations/supabase/types.ts`.
5. **Redeploy edge functions** (automatic on connect) and re-add any custom secrets that aren't auto-populated.
6. **Update `.github/workflows/backup.yml` secret** (`SUPABASE_DB_URL`) to point at the new database.
7. **Smoke test**: sign in as evladmin, load Dashboard, Gate In, Photo Archive (signed URLs from storage), create-user edge function, activity log inserts.
8. **Keep the old project read-only for 1–2 weeks** as a fallback, then delete.

### Risks / gotchas

- **JWT secret differs between projects**, so any active browser sessions get invalidated — every user signs in again once. Passwords still work.
- **Storage object paths must be preserved exactly** or signed-URL resolution in `src/lib/storage.ts` breaks.
- **Realtime publications** (`supabase_realtime`) aren't in `pg_dump` — must be re-added by migration if the app uses them.
- **Extensions** (`pgcrypto`, `pg_net`, etc.) must be enabled on the new project before restore.
- **Downtime window**: while copying storage and reconnecting, users should stay logged out; plan a short maintenance window.

### What I need from you to actually do it

1. Confirm you want me to proceed (this is a "move", not a "copy"; the app will point at the new project when done).
2. The **new project's ref, URL, anon key, service role key, and DB connection string** — or connect it in Lovable's Supabase panel first and I'll pick them up automatically.
3. A green light on the maintenance window (roughly 30–60 min where users may be logged out and gate operations paused).
