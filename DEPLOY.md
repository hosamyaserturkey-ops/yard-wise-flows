# Deployment Runbook

How to run this app online as a low-cost daily-operations system.

**Architecture:** static React frontend (this repo, built with `npm run build`)
+ Supabase backend (Postgres, Auth, Storage, Realtime — already hosted). The
Supabase URL and public anon key are compiled into the build
(`src/integrations/supabase/client.ts`), so **the site connects to the backend
with no extra environment configuration on the host.** The anon key is safe to
expose — access is enforced by Supabase Row-Level Security.

Recommended host: **Cloudflare Pages** (free tier; pairs with Cloudflare R2 for
near-free image storage later). Vercel works identically — see the note at the
end.

---

## 1. Deploy the frontend to Cloudflare

This repo is set up to deploy as a **Cloudflare Worker with static assets** — the
build command produces `dist/` and `npx wrangler deploy` serves it. The
`wrangler.jsonc` at the repo root configures this (worker name `everest-container-terminal`,
assets from `./dist`, the Worker in `worker/`), which also stops Wrangler from trying to
auto-configure the framework (that path requires Vite 6+; this project is on
Vite 5).

Cloudflare project settings (Workers Builds):
- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Production branch:** `main`

Every push to `main` builds and deploys. Client-side routes like `/gate-in`
are served by the Worker: any path that isn't a file in `dist/` reaches it
(`not_found_handling: "none"` in `wrangler.jsonc`), and it answers with
`index.html` — status 200 for the routes listed in `worker/appRoutes.ts`, 404
with `X-Robots-Tag: noindex` for anything else. **When you add a route to
`src/App.tsx`, add it to `worker/appRoutes.ts` too** (a test fails until you
do; a missed route still works in the browser, it just answers 404).

Response headers (Content-Security-Policy, HSTS, caching) live in
`public/_headers`. If the app starts loading anything from a new domain, add
that domain to the CSP there.

> Note: do **not** add a `public/_redirects` file for the Workers deploy — the
> Workers asset validator rejects the SPA rule `/*  /index.html  200` as an
> infinite loop, and the Worker already handles client-side routes.

> Prefer Cloudflare **Pages** instead of Workers? Create a Pages project via
> **Workers & Pages → Create → Pages → Connect to Git**, build `npm run build`,
> output `dist`. On Pages, SPA routing is configured with a `_redirects` file
> (`/*  /index.html  200`), which Pages accepts — no `wrangler deploy` step and
> no Vite-version issue.

## 2. Attach a custom (branded) domain

1. Buy a domain (~$10–15/yr) from Cloudflare Registrar or Namecheap.
2. In the Pages project → **Custom domains → Set up a custom domain** → enter your
   domain. Cloudflare provisions HTTPS automatically.
3. If the domain isn't on Cloudflare yet, follow the prompt to point its
   nameservers/DNS at Cloudflare.

## 3. Turn on the daily database backup (free-tier safety net)

The Supabase free tier has **no automated backups**. This repo includes a daily
backup workflow (`.github/workflows/backup.yml`) that `pg_dump`s the database and
stores the snapshot as a workflow artifact. To enable it:

1. In Supabase → **Project Settings → Database → Connection string**, copy the
   **Session pooler** URI (the `postgresql://...` string). Use the *Session*
   pooler, not the Transaction pooler — it's IPv4-compatible (GitHub runners are
   IPv4) and works with `pg_dump`.
2. In GitHub → repo **Settings → Secrets and variables → Actions → New repository
   secret**, name it `SUPABASE_DB_URL`, paste the URI.
3. The workflow runs daily on schedule. To test now: **Actions → Daily DB backup →
   Run workflow**, then download the artifact and confirm it restores.

> Move to **Supabase Pro ($25/mo)** for managed daily backups + point-in-time
> recovery once you run multiple busy yards or want to drop the DIY backup.

## 4. Supabase security hardening (before real operations)

- **Leaked-password protection** (Authentication → Sign In / Providers → Email →
  "Prevent use of leaked passwords") is a **Pro plan** feature; it can't be
  turned on while the project is on the free plan. Until then, set a minimum
  password length of at least 10 and require letters and digits on the same
  page, matching what the user-management screens already enforce.
- Confirm every table has Row-Level Security enabled (run the security advisor in
  the Supabase dashboard after any schema change).
- The RLS helper functions (`is_super_admin`, `is_yard_admin`, `has_role`, …)
  live in the `private` schema, which the Data API doesn't expose. Anything
  outside the database that needs a user's role reads `user_roles` /
  `profiles` instead of calling them over REST.

### Deploy order for migrations that move or rename API functions

When a migration removes a function that the Worker or an Edge Function calls
(for example `20261011120000_lock_down_security_definer_functions.sql`), ship the
callers first so nothing is ever pointing at a missing function:

