# Car lot: Phase 0 review (checkpoint)

**Status:** discovery and review only. Nothing was applied to production or anywhere else on Supabase, and no branch was created. All reads of production were `SELECT`s against the catalog (schema, policies, functions, counts). No row data left the database.

Files in `docs/car-lot/`:

| File | What it is |
|---|---|
| `car-lot-plan-for-claude-code.md` | the plan, as provided |
| `car-lot-part1-enum.sql` | part 1, as provided (unchanged, it is fine) |
| `car-lot-part2-schema.sql` | part 2, **revision 2** (first commit of this PR has revision 1, so `git diff` shows every change) |
| `car-lot-rollback.sql` | new: tested rollback of part 2 |
| `tests/` | the local test harness used for this review, and the RLS matrix for staging |

They are deliberately **not** in `supabase/migrations/`, so nothing can apply them by accident.

---

## 0. Urgent, and not caused by the car lot: anyone can create a super-admin account

- Production's auth settings: **sign-up is enabled** (`disable_signup: false`) and **e-mail auto-confirm is on**.
- `public.handle_new_user()` (trigger on `auth.users`) copies `role` and `yard_id` from the sign-up metadata into `profiles` and `user_roles`.
- The publishable key is in the website bundle, so anyone can call `POST /auth/v1/signup` with `data: {"role": "super_admin"}` and get full access to every yard.

Not exploited as far as the data shows: all 13 accounts have app-style e-mails and usernames, and none was created in the last 30 days. I did **not** try it on production, because that would create a real account.

**Fix now (no code change, no effect on current users):** Supabase Dashboard → Authentication → Sign In / Providers → turn **off** "Allow new users to sign up". The app never self-signs-up: users are created by the `create-user` Edge Function with the service role, which keeps working with sign-up off. The car-lot plan already requires "sign-up must not be open".

**Follow-up (separate change):** have `create-user` pass `role`/`yard_id` in `app_metadata` (only the service role can set it) and make `handle_new_user` read that instead of `raw_user_meta_data`.

---

## 1. "Will it mess up the container yard's data?"

**Revision 2 changes no existing row and drops or edits no existing policy, function or trigger.** What it adds to existing objects:

| Existing object | Added | Effect on container yard |
|---|---|---|
| `yards` | column `kind` (default `'container'`, metadata-only), 1 new row `evl-cars` | existing row unchanged (verified by hash); owner's yard switcher shows a second yard |
| `profiles` | column `manufacturer_id` (NULL for everyone), check `manufacturer_id IS NULL OR yard_id IS NULL` (all rows pass), 1 trigger that only acts when `manufacturer_id` changes | none |
| enum `app_role` | value `manufacturer_rep` (part 1) | none in the database; see Phase 2 note on TypeScript types |
| 11 container tables + `storage.objects` | one RESTRICTIVE policy each, true for everyone except car-lot staff and manufacturer users | none (tested below) |

Car photos go to a new Cloudflare R2 bucket (decision B, §6), so part 2 creates no Supabase bucket.

**Tested** on a local replica of the production schema, filled with made-up container data (method in §5). Before vs after, on the same database:

- every pre-existing table's rows: identical, except the one new `yards` row;
- container admin, inspector, office user, line rep, anonymous: **identical** visible rows and **identical** results for 15 everyday actions (gate-in, gate-out, inspection, demurrage, booking, port data, photo and receipt upload, admin RPCs);
- owner: sees the extra yard, nothing else changes.

Revision 1 also passed this "today" check. Its problems were about what **new car-lot users** could do to container data afterwards (§2).

---

## 2. Review of the draft (revision 1) and what revision 2 changes

The design is sound: manufacturer isolation, immutable photos, closed inspections and storage path checks all held under test. Revision 1 passed 72 of 86 matrix checks; **revision 2 passes 88 of 88**, in all three orders relative to the pending migrations (§3). (89 before decision B; the Supabase-bucket checks were replaced by checks on the R2 upload key and photo rows.)

