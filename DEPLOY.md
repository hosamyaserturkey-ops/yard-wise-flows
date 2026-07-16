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
`wrangler.jsonc` at the repo root configures this (worker name `everest-depot`,
assets from `./dist`, SPA fallback), which also stops Wrangler from trying to
auto-configure the framework (that path requires Vite 6+; this project is on
Vite 5).

Cloudflare project settings (Workers Builds):
- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Production branch:** `main`

Every push to `main` builds and deploys. SPA routing is handled two ways (both
harmless together): `not_found_handling: "single-page-application"` in
`wrangler.jsonc`, and `public/_redirects` for Pages-style hosts.

> Prefer Cloudflare **Pages** instead of Workers? Create a Pages project via
> **Workers & Pages → Create → Pages → Connect to Git**, build `npm run build`,
> output `dist`. Pages serves `dist/` directly and honors `public/_redirects` —
> no `wrangler deploy` step and no Vite-version issue.

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

## 5. Smoke test (go-live checklist)

1. Open the deployed site; log in.
2. Visit `/gate-in` **directly** in the address bar — should load, not 404
   (proves the SPA rewrite).
3. Gate a test container in and out; collect demurrage; print and reprint a
   receipt.
4. Confirm HTTPS on the custom domain.
5. Run the backup workflow once by hand; confirm the artifact restores.

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
