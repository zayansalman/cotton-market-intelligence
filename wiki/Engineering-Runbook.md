# Engineering Runbook (IDE-Agnostic)

This is the single source of truth for how to continue development from any IDE or machine.

## 1) Scope and objectives

Use this runbook to:
- onboard quickly in any environment
- follow the expected branch and release flow
- understand CI/CD behavior
- deploy safely to Vercel production
- recover fast if a deployment fails

## 2) Tooling baseline

- Runtime: Node.js 20
- Package manager: npm
- Framework: Next.js (App Router)
- Hosting: Vercel
- CI/CD: GitHub Actions

## 3) Local setup (any IDE)

```bash
git clone <repo-url>
cd cmi-notebooks
npm ci
cp .env.example .env.local  # if .env.example exists; otherwise create .env.local manually
npm run dev
```

Open `http://localhost:3000`.

If no AI keys are configured, strategy generation still works via deterministic fallback logic.

## 4) Branching and PR policy

Branch model:
- `main`: production only, and the only branch that deploys
- `develop`: code-only integration branch, deploys nothing
- `feature/*`: issue-driven implementation branches

Required flow:
1. Create or select a GitHub issue.
2. Branch from `develop` using:
   - `feature/<issue-id>-<short-slug>`
3. Open PR to `develop` and link the issue (`Closes #<id>` or `Refs #<id>`).
4. Merge `develop` -> `main` only through release PRs.

## 5) CI behavior (GitHub Actions)

Workflow: `.github/workflows/ci.yml`

Triggered on:
- push
- pull_request

CI job does:
1. checkout
2. setup Node 20 with npm cache
3. `npm ci`
4. `npm run build`

Success criteria:
- build passes (type and compile-safe for app + API routes)

## 6) CD behavior (single Vercel lane)

There is exactly one deployed environment. The separate dev Vercel project has been retired and deleted, and `.github/workflows/deploy-dev.yml` has been removed — only `deploy-prod.yml` remains.

### Prod lane (the only lane)
- Workflow: `.github/workflows/deploy-prod.yml`
- Trigger: push to `main` (or manual dispatch with ref)
- GitHub environment: `production`
- Vercel project: `cmi-notebooks`
- Vercel project secret used: `VERCEL_PROJECT_ID_PROD`
- URL: `https://cmi-notebooks.vercel.app`

The deploy workflow:
1. validates required Vercel secrets
2. installs dependencies
3. installs Vercel CLI
4. `vercel pull`
5. `vercel build --prod`
6. `vercel deploy --prebuilt --prod`

### Branches that deploy nothing

`vercel.json` sets `git.deploymentEnabled` to `true` for `main` only; `develop`, `feature/*`, `fix/*`, and `hotfix/*` are all `false`. `main` is the only branch that triggers a Vercel deployment.

**DO NOT push any branch other than `main` expecting a deployment.** The correct flow is:
1. Work on `feature/*` branch
2. Merge into `develop` (integration only — nothing deploys)
3. Verify locally and in CI: `npm test` and `npm run build` must pass, and changed API routes must be exercised against `localhost` via `npm run dev`
4. Open a `develop` -> `main` release PR, get explicit human approval, then merge to ship to production
5. Smoke-test `https://cmi-notebooks.vercel.app` after the release lands

Because there is no staging environment, `main` is the blast radius. The `develop` -> `main` merge requires explicit human approval.

## 7) Required secrets and where they live