| # | Finding in revision 1 | Risk | Revision 2 |
|---|---|---|---|
| 1 | The fence covered only `containers`. `inspector_checks` INSERT is role-based with no yard check, so a **car-lot inspector could insert an *approved* inspection for any container**, and `has_approved_inspection_for_trip()` matches by container number across yards. Tested: allowed. | **High.** A container could then be gated in without a real inspection. | Fence on every container table: `containers`, `container_visits`, `inspector_checks`, `bookings`, `demurrage_payments`, `container_port_data`, `edi_transmissions`, `shipping_line_transfers`, `cash_counts`, `accounting_month_closes`, `shipping_lines`. |
| 2 | A **car-lot admin could open a `container_visits` row** on a real container (yard-admin rule, own yard). `container_visits_open_unique` allows one open visit per container across all yards. Tested: allowed. | **High.** Blocks that container's real gate-in. | Same fence. |
| 3 | Car-lot admin could create container bookings and demurrage payments in the car-lot yard. Tested: allowed. | Medium. Pollutes the owner's "All yards" totals. | Same fence. |
| 4 | Reverse direction: **container-yard admins and inspectors could create manufacturers and vehicles in the container yard** (`can_write_lot_row` checked "own yard", not "car-lot yard"). Tested: allowed. | Medium | Manufacturers must be in a `kind='vehicle'` yard (trigger), vehicles reference `(manufacturer_id, yard_id)` together (composite FK), and the write helpers only return a car-lot yard. |
| 5 | New SECURITY DEFINER helpers were created in `public`. Production's default privileges grant EXECUTE on new functions to **`anon`**, so anyone could call `is_manufacturer_rep(<any user>)` over the REST API. Tested: anon got `true`. | Medium (information leak, advisor lint 0028/0029) | All helpers are in schema `private` (not exposed by the API), with EXECUTE revoked from PUBLIC/anon. |
| 6 | A visit's `manufacturer_id`/`vehicle_id` could be changed by UPDATE (scope was only set on INSERT), and a vehicle with history could change manufacturer. | Medium: one wrong edit shows a car's history to another manufacturer | Visit scope pinned on UPDATE; vehicle manufacturer locked once it has visits. |
| 7 | "Block gate-out of an on-hold vehicle" (plan §5.5) was UI-only; a released visit could be reopened; `gated_out_by` was whatever the client sent. | Low/medium | Enforced by trigger; gate-out time and releasing user set by the server. |
| 8 | Section 10 drops and re-creates `profiles_update_self`. This conflicts with the pending repo migration (see §3). | Medium | No existing policy is touched. A trigger blocks `manufacturer_id` changes unless super admin or service role. |
| 9 | Manufacturer users could read `shipping_lines` (including tariffs). | Low | `shipping_lines` fenced too. |
| 10 | Policies called helpers once **per row**. | Performance | Helpers run once per query (`(select …)` InitPlan), as in the repo's own `20261011130000` migration. |
| 11 | Missing FK indexes, trigger function without fixed `search_path`. | Advisor warnings | Added / fixed. |
| 12 | Photo table `inspection_photos` vs the container bucket `inspection-photos` and its existing storage policies `inspection_photos_insert/select`. | Confusion later | Renamed `vehicle_inspection_photos`. |
| 13 | Rollback block: dropping `profiles.manufacturer_id` fails while the re-created policy depends on it; fences, `kind` and the yard row are not removed; and Supabase blocks deleting storage rows with SQL. | Rollback would fail half-way | `car-lot-rollback.sql`, tested: restores every container-yard row exactly, leaves nothing behind, and refuses to run once car-lot data exists. |
| 14 | Photos in a Supabase bucket: the Free plan's 1 GB holds about 100 cars. | Storage runs out | **Decision B: Cloudflare R2.** Supabase bucket and storage policies removed; `public.vehicle_photo_upload_prefix()` lets the Worker ask Postgres, as the user, whether they may add a photo (§4a). |

Smaller points kept as they were: `free_days` defaults to 7 instead of the manufacturer's `default_free_days` (Phase 3 accounting will set it), and the car-lot yard insert borrows the first super admin as `created_by` (inserts nothing on a fresh branch, so seed it there).

---

## 3. Production is three migrations behind the repo

Production's history ends at `20261008 forty_foot_is_high_cube`. These repo migrations are **not** applied:

- `20261011120000_lock_down_security_definer_functions`: moves `is_super_admin`, `current_yard_id`, `has_role`, … to schema `private`.
- `20261011130000_rls_initplan_fk_indexes_policy_merges`: rewrites the policies and **replaces `profiles_update_self`** with a merged `profiles_update`.
- `20261021120000_admin_delete_container`: the function exists on production, but in a hand-applied version (`search_path private, public`), and is not in the migration history.

Revision 1 conflicts with them in **both** orders (tested):

- car lot first: the lock-down migration **refuses to run** ("Still calling a moved helper through public: can_read_lot_row, can_write_lot_row");
- lock-down first: car lot part 2 **fails** ("function public.is_super_admin(uuid) does not exist").

