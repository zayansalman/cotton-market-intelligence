# Cotton Market Intelligence (CMI)

A production cotton market intelligence platform that helps Bangladesh spinning mills decide **where the cotton market is likely heading** before turning that view into a practical procurement plan. The live app pulls Cotton #2 futures and cross-market factor data, computes statistical benchmarks, runs a TypeScript-native 8-model forecast stack, builds heuristic and sentiment candidates, then uses Qwen 2.5 72B as a final analyst synthesis layer when Hugging Face is configured. If hosted AI is unavailable, it degrades to transparent model-stack or heuristic outputs.

**Live:** [cmi-notebooks.vercel.app](https://cmi-notebooks.vercel.app) | **Dev:** [cmi-notebooks-dev.vercel.app](https://cmi-notebooks-dev.vercel.app)

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [Architecture](#architecture)
3. [Quantitative Design Decisions](#quantitative-design-decisions)
4. [Decision Pipeline](#decision-pipeline)
5. [V3 Price Prediction Pipeline](#v3-price-prediction-pipeline)
6. [Security Model](#security-model)
7. [Bangladesh-Specific Logic](#bangladesh-specific-logic)
8. [Project Stats](#project-stats)
9. [Run Locally](#run-locally)
10. [Configuration](#configuration)
11. [Development Workflow](#development-workflow)
12. [Deployment](#deployment)
13. [Documentation](#documentation)
14. [Builder](#builder)

---

## What It Does

CMI answers three questions for a cotton procurement desk:

1. **Is cotton cheap or expensive?** -- Percentile rank and z-score vs. 1Y/5Y history, volatility regime, moving average positioning.
2. **Should we buy now, phase, or wait?** -- Signal generation (STRONG_BUY / BUY / HOLD / AVOID) with confidence score, executive summary, risk assessment, and key levels.
3. **What is the month-by-month buy plan?** -- Tonnage allocation across the procurement horizon with exponential weighting, pacing recommendations, and constraint-aware execution notes.

### Core Capabilities

| Capability | Description |
|---|---|
| **Price Intelligence** | Cotton #2 futures from Yahoo Finance. 1Y/5Y percentile rank, z-score, 30d/90d annualized volatility, 50d/200d MA, momentum. |
| **Market Prediction (V3)** | 21-factor data pipeline, 48-feature engineering library, 8-model TypeScript stack, heuristic candidate, sentiment context, LLM analyst synthesis, 5d/21d/63d support, and 95% confidence bands. |
| **LLM Analyst Synthesis** | Qwen 2.5 72B ingests quant model output, heuristic forecast, sentiment, headlines, and cross-market evidence to produce the final market call, like a senior commodity analyst rather than a blind ensemble. |
| **Strategy Engine** | Constraint-aware procurement strategy via deterministic heuristic baseline plus optional Hugging Face strategy generation. It now ingests the final analyst market forecast before producing timing and pacing. |
| **Decision Transparency** | Forecast responses show final source, validation note, evidence ingested by the analyst, top drivers, confidence band, sentiment, and fallback status. |
| **Optional Landed Cost Utility** | A separate `/api/landed-cost` calculator exists for scenario work, but the main app is intentionally focused on market direction because landed cost assumptions vary by buyer and trade lane. |
| **Multi-Mill Portfolio** | Multiple mill configurations with aggregate portfolio views. |
| **Alert System** | Signal change, volatility breach, key level break, price threshold alerts via webhook/email. |
| **Scenario Management** | Save, load, compare, and replay procurement scenarios via localStorage. |

---

## Architecture

```
                  FORECASTING FACTORS + NEWS CONTEXT
  +------------------+  +----------------+  +------------------+
  | Yahoo Finance    |  | FRED           |  | RSS Feeds (7)    |
  | live factor data |  | optional macro |  | cottongrower     |
  | CT=F, DXY, VIX,  |  | MPMICNMA669S   |  | textileworld     |
  | CL=F, NG=F, ^TNX |  |                |  | usda, worldbank  |
  | CNY=X, ^BDI,     |  |                |  | reuters, icac    |
  | ^GSPC, ZS=F,     |  |                |  | fibre2fashion    |
  | ZW=F, ZC=F       |  |                |  |                  |
  +--------+---------+  +-------+--------+  +--------+---------+
           |                    |                     |
           v                    v                     v
  +----------------------------------------------------------+
  |          PIPELINE: fetch -> align -> features (48)        |
  +---------------------------+------------------------------+
                              |
           +------------------+------------------+
           |                  |                  |
           v                  v                  v
  MODEL STACK (8)        HF AI CONTEXT       HEURISTIC
  naive, mean, MA,       DistilRoBERTa       pct_rank, z_score
  seasonal, ridge,       Qwen 2.5 72B        vol regime
  elastic net,
  boosted stumps,
  boosted trees
           |                  |                  |
           v                  v                  v
  +----------------------------------------------------------+
  |              LLM ANALYST SYNTHESIS                         |
  |  candidate forecasts + sentiment + news + cross-market     |
  |  evidence -> one final price view + evidence assessment    |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              STRATEGY GENERATION                          |
  |  signal -> allocation timing -> vol adjust -> constraints |
  |  -> monthly_plan[], risk_factors[], executive_summary     |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              CLIENT (React 19 SPA)                        |
  |  20 components, 6 hooks, localStorage persistence         |
  +----------------------------------------------------------+
```

**Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, Recharts, Zod 4, Vitest

**Key constraint:** The core market/strategy workflow is serverless and fetches market data on demand. Client scenario state lives in localStorage. Supabase is optional and used only for forecast-history tracking when configured.

### API Surface

| Endpoint | Purpose | Rate Limit (prod) |
|---|---|---|
| `/api/prices` | Market data + statistical benchmarks | 90 req/60s |
| `/api/headlines` | RSS news ingestion (7 feeds) | 90 req/60s |
| `/api/strategy` | AI/heuristic procurement strategy | 20 req/60s |
| `/api/landed-cost` | Optional Bangladesh landed cost scenario calculation | 90 req/60s |
| `/api/backtest` | Walk-forward backtesting results | 20 req/60s |
| `/api/pipeline` | Data pipeline status + factor availability | 20 req/60s |
| `/api/prediction` | Point forecasts + confidence intervals | 20 req/60s |

---

## Quantitative Design Decisions

Every statistical choice has a reason. This section explains the "why" behind each one.

### Signal Generation

| Method | Why This Over Alternatives |
|---|---|
| **Percentile rank** | Non-parametric. Works for any distribution shape. Cotton prices are skewed and fat-tailed -- percentiles handle this correctly where parametric thresholds would not. |
| **Z-score** | Standardized deviation from rolling mean. Regime-independent: a z-score of -1.5 means the same thing whether cotton is at 60c or 120c. Complements percentile rank by capturing velocity of deviation. |
| **Annualized volatility (sqrt(252))** | Industry standard for daily data. 252 trading days per year. Allows direct comparison with options-implied vol and cross-asset vol benchmarks. |
| **Exponential allocation weighting** | Front-loads tonnage on BUY signals, back-loads on AVOID. Reflects time value of procurement: locking in a good price today is worth more than the option to buy later at the same price, because you eliminate execution risk. |

### Analyst Signal Synthesis

The system still tracks source influence for transparency, but the production decision pattern is analyst synthesis rather than a mechanical weighted average. The LLM sees each candidate forecast, the validation strength behind it, and the qualitative market context before making the final call.

| Source | Analyst Use | Rationale |
|---|---|---|
| **Model forecast** | Primary quantitative evidence | Walk-forward/train-test validated against real data. Processes 48 features and exposes top drivers. |
| **Heuristic** | Sanity check | Simple, robust, never catastrophically wrong. Keeps the analyst anchored to price regime and volatility. |
| **LLM analyst** | Final decision layer | Integrates quantified evidence with geopolitics, weather, policy, supply/demand, and market judgment. |
| **Sentiment/news** | Qualitative catalyst evidence | Orthogonal to price data. Captures pre-price-move information from headlines, but is discounted when noisy. |

### Prediction Stack

| Decision | Rationale |
|---|---|
| **Ridge regression over OLS** | L2 regularization prevents coefficient explosion on correlated features. With 48 features drawn from overlapping factor groups (e.g., momentum and MA features share price data), multicollinearity is guaranteed. Ridge shrinks unstable coefficients toward zero without dropping features entirely. |
| **Elastic net (L1+L2)** | Combines Ridge and Lasso penalties. In a 48-feature space with correlated groups, elastic net provides feature selection (L1) with multicollinearity stability (L2). |
| **Gradient boosted stumps** | Depth-1 trees (stumps) capture non-linear feature interactions -- e.g., "high volatility AND low momentum" -- without the overfitting risk of deep trees. Boosting ensembles hundreds of weak learners into a strong predictor. Stumps are the minimum viable unit of non-linearity. |
| **Gradient boosted trees (depth 3)** | Deeper trees capture higher-order feature interactions that stumps miss. Depth-3 trees can model conditional relationships like "high vol AND low momentum AND harvest season." Provides complementary signal to stumps. |
| **Walk-forward validation** | Expanding window, never k-fold. K-fold on time series is invalid because it allows future data to inform past predictions. Walk-forward respects temporal ordering: train on [0, t], predict [t+1, t+n], expand window, repeat. |
| **Release-lag alignment** | Economic indicators (CPI, industrial production, USDA reports) are published with a lag. The pipeline forward-fills each factor with a configurable offset matching its real-world publication delay. This eliminates look-ahead bias -- the most common and most damaging error in backtesting. |
| **48 features across 9 groups** | Lag, momentum, volatility, regime, technical, cross-market, lagged cross-market, calendar, sentiment. Breadth across uncorrelated factor groups reduces model fragility. No single factor group dominates, so the model degrades gracefully when any one data source fails. |

---

## Decision Pipeline

CMI separates market prediction from procurement execution, but the strategy route now consumes the final market forecast. The live prediction route builds candidate evidence first: model-stack forecast, heuristic forecast, sentiment/news context, cross-market moves, and benchmark state. Qwen then acts as the senior analyst and produces the final price view. If HF is unavailable, the endpoint falls back to the validated model stack, then to the deterministic heuristic. Fallback responses deliberately do **not** claim fake train/test model metrics.

```
  Model stack forecast ---+
  Heuristic forecast -----+
  Sentiment/news ---------+--> Qwen analyst synthesis
  Cross-market context ---+        |
                                   v
                          final forecast, confidence band,
                          evidence assessment, top drivers
                                   |
                                   v
                          strategy timing and pacing
```

The client obtains the analyst market forecast from `/api/prediction`, then passes it into `/api/strategy` with the purchaser constraints. This keeps long-running LLM work split across requests instead of nesting a prediction call inside the strategy function. Unified decision drivers include the analyst forecast return when available.

For the complete rationale behind every data source, feature, model, and weight, see [Model Decision Flow](wiki/Model-Decision-Flow.md).

---

## V3 Price Prediction Pipeline

The prediction system follows an 8-stage pipeline from raw data to chart overlay.

```
  [1] Data Sources        21 factor slots: live Yahoo data, optional FRED,
                          graceful placeholders, plus RSS context
          |
  [2] Release-Lag         Forward-fill with configurable publication offset
      Alignment
          |
  [3] Feature             48 features: lag, momentum, vol, regime,
      Engineering         technical, cross-market, lagged cross-market,
                          calendar, sentiment
          |
  [4] Model Training      8 models: naive, mean, MA, seasonal,
                          ridge, elastic net, boosted stumps,
                          boosted trees (depth 3)
          |
  [5] Walk-Forward        Expanding window, 21-day step, regime slicing,
      Backtesting         no look-ahead bias
          |
  [6] Accuracy            Traffic-light rating (green/amber/red),
      Scorecard           go/no-go production criteria
          |
  [7] Analyst Synthesis   Qwen ingests candidate forecasts, market context,
                          sentiment, and news to produce final view
          |
  [8] Chart Overlay       Forecast line + confidence band on price chart
```

### Model Stack

| Model | Role | Complexity |
|---|---|---|
| Naive (last value) | Baseline -- any useful model must beat this | O(1) |
| Historical mean | Baseline -- tests whether recent price is informative | O(1) |
| Moving average | Captures trend following | O(n) |
| Seasonal decomposition | Captures calendar effects in cotton markets | O(n) |
| Ridge regression | Linear model with L2 regularization on 48 features | O(n*p) |
| Elastic net | L1+L2 regularization for feature selection + stability | O(n*p) |
| Gradient boosted stumps | Non-linear ensemble capturing feature interactions (depth 1) | O(n*p*T) |
| Gradient boosted trees | Higher-order interactions via depth-3 trees | O(n*p*T) |

Models are evaluated with held-out train/test metrics and walk-forward tooling. Those metrics are passed into the LLM as evidence and shown to the user. The final analyst synthesis does not pretend to have train/test accuracy; it reports its own confidence and preserves candidate model validation separately.

---

## Security Model

Seven layers, applied in order on every request. Defense-in-depth: each layer assumes the previous one failed.

| Layer | Mechanism | What It Stops |
|---|---|---|
| 1. Abuse protection | Bot detection, IP denylist/allowlist, emergency kill-switch | Automated scrapers, known bad actors, zero-day response |
| 2. Rate limiting | Sliding window + burst + cooldown per endpoint per IP | Volume abuse, credential stuffing, API farming |
| 3. Payload guard | 512KB max, strict JSON object requirement | Payload bombs, malformed requests |
| 4. Schema validation | Zod strict mode, no `z.any()` anywhere | Injection, type confusion, unexpected fields |
| 5. Usage quotas | Per-IP daily/monthly + global daily AI budget cap | Cost runaway, single-user monopolization |
| 6. Safe error responses | Generic error messages, no internal details | Information leakage, stack trace exposure |
| 7. Explicit timeouts | All external API calls have hard timeout limits | Hanging connections, upstream failure cascading |

---

## Bangladesh-Specific Logic

CMI is not a generic commodity tool. It encodes domain knowledge specific to Bangladesh's cotton import market.

**Market-first design:** The primary product surface predicts Cotton #2 market direction and translates that into timing/pacing guidance. Landed cost is intentionally kept out of the main flow because basis, freight, LC terms, FX execution, quality specs, and origin spreads vary materially by buyer and shipment.

**Optional landed cost calculation:** `/api/landed-cost` can still convert Cotton #2 futures (USc/lb) through a scenario cost chain to BDT/kg for what-if work. It should be treated as a buyer-specific calculator, not as part of the live market forecast.

**Origin presets:** India (fast lane, 2-3 week lead time, lower freight, smaller basis) vs. long-haul origins (US, Brazil, West Africa -- 6-8 week lead time, higher freight). Lead time directly affects how far forward the procurement plan must look.

**Procurement presets:**

| Preset | Use Case |
|---|---|
| Bangladesh Spinner Default | Standard 3-month rolling procurement |
| Fast Replenishment | Urgent cover, short horizon, accepts higher cost |
| Quality-Critical | Longer horizon, tighter quality specs, origin-constrained |

**Import credit awareness:** Strategy pacing recommendations account for the reality that Bangladesh mills face LC opening delays and foreign currency allocation constraints. The system does not recommend "buy everything now" even on a strong signal if the pacing would create credit stress.

---

## Project Stats

| Metric | Value |
|---|---|
| Total lines of TypeScript | 14,000+ |
| Test count | 183 |
| Test files | 19 |
| Source files | 103 |
| React components | 22 |
| Custom hooks | 7 |
| API routes | 8 |
| Prediction features | 48 (across 9 groups) |
| Prediction models | 8 |
| Forecast factor slots | 21 |
| Analyst evidence sources | model stack, heuristic, sentiment, news, cross-market |
| RSS feeds | 7 |
| Security layers | 7 |

---

## Run Locally

```bash
git clone https://github.com/zayansalman/cotton-market-intelligence.git
cd cotton-market-intelligence
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app works immediately with zero configuration -- the heuristic strategy engine and all statistical computations require no API keys.

---

## Configuration

### Environment Variables

Create `.env.local` for optional AI and forecast-history features:

```bash
# AI strategy generation and analyst context (optional)
HF_TOKEN=your_huggingface_token
HF_STRATEGY_MODEL=Qwen/Qwen2.5-72B-Instruct:fastest

# Provider routing
STRATEGY_MODEL_PROVIDER=auto    # auto | huggingface | heuristic

# Optional macro data
FRED_API_KEY=your_fred_key

# Optional Supabase forecast-history tracking (server-side prediction writes)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Vercel Marketplace Supabase projects may also expose these names.
# The app can read the URL from either key; anon-key writes require matching table policies.
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Forecast History Backend

The market prediction flow is still stateless by default. When Supabase is configured, `/api/prediction` stores each generated forecast, including the full chart path, in the `predictions` table, and `/api/forecast-history` resolves past target dates against actual Cotton #2 prices to compute direction accuracy and absolute error. Apply the files in `supabase/migrations/` to the Supabase project connected to both Vercel environments.

For Vercel, connect Supabase through the Marketplace or add the env vars above to the `develop` and `main` projects. The app degrades gracefully to an empty history overlay when Supabase is not configured.

### Provider Routing

| Setting | Behavior |
|---|---|
| `auto` (default) | HF first when `HF_TOKEN` is set, then heuristic. |
| `huggingface` | Force HF. Falls back to heuristic if unavailable. |
| `heuristic` | Deterministic only. No external AI calls. |

### Rate Limiting

Per-endpoint configuration via environment variables:

```bash
RATE_LIMIT_<ENDPOINT>_WINDOW_MS        # Sliding window size
RATE_LIMIT_<ENDPOINT>_MAX_REQUESTS     # Max requests per window
RATE_LIMIT_<ENDPOINT>_BURST_WINDOW_MS  # Burst detection window
RATE_LIMIT_<ENDPOINT>_BURST_MAX        # Max burst requests
RATE_LIMIT_<ENDPOINT>_COOLDOWN_MS      # Cooldown after limit hit
```

Higher defaults apply automatically in development (`NODE_ENV != production`).

---

## Development Workflow

```
feature/<issue-id>-<slug>  -->  develop  -->  main
         (work)              (dev deploy)   (prod deploy)
```

1. Branch from `develop` (never from `main`)
2. Name branches `feature/<issue-id>-<slug>` or `fix/<issue-id>-<slug>`
3. Run `npm test` and `npm run build` before every commit
4. PR into `develop` -- auto-deploys to dev URL on merge
5. Release PR from `develop` to `main` -- auto-deploys to prod on merge
6. Feature branch Vercel previews are disabled (`vercel.json`)

**CI:** GitHub Actions runs build + full test suite on every push.

---

## Deployment

### Vercel (Production)

| Lane | Branch | URL |
|---|---|---|
| Dev | `develop` | `cmi-notebooks-dev.vercel.app` |
| Prod | `main` | `cmi-notebooks.vercel.app` |

### Required Secrets

```
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID_DEV
VERCEL_PROJECT_ID_PROD
```

Production deployments should use GitHub Environment protection rules with required approvers.

---

## Documentation

| Page | Contents |
|---|---|
| [Home](wiki/Home.md) | Capability summary and project overview |
| [How It Works](wiki/How-It-Works.md) | System architecture and data flow |
| [Architecture](wiki/Architecture.md) | Full technical architecture (V4 unified pipeline) |
| [Model Decision Flow](wiki/Model-Decision-Flow.md) | End-to-end decision pipeline: data sources, features, models, ensemble weights, strategy generation |
| [Strategic Procurement](wiki/Strategic-Procurement.md) | Strategy engine methodology |
| [Bangladesh Market](wiki/Bangladesh-Market.md) | Bangladesh cotton import context |
| [Business Case](wiki/Business-Case.md) | Commercial rationale and ROI |
| [Business Model](wiki/Business-Model.md) | Monetization and go-to-market |
| [V3 Data Dictionary](wiki/V3-Data-Dictionary.md) | All 21 factor slots, 48 features, definitions |
| [V3 Predictor Universe](wiki/V3-Predictor-Universe.md) | Factor selection rationale |
| [Price Prediction Roadmap](wiki/Price-Prediction-Roadmap.md) | V3 issue tracker and delivery sequence |
| [V2 Worked Scenarios](wiki/V2-Worked-Scenarios.md) | End-to-end procurement examples |
| [Purchaser Inputs](wiki/Purchaser-Inputs-Bangladesh.md) | Bangladesh-specific input parameters |
| [Engineering Runbook](wiki/Engineering-Runbook.md) | Dev setup, CI/CD, deployment ops |
| [Enterprise DLC](wiki/Enterprise-DLC.md) | Enterprise deployment and data lifecycle |
| [Visual Tool](wiki/Visual-Tool.md) | Dashboard component reference |

---

## Builder

**Zayan Khan** -- CS (Brunel University London, First-Class Honours), ex-Berenberg Bank quantitative research, Growth Manager at iFarmer (Bangladesh's largest agri-tech startup).

This project reflects the intersection of quantitative finance, agricultural domain expertise, and production engineering. The statistical methods come from institutional commodity trading. The domain logic comes from working directly with Bangladesh spinning mills. The engineering decisions prioritize reliability (LLM analyst synthesis -> model-stack fallback -> heuristic fallback), correctness (train/test validation, walk-forward tooling, release-lag alignment), and low operational overhead (serverless core with optional Supabase forecast history).
