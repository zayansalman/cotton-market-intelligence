# System Architecture

Cotton Market Intelligence (CMI) is a single-deploy Next.js 16 application that combines real-time market data ingestion, AI-powered strategy generation, and a TypeScript-native prediction pipeline into one serverless package. This document covers the full technical architecture.

---

## V4: Unified Decision Pipeline

As of V4, the prediction stack and strategy engine are no longer siloed. They feed into a single unified signal (`computeUnifiedSignal`) that combines four information sources -- quantitative model forecasts, statistical heuristics, LLM analyst reasoning, and news sentiment -- into one weighted ensemble before the strategy engine generates a procurement plan.

### End-to-End Flow

```
  DATA SOURCES (21)
  Yahoo Finance (12 tickers) + FRED (2 series) + RSS (7 feeds)
        |
        v
  FEATURE ENGINEERING (48 features, 9 groups)
  lag, momentum, volatility, regime, technical,
  cross-market, lagged cross-market, calendar, sentiment
        |
        +---------------------+---------------------+
        |                     |                     |
        v                     v                     v
  MODEL STACK (8 models)    HF AI MODELS          HEURISTIC
  naive, mean, MA,          DistilRoBERTa         percentile rank
  seasonal, ridge,          Qwen 2.5 7B          z-score
  elastic net, boosted      Chronos T5            vol regime
  stumps, boosted trees
  walk-forward validated
        |                     |                     |
        v                     v                     v
  +-----------------------------------------------------------+
  |            computeUnifiedSignal()                          |
  |                                                            |
  |  Model: 40%  |  Heuristic: 25%  |  LLM: 20%  | Sent: 15% |
  |                                                            |
  |  -> weighted return -> direction -> confidence -> signal   |
  |  -> decision_drivers[] (full transparency)                 |
  +----------------------------+------------------------------+
                               |
                               v
  STRATEGY GENERATION
  signal -> allocation timing -> vol adjustment -> constraints
  -> monthly_plan[], risk_factors[], executive_summary
```

### How It Differs From the Previous Architecture

Previously, the prediction pipeline (`/api/prediction`) and strategy engine (`/api/strategy`) operated independently. The prediction API produced forecasts. The strategy API produced procurement plans. There was no formal mechanism for the strategy engine to incorporate model forecasts, and no weighted ensemble that combined all signals.

In V4, the strategy route computes the unified signal inline before generating the procurement plan. The heuristic baseline is always computed. Sentiment analysis runs in parallel on headlines. When the ML model and LLM are available, their outputs feed into the same ensemble. The result is a single coherent signal where every source's contribution is recorded in `decision_drivers` and can be traced back to raw data.

For the complete rationale behind every data source, feature group, model choice, weight assignment, and the end-to-end tracing from raw data to procurement recommendation, see [Model Decision Flow](Model-Decision-Flow.md).

---

## 1. System Overview