GitHub repository secrets:
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_PROD`
- `HF_REVIEW_TOKEN` (AI PR review workflow only — deliberately separate from the runtime analyst token, so the two rotate independently)

`VERCEL_PROJECT_ID_DEV` was deleted along with the retired dev project. A stale `HF_TOKEN`
repository secret was also deleted — no workflow consumed it; `ai-review.yml` reads
`HF_REVIEW_TOKEN`. The runtime `HF_TOKEN` belongs on Vercel, not in GitHub secrets.

If the deploy workflow skips with a warning about invalid `VERCEL_TOKEN`, rotate the token in GitHub secrets and re-run the workflow.

Vercel env vars (set on the single `cmi-notebooks` project):
- `HF_TOKEN` (if strategy path depends on Hugging Face)
- `HF_STRATEGY_MODEL` (optional override)
- `STRATEGY_MODEL_PROVIDER` (`auto` / `huggingface` / `heuristic`)
- `FRED_API_KEY` (optional macro factor data)
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional forecast-history tracking)
- Rate limiting vars per endpoint (see endpoint keys below):
  - `RATE_LIMIT_<ENDPOINT>_WINDOW_MS`
  - `RATE_LIMIT_<ENDPOINT>_MAX_REQUESTS`
  - `RATE_LIMIT_<ENDPOINT>_BURST_WINDOW_MS`
  - `RATE_LIMIT_<ENDPOINT>_BURST_MAX`
  - `RATE_LIMIT_<ENDPOINT>_COOLDOWN_MS`

Endpoint keys:
- `strategy`
- `prediction`
- `pipeline`
- `backtest`
- `headlines`
- `prices`
- `landed_cost`

Recommended production rate limit defaults:
- `strategy`: 20 req / 60s, burst 5 / 10s, cooldown 60s
- `prediction`: 20 req / 60s, burst 5 / 10s, cooldown 60s
- `pipeline`: 20 req / 60s, burst 5 / 10s, cooldown 60s
- `backtest`: 20 req / 60s, burst 5 / 10s, cooldown 60s
- `headlines`: 90 req / 60s, burst 20 / 10s, cooldown 20s
- `prices`: 90 req / 60s, burst 20 / 10s, cooldown 20s
- `landed_cost`: 90 req / 60s, burst 20 / 10s, cooldown 20s

Rule: never commit secrets to git.

## 8) Release process (recommended)

1. Feature branches merge into `develop`.
2. Verify locally and in CI — `npm test` and `npm run build` must pass before the release PR.
3. Exercise changed API routes against `localhost` via `npm run dev`.
4. Open release PR: `develop` -> `main`.
5. Get explicit human approval for the production release (merging to `main` ships straight to prod).
6. Merge to `main` to trigger prod deploy.
7. Smoke test production:
   - homepage load
   - `/api/prices` returns data
   - `/api/headlines` returns data
   - `/api/prediction?horizon=21d` returns a forecast with truthful model metadata
   - `/api/strategy` returns valid response

## 9) Rollback playbook

If production breaks:
1. Identify last known good commit SHA on `main`.
2. Run `Deploy Prod (Vercel)` using workflow dispatch and set `ref` to that SHA.
3. Re-run production smoke checks.
4. Open incident issue with root cause and preventive action.

## 10) Continue-from-anywhere checklist

When switching IDE/laptop/teammate:
1. Pull latest `develop`.
2. Read:
   - `README.md`
   - `wiki/Enterprise-DLC.md`
   - `wiki/Engineering-Runbook.md` (this file)
3. Confirm current release status:
   - latest `develop` PRs
   - latest successful `deploy-prod` run
4. Confirm env access:
   - GitHub secrets present
   - Vercel env vars present on the `cmi-notebooks` project
5. Resume from issue-linked feature branch naming convention.

## 11) Ownership updates

When process changes:
- update this runbook in the same PR as workflow/config changes
- add a short "why changed" note in PR description
- keep branch/deploy policy docs synchronized with:
  - `README.md`
  - `wiki/Enterprise-DLC.md`
  - this runbook

## 12) Security controls and emergency playbook

### Abuse protection (all routes)

All API routes run `checkAbuse()` before rate limiting. Controls:

| Env var | Default | Purpose |
|---------|---------|---------|
| `ABUSE_PROTECTION_ENABLED` | `1` (on) | Set `0` to disable all checks |
| `API_KILL_SWITCH` | off | Set `1` to block ALL API traffic immediately |
| `ABUSE_IP_DENYLIST` | empty | Comma-separated IPs to always block |
| `ABUSE_IP_ALLOWLIST` | empty | Comma-separated IPs to always allow |
| `ABUSE_BLOCK_THRESHOLD` | `3` | Suspicion score above which requests are blocked |

### Usage quotas (strategy AI inference)

| Env var | Default | Purpose |
|---------|---------|---------|
| `QUOTA_AI_DAILY_PER_IP` | `50` | Max AI strategy calls per IP per day |
| `QUOTA_AI_MONTHLY_PER_IP` | `500` | Max AI strategy calls per IP per month |
| `QUOTA_AI_GLOBAL_DAILY` | `1000` | Max AI calls globally per day |
| `QUOTA_ALERT_THRESHOLD_PCT` | `80` | Log warning at this % of global budget |

### Emergency response steps

1. **Under active attack (scrapers/bots)**:
   - Set `ABUSE_IP_DENYLIST` to block attacker IPs
   - Lower `ABUSE_BLOCK_THRESHOLD` to increase sensitivity
   - Monitor Vercel runtime logs for `[abuse]` entries

2. **Runaway AI costs**:
   - Lower `QUOTA_AI_GLOBAL_DAILY` immediately
   - Set `STRATEGY_MODEL_PROVIDER=heuristic` to disable AI entirely
   - Check Vercel runtime logs for `[quota]` warnings

3. **Full emergency stop**:
   - Set `API_KILL_SWITCH=1` — blocks all API traffic instantly
   - All routes return 403
   - Remove the var to restore service

4. **False positives blocking real users**:
   - Add their IP to `ABUSE_IP_ALLOWLIST`
   - Or raise `ABUSE_BLOCK_THRESHOLD`
   - Or set `ABUSE_PROTECTION_ENABLED=0` temporarily

## 13) Active forecasting issue stack (V3)

Current strategic initiative for price prediction and model quality:
- Epic: [#23](https://github.com/zayansalman/cotton-market-intelligence/issues/23)
- Delivery issues: [#24](https://github.com/zayansalman/cotton-market-intelligence/issues/24), [#25](https://github.com/zayansalman/cotton-market-intelligence/issues/25), [#26](https://github.com/zayansalman/cotton-market-intelligence/issues/26), [#27](https://github.com/zayansalman/cotton-market-intelligence/issues/27), [#28](https://github.com/zayansalman/cotton-market-intelligence/issues/28), [#29](https://github.com/zayansalman/cotton-market-intelligence/issues/29), [#30](https://github.com/zayansalman/cotton-market-intelligence/issues/30), [#31](https://github.com/zayansalman/cotton-market-intelligence/issues/31), [#32](https://github.com/zayansalman/cotton-market-intelligence/issues/32)

Execution order and acceptance context are documented in:
- `wiki/Price-Prediction-Roadmap.md`
