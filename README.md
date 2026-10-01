# Container Yard

Gate-in, gate-out, demurrage collection, bookings and accounting for
multi-yard container depots, in one workspace.

## Stack

- React 18 + TypeScript, built with Vite
- shadcn/ui (Radix UI) and Tailwind CSS
- Supabase: Postgres, Auth, Storage and Edge Functions (`supabase/`)
- Vitest for unit tests

## Local development

Requires Node.js 20 (the version CI uses) and npm.

```sh
npm install
npm run dev      # http://localhost:8080
```

The Supabase URL and publishable key are read from `.env`.

## Checks

```sh
npm run lint
npm test
npm run build
```

## Deployment

The frontend deploys to Cloudflare on every push to `main`, and the database is
backed up daily by a GitHub workflow. See [DEPLOY.md](DEPLOY.md).
