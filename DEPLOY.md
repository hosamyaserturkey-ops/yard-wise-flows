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
assets from `./dist`, SPA fallback), which also stops Wrangler from trying to
auto-configure the framework (that path requires Vite 6+; this project is on
Vite 5).

Cloudflare project settings (Workers Builds):
- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Production branch:** `main`

Every push to `main` builds and deploys. SPA routing (serving `index.html` for
client-side routes like `/gate-in`) is handled by
`not_found_handling: "single-page-application"` in `wrangler.jsonc`.

> Note: do **not** add a `public/_redirects` file for the Workers deploy — the
> Workers asset validator rejects the SPA rule `/*  /index.html  200` as an
> infinite loop. `not_found_handling` in `wrangler.jsonc` is the Workers-native
> equivalent and is all that's needed.

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

- **Auth → Providers/Policies:** enable **leaked-password protection**.
- Confirm every table has Row-Level Security enabled (run the security advisor in
  the Supabase dashboard after any schema change).

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
   (proves the SPA rewrite).
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