Revision 2 calls those helpers without a schema under `search_path private, public`, and leaves the profiles policy alone, so it works in either order (88/88 in both).

The pending migrations themselves change one container-yard behaviour on purpose: inspectors and line reps can no longer call `increment_gated_out_containers`. That is documented in that migration. Applying them is a separate decision from the car lot.

---

## 4. Facts that change the plan

1. **Supabase branching needs the Pro plan; this organization is on Free.** Phase 1 step 1 can't be done as written. Options are in §6, decision A.
2. **Container inspection photos are not in the Supabase bucket any more.** `src/lib/photoUpload.ts` uploads them through the Worker (`worker/index.ts`, `/api/photos/*`) to Cloudflare R2. The Free plan has **1 GB** of Supabase Storage in total; about 12 shots × 2 phases × ~400 KB ≈ 10 MB per car fills it after roughly 100 cars. **Decided: car photos go to R2 too** (§4a).
3. **The Worker's R2 photo routes check role names only, not the yard.** Car-lot staff hold the same role names (`inspector`/`admin`/`user`), so they could upload into the container R2 bucket, and view or delete a container photo **if they knew its key**. Keys come only from `inspector_checks.photo_urls`, which the fence now hides from them. Phase 2: refuse vehicle-side users on those routes.
4. **`create-user` can't create manufacturer users yet.** It only accepts `admin|user|inspector|line_rep` and requires `yard_id`. Manufacturer accounts need a super-admin-only path that sets `profiles.manufacturer_id` with the service role. Decision 3 in the plan.
5. **The app would treat a manufacturer user as staff.** `AuthContext` maps unknown roles to `'user'`. RLS would still show them nothing, but the manufacturer portal and role handling must ship **before** the first manufacturer account is created.
6. **No i18n/RTL today.** `index.html` is `lang="en"`, and there is no i18n library or Arabic strings. Arabic is new work, not "follow the existing pattern" (plan decision 7).
7. **Activity log.** Reusing `gate_in`/`gate_out` for cars is fine per yard, but the owner's "All yards" activity view would mix car and container events. Filter by yard kind in the UI, or add `vehicle_gate_in`/`vehicle_gate_out` (separate migration).

### Stack and where Phase 2 changes go

React 18 + TypeScript + Vite, shadcn/ui + Tailwind, react-router v6 (`src/App.tsx` routes wrapped in `ProtectedRoute`), Supabase JS called directly from pages and hooks, roles/yard from `src/contexts/AuthContext.tsx` (`currentYardId()`; owner switches yard via `YardSwitcher`), tickets printed from `src/lib/gateInReceipt.ts`/`gateOutReceipt.ts` (HTML + `window.print()`), reports in `src/lib/reports/`, Cloudflare Worker in `worker/` (R2 photos, APM terminal check), Vitest. New routes must also be added to `worker/appRoutes.ts`.

Baseline checks on this branch (no app code changed): `npm run lint` 0 errors (12 existing warnings), `tsc --noEmit` clean, `npm test` 389/389 passed.

### 4a. Car photos in Cloudflare R2 (decision B): design for Phase 2

**Where:** a new private R2 bucket `vehicle-inspections`, separate from the container photos' R2 bucket `inspection-photos` (plan hard requirement 3). Its own Worker binding (`VEHICLE_PHOTOS_BUCKET`), so container routes physically can't reach car photos and the other way round. No public access: no r2.dev URL, no custom domain. Every read goes through the Worker.

**Key layout:** `{manufacturer_id}/{vehicle_id}/{inspection_id}/{random uuid}.jpg`, the same layout the draft used. Random names mean nothing is ever overwritten.

**Who decides:** Postgres. The Worker already calls Supabase with the user's own login (`worker/index.ts`, `authorize()`), so every check below is the same RLS that the matrix tests.

| Step | Worker route | What happens |
|---|---|---|
| upload | `POST /api/vehicle-photos/upload?inspection=…&angle=…` | 1. Reject anything but JPEG/PNG/WebP/HEIC over 5 MB. 2. Call `rpc/vehicle_photo_upload_prefix` as the user: refused unless they are owner or lot admin/inspector and the inspection is open. 3. Store the file at `<prefix><uuid>.jpg` and compute SHA-256 **in the Worker** (not trusted from the phone). 4. Insert the `vehicle_inspection_photos` row as the user (RLS and the guard trigger check everything again, including the key prefix). 5. If the insert fails (e.g. the inspection was closed meanwhile), delete the file. |
| view | `GET /api/vehicle-photos/view?id=<photo row id>` | Read that row as the user. RLS returns it only to the owner, staff of that lot, or that car's manufacturer. Only then stream the file. **The browser never sends an object key.** |
| delete | none | Photos are evidence (plan rule 6). |