1. Merge to `main` — Cloudflare deploys the new frontend and Worker.
2. Deploy the Edge Functions:
   `npx supabase functions deploy create-user reset-user-password --project-ref qctvjwlaxnidprhcxodj`
3. Apply the migration the way earlier ones were applied (Supabase MCP
   `apply_migration`, or paste the file into the SQL editor). Don't use
   `supabase db push`: the early migration files here carry different version
   numbers from the project's migration history, so it would try to re-run
   them.
4. Re-run the security and performance advisors.

### New-user access comes from app_metadata (`20261109120000`)

`handle_new_user` (the trigger that writes a new account's `profiles` and
`user_roles` rows) used to read `role`, `yard_id` and `shipping_line` from
user_metadata. user_metadata is the `data` field of the public sign-up
endpoint, so with sign-up enabled anyone holding the publishable key could
register as `super_admin`. Now the `create-user` Edge Function puts those keys
in app_metadata (only the service role can write it), and the trigger reads
them from there alone. A public sign-up becomes a plain `user` with no yard,
whatever it sends.

1. Deploy the Edge Function. The function is now two files (`index.ts`
   imports `metadata.ts`); the CLI bundles both:
   `npx supabase functions deploy create-user --project-ref qctvjwlaxnidprhcxodj`
   (If you deploy through the dashboard or the Supabase MCP instead, upload
   both files.)
2. Apply `20261109120000_new_user_access_from_app_metadata.sql` right after,
   the same way as above.
3. Check it: run `supabase/checks/new_user_access.sql` in the SQL editor. It
   replays a public sign-up asking for `super_admin` and the Edge Function's
   admin create inside a transaction, then rolls everything back. It ends
   with "new-user access: all checks passed" or stops at the first wrong
   result. Then create a throwaway inspector from User Management, check the
   role and yard it shows, and delete it.

Don't create users between steps 1 and 2. In that gap the function and the
trigger disagree on where access lives, and a user created then comes out
as a plain `user` with no yard (less access, never more). Delete and
re-create any such user once step 2 is done. Existing users are not touched.

Why there are two triggers: the Auth server's admin `createUser` inserts the
`auth.users` row without the caller's app_metadata and merges it in with an
UPDATE later in the same transaction. So `on_auth_user_created` provisions a
plain `user`, and `on_auth_user_app_metadata_set` re-provisions from the
merged app_metadata. The second one only acts on a user created in the same
transaction, so editing an existing user's app_metadata changes nothing.
Roles are still managed in `user_roles` after creation.

Keep **Authentication → Sign In / Providers → "Allow new users to sign up"
off**. The app never uses public sign-up: staff accounts come from the
`create-user` Edge Function, which works with sign-up disabled. This change
stops a sign-up from choosing its own role, but a signed-up account is still
a signed-in `user` with no yard. The next two sections cover what that
account can still reach.

### Containers are staff-only (`20261109200000`)

`containers` is the master list of boxes, shared by every yard (gate-in at
any yard finds a box there and updates its type and line). Its policies only
asked "signed in and not a line rep", so any signed-in account, including a
public sign-up with no yard, could list, add and edit every yard's
containers. `containers_staff_only` is a restrictive policy on top of the
others: the caller must be a super admin or have a yard. Nothing changes for
staff (every production account had a yard on 2026-11-09).

No Edge Function or app change is involved, so apply the migration on its
own, then run `supabase/checks/containers_staff_only.sql` in the SQL editor.
It plays a yard-less sign-up, gate staff and a yard-less super admin against
`containers` as the `authenticated` role, and rolls everything back.

It works whether the RLS helpers are still in `public` or have moved to
`private`. `20261011120000` moving them later doesn't affect it, and
`20261011130000` rewriting the other `containers` policies doesn't remove it.

### Containers scoped to the caller's yard (`20261109130000`)

`containers_staff_only` keeps out accounts with no yard, but anyone with a
yard still reads and writes every yard's containers. A box belongs to a yard
through its visits, inspections and port-list entries there (`containers`
has no `yard_id`), and this migration scopes the permissive policies to
that.

Now a super admin reaches every container, and anyone else needs a yard on
their profile and a role in `user_roles` (`admin`, `user`, `inspector` to read
and write; `line_rep` to read their own line). They see the containers with a
visit, an inspection or a port-list entry in their yard, plus a master row
whose gate-in hasn't inserted its visit yet. An account with no yard, or no
role, gets no containers. The same migration stops an account from
re-creating a deleted profile row inside a yard (`profiles_insert_self`).
`containers_staff_only` stays as an outer gate; with both in place the
result is what this migration allows.

Every other table already gave a yard-less `user` nothing but
`shipping_lines` (read) and their own `profiles` / `user_roles` row; the
check below proves it table by table.

No frontend or Edge Function deploy is needed, and it works with the RLS
helpers in `public` or `private` (production has had them in `private` since
`20261011120000` and `20261011130000` were applied on 2026-11-09). Either
order with `20261109200000` works:

1. Apply `20261109130000_scope_containers_to_caller_yard.sql` the same way as
   above.
2. Check it: run `supabase/checks/yard_scoped_access.sql` in the SQL editor.
   It builds two throwaway yards with accounts and containers in a
   transaction, acts as each account the way the API does, and rolls back
   (its gate visits use negative ticket numbers, so real tickets keep
   counting from where they are). It ends with "yard-scoped access: all
   checks passed" or stops at the first wrong result.
3. As a gate operator, open Gate In, Yard Map and the dashboard: the counts
   should not change, since every container today is in the one yard.

One thing to know once there is a second yard: an admin gating in, with no
inspection and no port-list entry in their yard, a box that has only ever
been in the other yard won't see its existing record, and Gate In stops with
a duplicate-number error. Inspect the box (or put it on the port list) first.

With both migrations applied and their checks passing, a signed-up account
reaches only `shipping_lines` and its own profile, and since
`20261011120000` the RLS helpers are no longer callable over `/rest/v1/rpc`.
The app still has no use for public sign-up, so leaving it off remains the
safer setting.

## 5. Terminal empty-return check (APM Terminals API)

**Terminal Check** (`/terminal-check`, in the sidebar) asks APM Terminals
whether a container's empty return is still open at a terminal — the closest
that API comes to "has this box been handed back yet?". It is a page of its
own: a read-only lookup that writes nothing and that no gate-in, gate-out or
demurrage step depends on, so the existing yard workflow is untouched whether
or not the API is configured or reachable. The call runs in the Worker
(`/api/terminal/empty-returns`), so the API credentials never reach the
browser and the terminal's CORS policy never applies.

**What it can and cannot tell you.** Empty Container Returns reports whether a
facility currently *accepts* an empty back, not gate events. An open return
means the container has not been returned there yet; no record means the
terminal said nothing about it (it may already be back, or the facility may
not handle that box). A definitive "gated in at 14:20" needs a different APM
product (Track & Trace / container tracking), which can be added behind the
same route later.

**Production (default).** `wrangler.jsonc` points at
`https://api.apmterminals.com` with `APM_DEFAULT_FACILITY: "JOAQJ"` (ACT
Aqaba). That leaves one thing to do by hand — production refuses
unauthenticated calls, so the check reports "unavailable" until the
credentials are in place:

1. Register the app at <https://developer.apmterminals.com> and accept a plan
   covering Empty Container Returns to get a Consumer Key and Secret.
2. Store them as **Worker secrets**, never in the repo. In the Cloudflare
   dashboard: **Workers & Pages → everest-container-terminal → Settings →
   Variables and Secrets**, added as type *Secret*. Or from a checkout:

   ```
   npx wrangler secret put APM_CLIENT_ID       # Consumer Key
   npx wrangler secret put APM_CLIENT_SECRET   # Consumer Secret
   ```

   Secrets survive every deploy. The `vars` above do not — a deploy rewrites
   them from `wrangler.jsonc` — which is why the URL and facility belong in
   the repo and the credentials do not.

The Worker requests the OAuth 2.0 client-credentials token itself and reuses
it until it nears the 30-minute expiry.

**Back to the sandbox.** To test without credentials, point `APM_BASE_URL` at
`https://api-sandbox.apmterminals.com` and `APM_DEFAULT_FACILITY` at `SEGOT`.
It answers unauthenticated, with test data for `MRKU7137914`, `MRKU0562064`,
`UACU8175070` and `CXRU1082246` only. Leave `APM_BASE_URL` empty and the route
answers 503 and the page reports the check as unavailable.

## 6. Smoke test (go-live checklist)

1. Open the deployed site; log in.
2. Visit `/gate-in` **directly** in the address bar — should load, not 404
   (proves the client-side routing). A made-up path such as `/nope` should show
   the "Page not found" screen with HTTP status 404.
3. Gate a test container in and out; collect demurrage; print and reprint a
   receipt.
4. On `/terminal-check`, enter a container currently out for return, leave the
   facility field blank (that is `JOAQJ`) and press **Check terminal** — the
   result should report what ACT Aqaba says, not an "unavailable" error. An
   "unavailable" here usually means the two API secrets are not set.
5. Confirm HTTPS on the custom domain.
6. Run the backup workflow once by hand; confirm the artifact restores.

---

## Cost summary

| Piece | Cost |
|---|---|
| Cloudflare Pages (frontend) | Free |
| Supabase (backend) | Free tier, or $25/mo Pro for managed backups |
| Domain | ~$12/yr |
| Photos (later, Cloudflare R2) | Free up to 10 GB, zero egress |

**≈ $1/month** on the free path (just the domain), with the daily backup job as
the safety net.

---

## Vercel alternative

If you prefer Vercel instead of Cloudflare Pages: import the repo, framework
preset **Vite**, build `npm run build`, output `dist`. Vercel ignores
`_redirects`; add a `vercel.json` at the repo root instead:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```
