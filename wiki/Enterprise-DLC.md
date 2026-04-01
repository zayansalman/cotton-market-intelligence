# Enterprise DLC — current agile workflow

This page reflects the **current production workflow** (Next.js + Vercel), not the old Docker/Streamlit setup.

For day-to-day execution steps (onboarding, release checklist, rollback), see `wiki/Engineering-Runbook.md`.

## Branch model (policy)

| Branch | Purpose |
|---|---|
| `main` | Production-only branch (release merges only) |
| `develop` | Integration branch (all feature PRs merge here first) |
| `feature/*` | Short-lived, issue-driven branches |

Mandatory flow:
1. Create/confirm a GitHub issue first.
2. Branch from `develop` using the issue number:
   - `feature/<issue-id>-<short-slug>`
   - Example: `feature/10-hf-model-strategy`
3. Open PR from `feature/*` to `develop` with issue link.
4. Require CI green before merge.
5. Merge `develop` to `main` only for planned releases.

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

CD is split into two explicit lanes. **No other branches deploy.**

### Dev lane
- Branch: `develop`
- Workflow: `.github/workflows/deploy-dev.yml`
- Project: `cmi-notebooks-dev`
- URL: [https://cmi-notebooks-dev.vercel.app](https://cmi-notebooks-dev.vercel.app)

### Prod lane
- Branch: `main` (and manual dispatch)
- Workflow: `.github/workflows/deploy-prod.yml`
- Project: `cmi-notebooks`
- URL: [https://cmi-notebooks.vercel.app](https://cmi-notebooks.vercel.app)

### Feature branch previews: DISABLED

`vercel.json` disables Vercel Git integration for `feature/*`, `fix/*`, and `hotfix/*` branches. Pushing these branches will NOT create Vercel preview deployments. To deploy for testing, merge into `develop`.

This separates integration velocity from production stability and avoids wasting Vercel deployment quota on throwaway previews.

## Environment and secrets

Set secrets in Vercel project settings:
- `OPENAI_API_KEY` (optional but recommended)
- `OPENAI_MODEL` (optional, default `gpt-4o-mini`)

No secrets should be committed to git.

Set secrets in GitHub repository settings:
- `HF_TOKEN` (for AI PR review workflow)
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_DEV`
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
- separate dev/prod deployment workflows

For production-grade governance, configure GitHub Environment protection:
- `development` environment: no approvals
- `production` environment: required approvers + restricted deployment branches (`main`)