```
                         EXTERNAL DATA SOURCES
  +------------------+  +----------------+  +------------------+
  | Yahoo Finance    |  | RSS Feeds      |  | FRED             |
  | CT=F, DX-Y.NYB, |  | cottongrower   |  | T5YIE,           |
  | ^VIX, CL=F,     |  | textileworld   |  | MPMICNMA669S     |
  | NG=F, ^TNX,      |  | usda.gov       |  |                  |
  | CNY=X, ^BDI,     |  | worldbank.org  |  |                  |
  | ^GSPC, ZS=F,    |  | reuters        |  |                  |
  | ZW=F, ZC=F      |  | icac, f2f      |  |                  |
  +--------+---------+  +-------+--------+  +---------+--------+
           |                    |                      |
           v                    v                      v
  +----------------------------------------------------------+
  |                    API LAYER (Next.js Route Handlers)     |
  |                                                          |
  |  /api/prices      /api/headlines    /api/pipeline        |
  |  /api/strategy    /api/prediction   /api/backtest        |
  |  /api/landed-cost                                        |
  |                                                          |
  |  Security: abuse protection -> rate limiting ->          |
  |            payload guard -> schema validation ->          |
  |            usage quotas -> safe errors -> timeouts        |
  +---------------------------+------------------------------+
                              |
           +------------------+------------------+
           |                  |                  |
           v                  v                  v
  +----------------+  +---------------+  +----------------+
  | Strategy       |  | Prediction    |  | Landed Cost    |
  | Engine         |  | Pipeline      |  | Calculator     |
  |                |  |               |  |                |
  | Unified signal |  | 21 sources    |  | Futures +      |
  | (4 sources,    |  | 48 features   |  | basis + freight|
  |  weighted      |  | 8 models      |  | + FX + duty    |
  |  ensemble)     |  | + HF AI       |  |                |
  +----------------+  +---------------+  +----------------+
           |                  |                  |
           v                  v                  v
  +----------------------------------------------------------+
  |                    CLIENT (React 19 SPA)                  |
  |                                                          |
  |  page.tsx orchestrates:                                  |
  |    useMarketData -> PriceChart, MarketMetrics            |
  |    useStrategy   -> StrategyResults                      |
  |    useForecast   -> ForecastOverlay, PriceChart          |
  |    useLandedCost -> LandedCostCard                       |
  |    useScenarios  -> ScenarioManager, ScenarioCompare     |
  |                                                          |
  |  State: localStorage (scenarios, alerts, portfolio)      |
  +----------------------------------------------------------+
```

---

## 2. Data Flow

Three primary data flows feed the application.

### 2.1 Market Data Flow

```
Yahoo Finance (CT=F, 5Y daily)
  |
  v
GET /api/prices
  |-- Fetch via fetchWithTimeout (15s)
  |-- Parse timestamps + closes
  |-- Normalize cents to dollars (if > 5, divide by 100)
  |-- Compute moving averages (50d, 200d)
  |-- Compute benchmarks:
  |     pct_rank_1y, pct_rank_5y, z_score_1y,
  |     vol_30d_ann, vol_90d_ann, change_30d_pct,
  |     change_90d_pct, ma crossovers, high/low 1Y
  |-- Return { prices: PricePoint[], benchmarks: Benchmarks }
  v
useMarketData hook -> PriceChart + MarketMetrics
```

### 2.2 News Headline Flow

```
7 RSS Feeds (parallel, 8s timeout each)
  |-- cottongrower.com/feed/
  |-- textileworld.com/feed/
  |-- usda.gov/rss/latest-news.xml
  |-- blogs.worldbank.org agriculture RSS
  |-- reuters.com/markets/commodities/rss
  |-- icac.org/rss
  |-- fibre2fashion.com/rss/cotton-news.xml
  |
  v
GET /api/headlines
  |-- Promise.allSettled (graceful partial failure)
  |-- XML parsing: extract <title>, <description>, <link>, <pubDate>
  |-- Cap: 12 items per feed, 40 total
  v
useMarketData hook -> StrategyResults (context for AI)
```

### 2.3 Strategy Generation Flow (V4 Unified)

```
User clicks "Generate Strategy"
  |
  v
POST /api/strategy
  |-- Abuse check -> Rate limit -> Payload guard -> Schema validation
  |-- Compute heuristic baseline (always runs)
  |-- Run sentiment analysis on headlines (parallel, non-blocking)
  |-- computeUnifiedSignal(model, heuristic, llm, sentiment)
  |-- Resolve AI provider: HF_TOKEN? -> huggingface
  |                        OPENAI_API_KEY + ALLOW_OPENAI_FALLBACK=1? -> openai
  |                        else -> heuristic with unified signal overlay
  |-- Check AI quota (per-IP daily/monthly, global daily)
  |-- If quota exhausted -> degrade to heuristic with warning
  |-- Try primary provider (30s timeout)
  |-- On failure -> fall through to heuristic
  |-- Attach decision_drivers[] to response (source transparency)
  |-- Return Strategy JSON
  v
useStrategy hook -> StrategyResults (with decision driver breakdown)
```

