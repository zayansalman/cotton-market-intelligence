# Enterprise DLC — current agile workflow

This page reflects the **current production workflow** (Next.js + Vercel), not the old Docker/Streamlit setup.

## Branch model

| Branch | Purpose |
|---|---|
| `main` | Production-ready branch |
| `develop` | Active integration branch (current default for iteration) |
| `feature/*` | Short-lived feature branches merged into `develop` |

Recommended flow:
1. Build in `feature/*`
2. PR into `develop`
3. Validate in preview / staging
4. Merge `develop` → `main` for production release

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
