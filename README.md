# Cotton Market Intelligence (CMI)

Production MVP for cotton procurement intelligence, deployed on Vercel.

**Live app:** [https://cmi-notebooks.vercel.app](https://cmi-notebooks.vercel.app)

CMI helps a spinning mill answer:
1. Is cotton currently cheap or expensive vs recent history?
2. Should we buy now, phase buys, or delay?
3. If we need X tonnes in Y months, what is the month-by-month buy roadmap?

## Current architecture (live)

- **Frontend:** Next.js (App Router) + React + Tailwind
- **Backend:** Next.js API routes (server-side)
- **Charts:** Recharts
- **Hosting:** Vercel
- **CI:** GitHub Actions (`npm ci` + `npm run build`)

## What the app does today

### 1) Price intelligence (`/api/prices`)
- Pulls Cotton #2 futures (`CT=F`) from Yahoo Finance
- Computes:
  - 1Y/5Y percentile rank
  - 1Y z-score
  - 30d/90d annualized volatility
  - 50d and 200d moving averages
  - 30d/90d momentum

### 2) News ingestion (`/api/headlines`)
- Pulls RSS headlines from cotton/agri sources
- Surfaces latest headlines as context for decisions

### 3) Strategy generation (`/api/strategy`)
- Inputs: company name, required tonnes, horizon months, live benchmarks, headlines
- Output:
  - Signal: `STRONG_BUY | BUY | HOLD | AVOID`
  - Confidence score
  - Executive summary
  - Market analysis
  - Monthly purchase plan (tonnes + % per month)
  - Risks and next actions
  - Key levels (support, fair value, resistance)
- **AI mode:** uses OpenAI if `OPENAI_API_KEY` is configured
- **Fallback mode:** deterministic heuristic strategy (no API key needed)

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional env vars

Create `.env.local`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
HF_TOKEN=your_huggingface_token_here
HF_STRATEGY_MODEL=Qwen/Qwen2.5-7B-Instruct
STRATEGY_MODEL_PROVIDER=auto
ALLOW_OPENAI_FALLBACK=0
```

Provider routing behavior:
- `STRATEGY_MODEL_PROVIDER=auto` (default): Hugging Face first, then heuristic (OpenAI only if `ALLOW_OPENAI_FALLBACK=1`)
- `STRATEGY_MODEL_PROVIDER=huggingface`: force HF path (falls back to heuristic if unavailable)
- `STRATEGY_MODEL_PROVIDER=openai`: force OpenAI path (falls back to heuristic if unavailable)
- `STRATEGY_MODEL_PROVIDER=heuristic`: deterministic only

### API rate limiting env vars

Rate limiting is enabled on:
- `/api/strategy`
- `/api/headlines`
- `/api/prices`
- `/api/landed-cost`

Per-endpoint env var pattern:

```bash
RATE_LIMIT_<ENDPOINT>_WINDOW_MS
RATE_LIMIT_<ENDPOINT>_MAX_REQUESTS
RATE_LIMIT_<ENDPOINT>_BURST_WINDOW_MS
RATE_LIMIT_<ENDPOINT>_BURST_MAX
RATE_LIMIT_<ENDPOINT>_COOLDOWN_MS
```

Endpoint keys:
- `strategy`
- `headlines`
- `prices`
- `landed_cost`

Recommended production defaults:
- `strategy`: 20 req / 60s, burst 5 / 10s, cooldown 60s
- `headlines`: 90 req / 60s, burst 20 / 10s, cooldown 20s
- `prices`: 90 req / 60s, burst 20 / 10s, cooldown 20s
- `landed_cost`: 90 req / 60s, burst 20 / 10s, cooldown 20s

Higher local defaults apply automatically when `NODE_ENV != production`.

## Deploy

### Vercel (recommended)
1. Import this repo in Vercel
2. Deploy branch `develop` (or `main` for production)
3. Add `OPENAI_API_KEY` in Vercel project environment variables

### Enterprise deploy lanes (recommended)

- **Dev lane:** `develop` branch -> `cmi-notebooks-dev.vercel.app`
- **Prod lane:** `main` branch -> `cmi-notebooks.vercel.app`

GitHub Actions workflows:
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/deploy-prod.yml`

Required GitHub repository secrets:

```bash
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID_DEV
VERCEL_PROJECT_ID_PROD
```

Recommended governance:
- set GitHub Environment `production` with required approvers
- use release PRs (`develop` -> `main`) before production deployment

## Development workflow (required)

This project follows an issue-driven branching workflow:

1. Create or pick a GitHub issue
2. Branch from `develop` as:
   - `feature/<issue-id>-<short-slug>`
3. Implement in that feature branch
4. Open PR to `develop` and link the issue
5. Merge to `main` only through release PRs

Example branch name:

```bash
feature/10-hf-model-strategy
```

## Repo map (current)

- `src/app/page.tsx` — main dashboard UI
- `src/app/api/prices/route.ts` — market data + benchmarks
- `src/app/api/headlines/route.ts` — RSS ingestion
- `src/app/api/strategy/route.ts` — AI + heuristic strategy engine
- `src/components/*` — charts, cards, signal UI
- `.github/workflows/ci.yml` — build verification

## Roadmap (next)

- Add Bangladesh-specific data feeds and basis overlays
- Add multi-mill scenario comparison
- Add backtesting / decision replay mode
- Add alerting (email/WhatsApp/Slack) on signal changes

## V3 price prediction program (open issues)

Goal: deliver institutional-grade cotton price prediction using quantitative + qualitative drivers, with strict backtesting, current accuracy rating, and landing-page forecast visualization.

GitHub epic:
- [#23 V3: Global cotton price prediction program (quant + qualitative, institutional-grade)](https://github.com/zayansalman/cotton-market-intelligence/issues/23)

Execution issues:

| Issue | Workstream | Outcome |
|---|---|---|
| [#24](https://github.com/zayansalman/cotton-market-intelligence/issues/24) | Research predictor universe | Identify all required drivers and additional factors to include |
| [#25](https://github.com/zayansalman/cotton-market-intelligence/issues/25) | Multi-source data pipeline | Build lag-aware dataset from quant + qualitative inputs |
| [#26](https://github.com/zayansalman/cotton-market-intelligence/issues/26) | Lagged/regime feature engineering | Capture strong lagged correlations and seasonal/regime effects |
| [#27](https://github.com/zayansalman/cotton-market-intelligence/issues/27) | Model stack | Train baseline + advanced quant models and select champion |
| [#28](https://github.com/zayansalman/cotton-market-intelligence/issues/28) | Backtesting | Measure true out-of-sample quality with no leakage |
| [#29](https://github.com/zayansalman/cotton-market-intelligence/issues/29) | Accuracy scorecard | Rate current accuracy and set production thresholds |
| [#30](https://github.com/zayansalman/cotton-market-intelligence/issues/30) | Prediction API | Serve forecast, confidence intervals, and model metadata |
| [#31](https://github.com/zayansalman/cotton-market-intelligence/issues/31) | Landing page chart | Show forecast overlays and confidence bands on dashboard |
| [#32](https://github.com/zayansalman/cotton-market-intelligence/issues/32) | Monitoring and retraining | Detect drift and enforce retraining/rollback policy |

## Documentation

Start here:
- `wiki/Home.md` for capability summary and planning pages
- `wiki/Price-Prediction-Roadmap.md` for full V3 issue tracker and delivery sequence
- `wiki/Engineering-Runbook.md` for IDE-agnostic development + CI/CD + Vercel dev/prod deployment operations