---

## 3. API Layer

Seven route handlers, all following the same security pipeline.

### 3.1 Endpoint Reference

| Endpoint | Method | Purpose | Rate Limit (prod) | Auth |
|---|---|---|---|---|
| `/api/prices` | GET | Cotton #2 futures + benchmarks | 100/min, 20 burst/10s | None |
| `/api/headlines` | GET | RSS news aggregation | 100/min, 20 burst/10s | None |
| `/api/strategy` | POST | AI/heuristic procurement strategy | 20/min, 5 burst/10s | None |
| `/api/prediction` | GET | V3 ML forecast (5d/21d/63d) | 20/min, 5 burst/10s | None |
| `/api/pipeline` | GET | Raw pipeline factors + quality | 20/min, 5 burst/10s | None |
| `/api/backtest` | GET | Walk-forward backtest results | 20/min, 5 burst/10s | None |
| `/api/landed-cost` | GET | Bangladesh landed cost calc | 100/min, 20 burst/10s | None |

### 3.2 Request/Response Shapes

**`GET /api/prices`** -- No parameters. Returns:
```
{ prices: PricePoint[], benchmarks: Benchmarks }
```

**`GET /api/headlines`** -- No parameters. Returns:
```
Headline[]  // { title, summary, link, published }
```

**`POST /api/strategy`** -- Body: `{ purchaserInput, benchmarks, headlines, landedCost? }`. Returns:
```
Strategy  // { signal, confidence, executive_summary, market_analysis,
          //   monthly_plan[], risk_factors[], next_actions[], key_levels,
          //   source: "ai"|"heuristic", provider: "huggingface"|"openai"|"heuristic",
          //   decision_drivers[], predicted_return }
```

**`GET /api/prediction?horizon=21d`** -- Query: `horizon` (5d, 21d, 63d). Returns:
```
{ version, generated_at, current_price, forecasts[], model{}, top_drivers[], sentiment?, hf_forecasts[] }
```

**`GET /api/backtest?tonnage=2000&months=6&step_months=1`** -- Query: tonnage, months, step_months. Returns backtest result with per-window performance.

**`GET /api/landed-cost?futures_usd_lb=0.75&basis_cents_lb=7&freight_usd_t=85&fx_bdt_usd=117`** -- All query params with sensible defaults. Returns:
```
{ assumptions, breakdown, sensitivity: { low_1y, current, high_1y } }
```

**`GET /api/pipeline`** -- No parameters. Returns:
```
{ fetched_at, factors: FactorSeries[], target: DataPoint[], quality_summary }
```

---

## 4. Strategy Engine

### 4.1 Three-Tier Provider Routing

```
resolveProvider()
  |
  |-- Explicit env: STRATEGY_MODEL_PROVIDER = "huggingface" | "openai" | "heuristic"
  |
  |-- Auto mode (default):
  |     1. HF_TOKEN set?                         -> huggingface
  |     2. OPENAI_API_KEY + ALLOW_OPENAI_FALLBACK=1? -> openai
  |     3. else                                   -> heuristic
  |
  v
Execute in order, with fallthrough on failure:

  [1] Hugging Face Inference API
      Model: Qwen/Qwen2.5-7B-Instruct (configurable via HF_STRATEGY_MODEL)
      Prompt: system + user message (benchmarks, headlines, tonnage, landed cost)
      Params: max_new_tokens=900, temperature=0.2, wait_for_model=true
      Timeout: 30s
      Response: JSON parsed from generated_text

  [2] OpenAI Chat Completions
      Model: gpt-4o-mini (configurable via OPENAI_MODEL)
      Prompt: system + user messages
      Params: temperature=0.3, response_format=json_object
      Timeout: 30s
      Response: JSON from choices[0].message.content

  [3] Heuristic (always available, zero external dependencies)
      Inputs: pct_rank_1y, z_score_1y, vol_30d_ann
      Logic:
        rank < 0.15 AND z < -1  -> STRONG_BUY (conf 80)
        rank < 0.30             -> BUY (conf 65)
        rank > 0.80             -> AVOID (conf 70)
        else                    -> HOLD (conf 50)
      Monthly plan: exponential weighting, flattened if vol > 30%
      Includes: landed cost context, MA analysis, volatility assessment

All providers: unified signal overlaid on final output with decision_drivers[]
```

