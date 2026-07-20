# CLAUDE.md — CMI Project Rules

## Deployment rules (CRITICAL)

- **There is exactly one deployed environment: production.** Vercel project `cmi-notebooks` → https://cmi-notebooks.vercel.app
- **`main` is the only branch that deploys.** Merging `develop` → `main` ships to production immediately.
- **No branch other than `main` triggers a Vercel deployment.** `develop`, `feature/*`, `fix/*` and `hotfix/*` are all disabled in `vercel.json`. Never push a branch expecting a preview URL — there isn't one.
- Because there is no staging environment, **`main` is the blast radius.** Always ask before merging to `main`.

## Git workflow

- Branch from `develop`, not `main`
- Branch naming: `feature/<issue-id>-<slug>`, `fix/<issue-id>-<slug>`
- PR flow: `feature/*` → `develop` → `main`
- Commit and push to `develop` without asking — it deploys nothing, so it is safe by construction
- **Always ask before merging to `main`** — that merge is the production release

## Pre-merge verification

`develop` has no deploy target, so verification happens locally and in CI, not on a URL:

- `npm test` and `npm run build` must both pass before a `develop` → `main` PR
- Exercise changed API routes against `npm run dev` on localhost
- After merging to `main`, smoke-test https://cmi-notebooks.vercel.app before considering the release done

## URL

- **Prod**: https://cmi-notebooks.vercel.app

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, Recharts, Zod, Vitest
- Stateless (no database), localStorage for scenario persistence
- Strategy engine: HF AI → OpenAI fallback → heuristic fallback
- Rate limiting: in-memory per-IP/per-user buckets

## Testing

- Run `npm test` before every commit
- Run `npm run build` to verify type safety
- All tests must pass before pushing
