# Engineering Runbook (IDE-Agnostic)

This is the single source of truth for how to continue development from any IDE or machine.

## 1) Scope and objectives

Use this runbook to:
- onboard quickly in any environment
- follow the expected branch and release flow
- understand CI/CD behavior
- deploy safely to Vercel dev and prod
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
- `main`: production only
- `develop`: integration branch
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

## 6) CD behavior (Vercel lanes)

### Dev lane
- Workflow: `.github/workflows/deploy-dev.yml`
- Trigger: push to `develop` (or manual dispatch)
- GitHub environment: `development`
- Vercel project secret used: `VERCEL_PROJECT_ID_DEV`
- Intended URL: `https://cmi-notebooks-dev.vercel.app`

### Prod lane
- Workflow: `.github/workflows/deploy-prod.yml`
- Trigger: push to `main` (or manual dispatch with ref)
- GitHub environment: `production`
- Vercel project secret used: `VERCEL_PROJECT_ID_PROD`
- URL: `https://cmi-notebooks.vercel.app`

Both deploy workflows:
1. validate required Vercel secrets
2. install dependencies
3. install Vercel CLI
4. `vercel pull`
5. `vercel build --prod`
6. `vercel deploy --prebuilt --prod`

## 7) Required secrets and where they live

GitHub repository secrets:
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_DEV`
- `VERCEL_PROJECT_ID_PROD`
- `HF_TOKEN` (for AI review workflow, if enabled)

If deploy workflows skip with a warning about invalid `VERCEL_TOKEN`, rotate the token in GitHub secrets and re-run the workflow.

Vercel project env vars (set per project/environment):
- `OPENAI_API_KEY` (optional)
- `OPENAI_MODEL` (optional, default behavior exists)
- `HF_TOKEN` (if strategy path depends on Hugging Face)
- `HF_STRATEGY_MODEL` (optional override)
- `STRATEGY_MODEL_PROVIDER` (`auto` / `huggingface` / `openai` / `heuristic`)
- `ALLOW_OPENAI_FALLBACK` (`0` or `1`)
- Rate limiting vars per endpoint (see endpoint keys below):
  - `RATE_LIMIT_<ENDPOINT>_WINDOW_MS`
  - `RATE_LIMIT_<ENDPOINT>_MAX_REQUESTS`
  - `RATE_LIMIT_<ENDPOINT>_BURST_WINDOW_MS`
  - `RATE_LIMIT_<ENDPOINT>_BURST_MAX`
  - `RATE_LIMIT_<ENDPOINT>_COOLDOWN_MS`

Endpoint keys:
- `strategy`
- `headlines`
- `prices`
- `landed_cost`

Recommended production rate limit defaults:
- `strategy`: 20 req / 60s, burst 5 / 10s, cooldown 60s
- `headlines`: 90 req / 60s, burst 20 / 10s, cooldown 20s
- `prices`: 90 req / 60s, burst 20 / 10s, cooldown 20s
- `landed_cost`: 90 req / 60s, burst 20 / 10s, cooldown 20s

Rule: never commit secrets to git.

## 8) Release process (recommended)

1. Feature branches merge into `develop`.
2. Validate on dev deployment.
3. Open release PR: `develop` -> `main`.
4. Get approval for production release.
5. Merge to `main` to trigger prod deploy.
6. Smoke test production:
   - homepage load
   - `/api/prices` returns data
   - `/api/headlines` returns data
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
   - latest successful `deploy-dev` and `deploy-prod` runs
4. Confirm env access:
   - GitHub secrets present
   - Vercel env vars present in dev/prod projects
5. Resume from issue-linked feature branch naming convention.

## 11) Ownership updates

When process changes:
- update this runbook in the same PR as workflow/config changes
- add a short "why changed" note in PR description
- keep branch/deploy policy docs synchronized with:
  - `README.md`
  - `wiki/Enterprise-DLC.md`
  - this runbook

## 12) Active forecasting issue stack (V3)

Current strategic initiative for price prediction and model quality:
- Epic: [#23](https://github.com/zayansalman/cotton-market-intelligence/issues/23)
- Delivery issues: [#24](https://github.com/zayansalman/cotton-market-intelligence/issues/24), [#25](https://github.com/zayansalman/cotton-market-intelligence/issues/25), [#26](https://github.com/zayansalman/cotton-market-intelligence/issues/26), [#27](https://github.com/zayansalman/cotton-market-intelligence/issues/27), [#28](https://github.com/zayansalman/cotton-market-intelligence/issues/28), [#29](https://github.com/zayansalman/cotton-market-intelligence/issues/29), [#30](https://github.com/zayansalman/cotton-market-intelligence/issues/30), [#31](https://github.com/zayansalman/cotton-market-intelligence/issues/31), [#32](https://github.com/zayansalman/cotton-market-intelligence/issues/32)

Execution order and acceptance context are documented in:
- `wiki/Price-Prediction-Roadmap.md`