### 4.2 Quota-Based Degradation

Before any AI call, `checkAiQuota()` verifies per-IP daily (default 50), per-IP monthly (default 500), and global daily (default 1000) limits. When exhausted, the request silently degrades to heuristic with a risk factor noting the degradation.

---

## 5. V3 Prediction Pipeline

**Live prediction architecture:** The production prediction route uses an LLM-first approach -- Qwen 2.5 7B with full cross-market context generates the live forecast. The 8 statistical models below are retained in the codebase for backtesting, research, and walk-forward validation, but the live `/api/prediction` endpoint delegates to the LLM.

```
                        DATA SOURCES (21 sources)
  +----------+  +----------+  +--------+  +--------+  +--------+
  | Cotton   |  | DXY      |  | VIX    |  | Crude  |  | NatGas |
  | CT=F     |  | DX-Y.NYB |  | ^VIX   |  | CL=F   |  | NG=F   |
  +----+-----+  +----+-----+  +---+----+  +---+----+  +---+----+
       |              |            |            |            |
  +----+-----+  +----+-----+  +---+----+  +---+----+  +---+----+
  | US10Y    |  | CNY/USD  |  | BDI    |  | S&P500 |  | FRED   |
  | ^TNX     |  | CNY=X    |  | ^BDI   |  | ^GSPC  |  | T5YIE  |
  +----+-----+  +----+-----+  +---+----+  +---+----+  | China  |
       |              |            |            |       | PMI    |
  +----+-----+  +----+-----+                   |       +---+----+
  | Soybean  |  | Wheat    |                   |           |
  | ZS=F     |  | ZW=F     |  +--------+       |           |
  +----+-----+  +----+-----+  | Corn   |       |           |
       |              |        | ZC=F   |       |           |
       v              v        +---+----+       v           v
  +----------------------------------------------------------+  |
  |              runPipeline() -- parallel fetch              |<-+
  |  Promise.allSettled -> graceful partial failure            |
  |  Quality assessment: completeness, staleness, missing %   |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              alignToDaily() -- forward-fill               |
  |  Release-lag offset per factor (e.g., FRED = 1 day)      |
  |  Common daily time index from cotton close dates          |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              buildFeatures() -- 48 features               |
  |                                                          |
  |  Lag group:    cotton_lag_5d, cotton_lag_21d, ...         |
  |  Momentum:     cotton_ret_5d, cotton_ret_21d, ...        |
  |  Volatility:   cotton_vol_10d, cotton_vol_21d, ...       |
  |  Regime:       vol_regime, trend_regime, pct_rank_*      |
  |  Cross-market: dxy_ret_21d, cotton_oil_ratio, ...        |
  |  Lagged X-mkt: dxy_lag_5d, oil_lag_21d, vix_lag_5d      |
  |  Calendar:     month, quarter, is_planting_season, ...   |
  |  Technical:    rsi_14, ma_cross_50_200, dist_from_52w_*  |
  |  Sentiment:    sentiment_score                           |
  |                                                          |
  |  Forward returns: fwd_return_5d, fwd_return_21d,         |
  |                   fwd_return_63d (targets)                |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              trainAndEvaluate() -- 8 models               |
  |                                                          |
  |  Baselines:  naive, historical_mean, moving_avg,         |
  |              seasonal_naive                               |
  |  ML models:  ridge_regression (L2-regularized OLS),      |
  |              elastic_net (L1+L2),                         |
  |              boosted_stumps (depth-1 trees),              |
  |              boosted_trees (depth-3 trees)                |
  |                                                          |
  |  Train/test split (85/15), evaluate MAE + RMSE +         |
  |  direction accuracy. Champion = lowest RMSE that          |
  |  beats naive baseline.                                   |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              Walk-Forward Validation                       |
  |  Expanding window, 21-day step, regime slicing            |
  |  Per-step: train -> predict -> record actual vs predicted |
  |  Metrics sliced by volatility regime and trend regime     |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              Scorecard + Rating                            |
  |  green/yellow/red per horizon                             |
  |  go/no-go criteria: beats naive, direction > 55%,         |
  |  RMSE below threshold                                    |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              Unified Signal Integration                    |
  |                                                          |
  |  Champion model output feeds computeUnifiedSignal()      |
  |  alongside HF AI models and heuristic baseline           |
  |                                                          |
  |  HF models (parallel, non-blocking):                     |
  |  - DistilRoBERTa (financial sentiment)                   |
  |  - Qwen 2.5 7B (LLM quant analyst forecast)             |
  |  - Chronos T5 (time-series foundation model)             |
  +----------------------------------------------------------+
```