**Also in Phase 2:** the existing container routes `/api/photos/*` must refuse car-lot staff and manufacturer users (finding 4.3).

**Setup when Phase 2 starts (not done, needs your Cloudflare login):** `npx wrangler r2 bucket create vehicle-inspections`, then add the binding to `wrangler.jsonc`. Do the binding in the same change as the Worker code: a deploy fails if it points at a bucket that doesn't exist. Retention (plan decision 5) can later become an R2 lifecycle rule.

**Cost:** R2 includes 10 GB free with no download charges, about 1,000 cars at ~10 MB each. After that it's about $0.015 per GB per month.

---

## 5. How this was tested

`tests/run-local.sh` builds a throwaway local PostgreSQL database from production's **schema only** (exported read-only with `tests/replica/export-schema.sql`), adds small stand-ins for Supabase's `auth` and `storage`, and fills it with made-up container-yard data. It then:

1. probes the container yard as 5 users + anon, applies part 1 and part 2, and probes again on the same database;
2. seeds car-lot fixtures (lot admin, lot inspector, lot office user, manufacturer A and B users, three cars, an open and a closed inspection, photos, one car on hold) and runs the 88-check matrix (`tests/rls-matrix.sql`) as real signed-in users, each check in a rolled-back subtransaction.

Results, revision 2:

| Order | Applies | Container yard | Matrix |
|---|---|---|---|
| car lot on today's production schema | yes | unchanged (only +1 yard row) | 88/88 |
| car lot, then the 3 pending migrations | yes | unchanged by car lot (*) | 88/88 |
| the 3 pending migrations, then car lot | yes | unchanged by car lot (*) | 88/88 |
| rollback right after applying | yes | every container-yard row identical to before; no car-lot function, policy or column left | n/a |

(*) The only differences in these runs come from the pending migration itself (the `increment_gated_out_containers` change), plus anon's "permission denied" message naming a different helper. Anon is refused before and after.

**Limits:** a local replica runs the Postgres side (RLS, triggers, storage policies, constraints) but not Supabase's HTTP layers (PostgREST, Storage API uploads and signed URLs, Auth), and not the security/performance advisors. Those need a real Supabase project (decision A).

---

## 6. Decisions needed before Phase 1

**A. Where to test on real Supabase.** Free allows 2 active projects, and this account already has 2 (Container Yard and Trucking; Bernisko and challenge-guardian are paused). Options:
- **Upgrade to Pro** ($25/month, plus branch compute while a branch exists): enables branching as the plan intends, and also brings daily backups and 100 GB storage, which DEPLOY.md already recommends. With photos in R2 (decision B), Pro is only needed for branching and backups.
- **Free staging project**: possible only after pausing one active project (e.g. Trucking, if nobody uses it during testing). Load the schema with `tests/replica/export-schema.sql`, apply part 1 and part 2, and run the matrix. $0.
- Local replica only (done): not enough on its own for production.

**B. Where vehicle photos live. DECIDED: Cloudflare R2**, a new private bucket `vehicle-inspections` behind the Worker, with Postgres deciding every upload and view (§4a). Part 2 already reflects this.

**C. Pending repo migrations.** Recommended: apply `20261011120000` and `20261011130000` to production **first, as their own change** (their deploy notes are in DEPLOY.md), and record `20261021120000` in the history. Revision 2 doesn't require it, but production and the repo should stop drifting before more migrations land.

**Plan §7 (unchanged, still open):**
1. Office role read-only? (current: read-only)
2. Owner = `super_admin` (can edit), or a read-only owner role?
3. Who creates manufacturer accounts, and how? (needs a `create-user` change, §4.4)
4. Billing rule (per car per day, handling/damage, currency, rounding)
5. Photo/visit retention
6. Liability wording for tickets and portal
7. Portal languages (Arabic is new work, §4.6)

## 7. Next steps once approved

1. You: turn off public sign-up (§0).
2. Decide A, B, C and plan §7.
3. Phase 1 on staging: apply part 1, then part 2, seed, run the matrix, run the Supabase security and performance advisors, and regenerate types.
4. Checkpoint with the results before anything touches production.
