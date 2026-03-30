# Enterprise DLC — current agile workflow

This page reflects the **current production workflow** (Next.js + Vercel), not the old Docker/Streamlit setup.

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

## CD pipeline

CD is handled by Vercel:
- push to connected branch triggers deployment automatically
- branch deploys can be used for staging vs production
- production alias currently points to:
  - [https://cmi-notebooks.vercel.app](https://cmi-notebooks.vercel.app)

## Environment and secrets

Set secrets in Vercel project settings:
- `OPENAI_API_KEY` (optional but recommended)
- `OPENAI_MODEL` (optional, default `gpt-4o-mini`)

No secrets should be committed to git.

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