---

## 6. Security Architecture

Every API request passes through six defensive layers before reaching business logic.

```
  Incoming Request
        |
  [1] Abuse Protection (abuse-protection.ts)
  |    - Kill switch (API_KILL_SWITCH=1 blocks everything)
  |    - IP allowlist/denylist (env-configurable CSV)
  |    - Suspicious UA detection (curl, python-requests, bots, scrapers)
  |    - Header anomaly scoring (missing accept, oversized headers)
  |    - Repeat offender tracking (in-memory, 1h decay)
  |    - Score threshold: block if score >= 3 (configurable)
  |    -> 403 if blocked
        |
  [2] Rate Limiting (rate-limit.ts)
  |    - Per-IP sliding window (60s default)
  |    - Burst detection (10s micro-window)
  |    - Cooldown on breach (30-60s lockout)
  |    - Per-endpoint configurable limits via env vars
  |    - Response headers: X-RateLimit-Limit, -Remaining, -Reset
  |    -> 429 if exceeded
        |
  [3] Payload Guard (api-security.ts)
  |    - Max body size: 512 KB (Content-Length + body read)
  |    - JSON-only validation (rejects arrays, primitives)
  |    -> 413 if oversized, 400 if malformed
        |
  [4] Schema Validation (Zod strict schemas)
  |    - .strict() rejects unknown fields
  |    - Per-field type, range, and format checks
  |    - Legacy payload auto-upgrade (V1 -> V2)
  |    -> 422 with structured error array
        |
  [5] Usage Quotas (usage-quota.ts)
  |    - Per-IP daily AI calls (default 50)
  |    - Per-IP monthly AI calls (default 500)
  |    - Global daily AI budget (default 1000)
  |    - Graceful degradation: quota exceeded -> heuristic, not 429
  |    - Response headers: X-Quota-Daily-Remaining, -Monthly-Remaining
        |
  [6] Safe Error Responses + Timeouts
       - Internal errors logged server-side, generic message to client
       - External API calls use fetchWithTimeout (15-30s)
       - AbortSignal.timeout on all outbound fetches
```

---

## 7. State Management

### 7.1 No Database by Design

CMI is fully stateless on the server. All persistent state lives client-side.

| State | Storage | Scope | Size |
|---|---|---|---|
| Scenarios (saved strategies) | localStorage | Per-browser | ~50 KB typical |
| Price alerts | localStorage | Per-browser | ~5 KB |
| Portfolio (multi-mill) | localStorage | Per-browser | ~20 KB |
| Rate limit buckets | In-memory Map | Per serverless instance | Resets on cold start |
| Abuse offender scores | In-memory Map | Per serverless instance | Pruned every 30 min |
| Usage quota counters | In-memory Map | Per serverless instance | Pruned every 10 min |

