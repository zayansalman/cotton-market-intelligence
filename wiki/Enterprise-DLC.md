# Enterprise DLC — current agile workflow

This page reflects the **current production workflow** (Next.js + Vercel), not the old Docker/Streamlit setup.

For day-to-day execution steps (onboarding, release checklist, rollback), see `wiki/Engineering-Runbook.md`.

## Branch model (policy)

| Branch | Purpose |
|---|---|
| `main` | Production-only branch (release merges only); the only branch that deploys |
| `develop` | Code-only integration branch (all feature PRs merge here first); deploys nothing |
| `feature/*` | Short-lived, issue-driven branches; deploy nothing |

Mandatory flow:
1. Create/confirm a GitHub issue first.
2. Branch from `develop` using the issue number:
   - `feature/<issue-id>-<short-slug>`
   - Example: `feature/10-hf-model-strategy`
3. Open PR from `feature/*` to `develop` with issue link.
4. Require CI green before merge.
5. Merge `develop` to `main` only for planned releases. This merge ships straight to production, so it requires explicit human approval.

Direct commits to `develop` should be avoided except urgent hotfixes.

## PR and issue hygiene (policy)

- Every PR must link at least one issue (`Closes #<id>` or `Refs #<id>`).
- Every issue must define:
  - problem statement
  - expected outcome
  - acceptance criteria
- Keep one feature focus per branch/PR to preserve clean history.

## CI pipeline

Current GitHub Actions (`.github/workflows/ci.yml`) does:
- checkout
- setup Node
- `npm ci`
- `npm run build`

This guarantees the app compiles and all API/UI TypeScript checks pass.

Additionally, PRs run `.github/workflows/ai-review.yml`:
- AI-agent review comment on each PR
- Hugging Face-first review path (requires `HF_TOKEN` secret)
- Non-blocking fallback if token/model is unavailable

## CD pipeline

CD has a single explicit lane. **No other branches deploy.**

### Prod lane
- Branch: `main` (and manual dispatch)
- Workflow: `.github/workflows/deploy-prod.yml`
- Project: `cmi-notebooks`
- URL: [https://cmi-notebooks.vercel.app](https://cmi-notebooks.vercel.app)

### All other branches: NO DEPLOYMENT

`vercel.json` disables Vercel Git integration for `develop`, `feature/*`, `fix/*`, and `hotfix/*` branches. Pushing these branches will NOT create Vercel deployments. `develop` is a code-only integration branch.

This keeps a single production surface and avoids wasting Vercel deployment quota on throwaway previews.

### Verification without a staging environment

There is no deployed pre-production environment, so verification happens locally and in CI:
- `npm test` and `npm run build` must pass before opening a `develop` to `main` PR.
- Exercise changed API routes against localhost via `npm run dev`.
- Smoke-test [https://cmi-notebooks.vercel.app](https://cmi-notebooks.vercel.app) after the release lands.

`main` is now the entire blast radius, so the `develop` to `main` merge requires explicit human approval.

## Environment and secrets

Set secrets in Vercel project settings:
- `OPENAI_API_KEY` (optional but recommended)
- `OPENAI_MODEL` (optional, default `gpt-4o-mini`)

No secrets should be committed to git.

Set secrets in GitHub repository settings:
- `HF_REVIEW_TOKEN` (AI PR review workflow only — kept separate from the runtime analyst token)
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_PROD`

## Agile operating rhythm

Use short iteration loops:
1. Ship a thin increment
2. Validate with real mill users
3. Capture feedback as issues
4. Prioritize and repeat weekly

## Immediate engineering priorities

- Add Bangladesh-specific source feeds and local context overlays
- Add strategy backtesting and confidence calibration
- Add role-based workflow and approvals for high-value buys

## Active V3 issue program: price prediction

Execution is tracked in GitHub issues:
- Epic: [#23](https://github.com/zayansalman/cotton-market-intelligence/issues/23)
- Child issues: [#24](https://github.com/zayansalman/cotton-market-intelligence/issues/24) to [#32](https://github.com/zayansalman/cotton-market-intelligence/issues/32)

Detailed sequencing and deliverables:
- `wiki/Price-Prediction-Roadmap.md`

## Enforcement note

Branch protection enforcement (required checks/reviews) depends on repository plan/features.
If protection settings are unavailable on the current plan, keep policy enforced operationally via:
- PR template
- mandatory issue linkage
- CI + AI review workflows on every PR
- a single production deployment workflow gated on `main`

For production-grade governance, configure GitHub Environment protection:
- `production` environment: required approvers + restricted deployment branches (`main`)