### 7.2 Client-Side Store Pattern

Each store module (`scenarios/store.ts`, `alerts/store.ts`, `portfolio/store.ts`) follows the same pattern: read from `localStorage`, parse with JSON, expose typed getters/setters, handle missing or corrupt data gracefully.

---

## 8. Component Tree

```
page.tsx (client component, root orchestrator)
  |
  |-- Hooks (data fetching + state)
  |   |-- useMarketData()    -> GET /api/prices + /api/headlines on mount
  |   |-- useLandedCost()    -> GET /api/landed-cost when benchmarks change
  |   |-- usePurchaserInput()-> form state + Zod validation
  |   |-- useStrategy()      -> POST /api/strategy on demand
  |   |-- useForecast()      -> GET /api/prediction on demand
  |   |-- useScenarios()     -> localStorage CRUD
  |
  |-- Layout
  |   |-- <header>           -> title, mobile nav toggle
  |   |-- <aside>            -> sidebar (sticky, scrollable)
  |   |   |-- BasicBrief     -> tonnes + months inputs
  |   |   |-- PresetSelector -> one-click mill profiles
  |   |   |-- AdvancedBrief  -> timeline, quality, commercial, logistics, finance
  |   |   |-- InputBriefSummary -> read-only summary of current inputs
  |   |   |-- ScenarioManager-> save/load/delete/compare/export/import
  |   |   |-- [Generate Strategy button]
  |   |
  |   |-- <main>             -> content area
  |       |-- MarketMetrics  -> 6 KPI cards (price, rank, vol, MAs)
  |       |-- LandedCostCard -> Bangladesh cost breakdown + sensitivity
  |       |-- PriceChart     -> Recharts area chart (5Y data, MA overlays, forecast)
  |       |-- ScenarioCompare-> side-by-side diff of two saved scenarios
  |       |-- StrategyResults-> signal badge, executive summary, monthly plan,
  |       |                     risk factors, next actions, key levels,
  |       |                     decision driver breakdown
  |       |-- ForecastOverlay-> V3 prediction details, drivers, scorecard
  |       |-- AlertManager   -> price/signal alert configuration
  |       |-- PortfolioDashboard -> multi-mill aggregate view
  |       |-- BacktestPanel  -> historical strategy performance
```

---

## 9. Deployment

### 9.1 Two Vercel Projects

```
  GitHub Repository (cmi-notebooks)
        |
        +-- develop branch
        |     |
        |     v
        |   Vercel Project: cmi-notebooks-dev
        |   URL: cmi-notebooks-dev.vercel.app
        |   Purpose: staging, QA, dev testing
        |
        +-- main branch
              |
              v
            Vercel Project: cmi-notebooks
            URL: cmi-notebooks.vercel.app
            Purpose: production
```

### 9.2 Branch Protection via vercel.json

```json
{
  "git": {
    "deploymentEnabled": {
      "main": true,
      "develop": true,
      "feature/*": false,
      "fix/*": false,
      "hotfix/*": false
    }
  }
}
```

Feature branches do not trigger Vercel deployments. This prevents stale preview deploys from consuming Vercel quota. All testing happens on the `develop` branch deployment.

### 9.3 CI/CD Flow

```
developer -> feature/* branch -> PR to develop -> merge -> auto-deploy to dev
          -> validate on dev -> PR to main -> merge -> auto-deploy to prod
```

Pre-commit checks: `npm test` (Vitest) and `npm run build` (TypeScript type checking) must pass before every push. The build step catches type errors across the entire codebase, including API route handlers and shared types.

### 9.4 Environment Variables

All configuration is via Vercel environment variables, no `.env` files in the repository. Key variables: `HF_TOKEN`, `OPENAI_API_KEY`, `ALLOW_OPENAI_FALLBACK`, `FRED_API_KEY`, `STRATEGY_MODEL_PROVIDER`, and all `RATE_LIMIT_*` / `QUOTA_*` overrides.
