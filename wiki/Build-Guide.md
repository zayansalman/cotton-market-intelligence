# How to Build a Commodity Intelligence Platform -- Step by Step

## Who This Is For

Data scientists, quant engineers, or developers who want to build a production commodity procurement intelligence tool. This guide uses cotton as the worked example, but the architecture applies to any commodity with futures markets -- coffee, cocoa, crude oil, wheat, natural gas, you name it.

This is the guide we wish existed when we started building CMI. It covers every decision, every dead end we avoided, and why the final architecture looks the way it does.

## Prerequisites

- TypeScript/Next.js experience (App Router, React 19)
- Basic understanding of time-series analysis (stationarity, autocorrelation, walk-forward validation)
- Hugging Face account (Pro recommended, $9/mo -- needed for inference API rate limits)
- A FRED API key (free) for macroeconomic data
- Domain knowledge in your target commodity (or willingness to acquire it fast)

---

## Step 1: Define Your Target Variable

Before you write a single line of code, answer one question: **what futures contract do your buyers actually price against?**

This is not a data science question. It is a procurement question. The right target variable is the contract your end-users reference in their purchase orders.

| Commodity | Contract | Exchange | Ticker | Why This One |
|-----------|----------|----------|--------|--------------|
| Cotton | Cotton #2 | ICE | CT=F | Global benchmark for South Asian mill pricing |
| Coffee | Coffee C | ICE | KC=F | Arabica benchmark, used by roasters worldwide |
| Cocoa | Cocoa | ICE | CC=F | Global benchmark for chocolate manufacturers |
| Crude Oil | WTI | NYMEX | CL=F | US benchmark; Brent (BZ=F) for Europe/Asia |
| Wheat | Wheat | CBOT | ZW=F | US soft red winter wheat benchmark |
| Soybeans | Soybeans | CBOT | ZS=F | Global benchmark for crushers and feed mills |

**Key principle:** if your buyers price against Cotlook A Index but you model ICE Cotton #2, that is fine -- the two are cointegrated. But if your buyers price against a local spot market with no futures analog, you have a harder problem (and likely need a basis model on top).

For CMI, the target is `CT=F` -- ICE Cotton #2 front-month continuous contract. Every spinning mill in Bangladesh, India, and Pakistan references this price.

---

## Step 2: Map Your Factor Universe

Think like a commodity analyst, not a data scientist. The features that matter are not the ones with the highest correlation in-sample -- they are the ones with a documented economic transmission mechanism.

For ANY commodity, you need factors in five categories.

### 2a. Supply-Side Factors

**Acreage/production competition:** What other crops or products compete for the same resources?

| Commodity | Competing Products | Shared Resource |
|-----------|--------------------|-----------------|
| Cotton | Soybeans, wheat, corn | US farmland (Cotton Belt overlaps with soybean/corn territory) |
| Coffee | Cocoa, sugar | Tropical land in Brazil, Colombia, Vietnam |
| Crude Oil | Natural gas | Shared drilling infrastructure, rigs, capital |
| Wheat | Corn, soybeans | US Plains and Midwest farmland |

For cotton, the soybean/cotton ratio is the single most-watched cross-commodity signal on every agricultural trading desk. When soybeans rally, farmers plant more soybeans and less cotton -- reducing supply 6-9 months later.

**Input costs:** What does it cost to produce?

- Cotton: fertilizer (DAP/urea -- MOS as proxy), diesel (heating oil HO=F), seeds, water, ginning energy
- Coffee: fertilizer, labor (high share), ocean shipping
- Crude oil: drilling costs, rig count (Baker Hughes weekly)
- Wheat: fertilizer, diesel, irrigation

Input costs matter because they set the floor price. When production costs exceed market price, farmers cut acreage.

**Weather:** What weather patterns affect production?

- Cotton: ENSO cycle (La Nina = good India monsoon = high India production), US Southeast rainfall during planting (Apr-Jun) and harvest (Sep-Nov)
- Coffee: Brazil frost risk (Jun-Aug), Colombia rainfall anomalies
- Wheat: US Plains drought (Jun-Aug), Black Sea winter kill

For CMI, we use an ENSO proxy (monthly, 30-day release lag) because the India monsoon drives ~25% of global cotton production. This is a slow-moving but high-impact factor.

**Government policy:** Export bans, subsidies, tariffs

- Cotton: India export restrictions (happened in 2022, moved prices 15% in a week), US farm bill subsidies, China strategic reserve releases
- Coffee: Brazil export taxes, Vietnam export quotas
- Crude oil: OPEC production quotas, US sanctions on Iran/Venezuela/Russia

Policy shocks are hard to model statistically. This is where the LLM layer earns its keep (Step 8).

### 2b. Demand-Side Factors

**End-use consumption:** Who buys your commodity and what drives their demand?

- Cotton: textile mills, primarily in China, Bangladesh, India, Vietnam. Proxy signals: China Manufacturing PMI (monthly), S&P 500 (daily risk appetite)
- Coffee: roasters and cafes. Proxy: consumer confidence, retail spending
- Crude oil: refineries, manufacturers. Proxy: global manufacturing PMI, driving miles

**Substitutes:** What competes for the same end-use?

- Cotton vs. polyester: THE critical substitution signal for cotton. Polyester is made from PTA, which comes from PX, which comes from naphtha, which comes from crude oil. When oil goes up, polyester gets expensive, and mills switch to cotton. This chain takes 2-4 weeks to propagate, which is why we use lagged oil features.
- Coffee vs. tea: limited substitution effect
- Crude oil vs. renewables/natural gas: long-term substitution, hard to capture at daily frequency

### 2c. Macro Factors

**Currency:** Your commodity is priced in USD. Your buyers pay in local currency. This creates a structural relationship.

- Cotton: USD-priced, bought by CNY/INR/BDT countries. DXY up means cotton is more expensive for 70%+ of global buyers, so demand falls. Empirical R ~ -0.3 to -0.6 over rolling windows.
- Crude oil: USD-priced, global buyers. Same DXY inverse relationship.

For CMI, we track DXY (broad dollar index), CNY/USD (China is 30% of consumption), INR/USD (India is the largest producer), and BDT/USD (Bangladesh is our primary user base).

**Rates:** Higher rates increase the cost of carrying physical inventory. Cotton sitting in a warehouse has a financing cost. When rates rise, merchants sell inventory to reduce carry, creating downward price pressure.

**Risk appetite:** VIX (fear gauge) and S&P 500 (growth proxy). When VIX spikes, institutional commodity positions get unwound. When equities rally, risk appetite supports commodity allocations.

**Inflation:** Commodities are real assets. When breakeven inflation expectations rise, commodities attract inflows as an inflation hedge. We use the 5-year breakeven inflation rate from FRED.

### 2d. Logistics

**Freight:** How does your commodity physically move from origin to destination?

- Cotton: containerized shipping (ZIM as proxy for container rates) + bulk shipping (Baltic Dry Index)
- Crude oil: VLCC tanker rates
- Grain/wheat: bulk shipping (Baltic Dry Index)
- Coffee: containerized shipping

Freight costs are a real component of CIF (cost, insurance, freight) pricing. When container rates spike (as in 2021-22), the landed cost of cotton rises even if futures are flat.

### 2e. Positioning and Flow

**CFTC Commitments of Traders (COT):** Managed money net position, released weekly with a 3-day lag. When speculators are max-long, the risk of a liquidation cascade is elevated. When they are max-short, the risk of a short squeeze rises.

**Open interest:** Total market participation. Rising open interest with rising prices confirms a trend. Rising open interest with falling prices suggests aggressive shorting.

Note: COT data is not freely available via real-time API. In CMI, this is a placeholder for premium data integration. If you have a Bloomberg or Refinitiv terminal, prioritize adding this.

---

## Step 3: Build the Data Pipeline

### Architecture

The data pipeline has three layers:

```
sources.ts  -->  runner.ts  -->  features.ts
(fetch raw)      (orchestrate)   (engineer features)
```

**`sources.ts`** contains one function per data source. Each function returns `DataPoint[]` (date + value pairs). Sources are independent -- if Yahoo Finance is down, FRED data still flows.

**`runner.ts`** orchestrates fetching, handles errors, aligns dates, and produces a unified time-series matrix.

**`features.ts`** takes the raw matrix and engineers the feature set for modeling.

### Factor Metadata

For each factor, define a `FactorMeta` object:

```typescript
interface FactorMeta {
  id: string;           // e.g., "cotton_close"
  name: string;         // e.g., "Cotton #2 Futures"
  group: string;        // e.g., "target", "macro", "competing", "supply", "freight"
  frequency: string;    // "daily" | "weekly" | "monthly"
  release_lag_days: number;  // days after period-end before data is available
  unit: string;         // e.g., "$/lb", "index", "%"
  source: string;       // e.g., "Yahoo (CT=F)", "FRED (T5YIE)"
  direction: 1 | -1;   // expected relationship with target
}
```

### Implementation Pattern

For each data source:

1. Define `FactorMeta` with all fields populated
2. Implement `fetch()` that returns `DataPoint[]` from the API
3. Write a comment block documenting the economic mechanism -- this is not optional, it is the most important documentation in the codebase
4. Handle errors gracefully (return empty array, log warning, never throw)

### Release-Lag Alignment

This is the single most important design decision for backtest integrity.

`release_lag_days` specifies how many calendar days after the reference date the data becomes publicly available. For example:

- Daily market data (Yahoo): lag = 0 (available at close)
- FRED weekly series: lag = 1-7 days depending on series
- China PMI: lag = 3 days (released on 1st of following month)
- USDA export sales: lag = 7 days (released Thursday for prior week)
- ENSO index: lag = 30 days (monthly publication)

In backtesting, a data point with `release_lag_days = 3` and reference date Jan 31 is only visible to the model from Feb 3 onward. Violating this creates look-ahead bias, which is the #1 cause of inflated backtest results. A model that looks 3% accurate but uses future data is worse than useless -- it will underperform in production and destroy trust.

---

## Step 4: Engineer Features

Feature engineering is where domain knowledge meets statistics. For each factor, compute:

### Standard Feature Set

| Feature Type | Example | Purpose |
|-------------|---------|---------|
| Raw level | `dxy_close` | Contemporaneous relationship |
| Lagged values | `dxy_lag_5d`, `dxy_lag_21d` | Lead-lag relationships (FX repricing takes ~1 week) |
| Returns | `dxy_ret_5d`, `dxy_ret_21d` | Stationarity; comparable across factors with different units |
| Cross-commodity ratios | `cotton_soybean_ratio` | Relative value signals |
| Calendar features | `month_sin`, `month_cos` | Seasonality (cotton planting Apr-Jun, harvest Sep-Nov) |

### Target Variable Features

For the target (cotton price), add:

- Lagged prices: 1d, 5d, 21d (autoregressive component)
- Momentum: 5d, 21d, 63d returns
- Volatility: 21d rolling standard deviation of returns
- Regime indicators: above/below 200-day moving average
- RSI (14-day): mean-reversion signal
- MA crossovers: 20/50, 50/200 (trend signals)
- Distance from 52-week high/low: extreme positioning signal
- Forward returns: 5d, 21d, 63d (supervised learning targets)

### Feature Count Guidance

Aim for **48 features** from roughly **21 factor slots**. Here is why:

- With ~1000 trading days of daily data (4 years), you have roughly 1000 samples
- The rule of thumb is 10-20 samples per feature for linear models
- 48 features / 1000 samples = 1:21 ratio, which is on the edge
- More than 100 features risks overfitting, especially with tree-based models
- Regularization (Ridge) helps, but is not a substitute for feature discipline

If you are tempted to add more features, ask: "Does this capture a NEW economic mechanism, or is it a correlated variant of something I already have?" If the latter, drop it.

---

## Step 5: Train Model Stack

Implement models in order of complexity. Each model must justify its existence by beating the one below it.

### Tier 1: Baselines (must-have)

**1. Naive (random walk):** Predicts zero return. Tomorrow's price = today's price.

If you cannot beat this, your model has no value. This is the honest null hypothesis. Financial time series are famously hard to predict, and many published models fail this test once look-ahead bias is removed.

**2. Historical mean:** Predicts the average historical return. Tests whether there is drift (trend) in your commodity. Cotton has a slight positive drift over long horizons due to inflation, but it is small relative to volatility.

**3. Moving average return:** Simple momentum signal (e.g., 21-day average return). Tests whether recent trend persists.

**4. Seasonal naive:** Predicts the return from the same calendar month in prior years. Tests whether seasonality alone has signal. For cotton, there is a known seasonal pattern: prices tend to rise during US planting uncertainty (Apr-Jun) and fall post-harvest (Oct-Dec).

### Tier 2: Statistical Models

**5. Ridge regression:** Linear model with L2 regularization.

Why Ridge over OLS: with 48 correlated features, OLS coefficients explode due to multicollinearity. Ridge shrinks them toward zero, producing stable predictions. Lambda = 0.01 is a good starting point; tune via walk-forward validation (not cross-validation).

Why Ridge over Lasso: Lasso (L1) performs feature selection, which sounds nice but is unstable when features are correlated -- it arbitrarily picks one from a correlated group. Ridge keeps all features with shrunken weights, which is more stable for forecasting.

**6. Gradient boosted stumps:** Non-linear model using single-split decision stumps (max_depth=1), 50 boosting rounds, learning_rate=0.1.

Why stumps: at ~1000 samples, deeper trees WILL overfit. A stump captures "if DXY > 105, cotton tends to fall" without fitting noise. 50 rounds of stumps is enough to capture the main non-linear effects.

Why not random forests: forests are good for classification with lots of samples. For regression with 1000 samples and 48 features, boosted stumps are more sample-efficient.

### Why NOT Neural Networks

Three reasons:

1. **Sample size:** ~1000 daily observations is 2-3 orders of magnitude too small for neural networks to generalize. You will overfit on the training set and underperform naive in production.
2. **Interpretability:** Procurement managers need to understand WHY the model says "buy now." A Ridge coefficient on DXY is interpretable. An attention weight in a transformer is not.
3. **Marginal improvement:** Academic benchmarks consistently show that for tabular financial data with <10,000 samples, gradient boosting matches or beats neural networks. The complexity is not worth it.

If you have 10+ years of daily data AND intraday features AND large compute budget, revisit this decision. For most commodity intelligence use cases, you do not.

---

## Step 6: Walk-Forward Backtesting

This is where most commodity models fail. The backtesting methodology is more important than the model architecture.

### Why NOT k-Fold Cross-Validation

k-fold CV randomly shuffles data into train/test splits. For time series, this means your model trains on 2024 data to predict 2022 prices. It has already "seen" the future. This inflates accuracy metrics by 10-30% and produces models that fail catastrophically in production.

Do not do this. Ever. For any time series.

### Walk-Forward Protocol

Use expanding-window walk-forward validation:

```
Training window:  |==========|
Predict:                       |>|
                               ^-- day T+horizon

Step forward by step_size (21 trading days = ~1 month)

Training window:  |============|
Predict:                         |>|

Repeat until end of data.
```

Parameters:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Minimum training window | 200 days | ~1 year of daily data; less is unstable |
| Step size | 21 days | Monthly retraining; balances computation vs freshness |
| Horizons | 5d, 21d, 63d | 1 week, 1 month, 1 quarter -- matches procurement decision horizons |

### Metrics

Compute for each model at each horizon:

| Metric | What It Measures | Why It Matters |
|--------|-----------------|----------------|
| MAE | Average absolute error | How far off, on average |
| RMSE | Root mean squared error | Penalizes large errors more heavily |
| Directional accuracy | % of correct up/down calls | Most important for procurement timing |
| MAPE | Mean absolute percentage error | Scale-independent; comparable across commodities |
| sMAPE | Symmetric MAPE | Handles near-zero values better than MAPE |
| P95 absolute error | 95th percentile error | Tail risk -- how bad can it get? |
| Information ratio | mean_error / std_error | Signal-to-noise ratio of predictions |

### Regime Slicing

A model that works in trending markets but fails in range-bound markets is not production-ready. Slice results by:

- **Volatility regime:** low (bottom quartile of 21d realized vol), normal (middle), high (top quartile)
- **Trend regime:** up (21d return > 1%), down (21d return < -1%), range (between)
- **Seasonality:** planting season (Apr-Jun), growing season (Jul-Sep), harvest (Oct-Dec), off-season (Jan-Mar)

Report metrics for each regime separately. The overall average is misleading if performance is concentrated in one regime.

---

## Step 7: Champion Selection

### Composite Score

```
composite = -RMSE + 0.5 * directional_accuracy
```

Why this formula:

- **RMSE** penalizes large errors. A procurement team that over-buys because the model predicted a 10% rally that did not materialize loses real money.
- **Directional accuracy** rewards correct up/down calls. Even if the magnitude is wrong, knowing the direction helps timing.
- **0.5 weight** means you need >10% improvement in directional accuracy to offset a 5% increase in RMSE. This keeps the scoring grounded in error magnitude while rewarding directional skill.

### Selection Rules

1. Champion must beat naive (random walk) on at least one primary metric (RMSE or directional accuracy)
2. Champion must not have >50% P95 error increase vs. naive (tail risk check)
3. If two models tie on composite score, prefer the simpler one (Ridge over boosted stumps)
4. Document the selection rationale -- future you will want to know why

---

## Step 8: Add LLM Intelligence Layer

Statistical models cannot read news. They do not know that India just announced an export ban, or that a hurricane is heading toward the Texas Cotton Belt. An LLM can.

### Two LLM Calls

**1. Sentiment analysis** (classification model, e.g., DistilRoBERTa fine-tuned on financial text)

- Input: RSS headlines from cotton/commodity news sources
- Output: positive/negative/neutral score per headline
- Aggregation: average score over last 24 hours becomes a feature (`sentiment_score`)
- Characteristics: fast inference (~50ms), cheap, stateless

This is the "wisdom of crowds" signal. If 80% of headlines are bearish, that is information the price model does not have.

**2. News reasoning** (instruction-following model, e.g., Qwen 2.5 7B via HF Inference)

- Input: recent headlines + current price context + model forecast
- Output: structured analysis of forward-looking price implications
- Identifies: geopolitical events, supply disruptions, policy changes, weather events
- Can flag when news context should challenge statistical signals

The challenge capability is the key innovation. Example: your heuristic model says AVOID because cotton is at the 99th percentile of its historical range. But the LLM reads that India just banned cotton exports (25% of global supply removed). The correct workflow is to surface that contradiction clearly so a procurement manager can decide whether the news shock justifies buying despite stretched price levels.

### Fallback Chain

LLM APIs are unreliable. Build a fallback chain:

```
Local model stack (primary forecast)
  --> HF analyst forecast (fallback/context)
    --> Heuristic-only (emergency fallback)
```

The system must never fail to produce a signal because an API is down. Degrade gracefully.

---

## Step 9: Build the Unified Signal

Combine all signal sources with a weighted ensemble:

| Source | Weight | Rationale |
|--------|--------|-----------|
| Model forecast | 40% | Walk-forward validated; most rigorous |
| Heuristic | 25% | Simple rules (percentile rank, momentum); robust, no overfitting risk |
| LLM news analysis | 20% | Qualitative context humans value; captures events models miss |
| Sentiment | 15% | Weakest individual signal but orthogonal to the others |

### Confidence Scoring

Confidence comes from source agreement, not from any single model's certainty:

- **All 4 agree** on direction: HIGH confidence
- **3 of 4 agree**: MEDIUM-HIGH confidence
- **2 vs 2 split**: LOW confidence, recommend spreading purchases
- **Model contradicts all others**: flag for human review

When confidence is low, widen the prediction interval and recommend a flatter (more spread-out) procurement schedule. Do not pretend to know more than you do.

---

## Step 10: Strategy Generation

Convert the unified signal into an actionable procurement plan.

### Signal to Allocation

The signal (BUY/HOLD/AVOID) maps to allocation timing using exponential weighting:

| Signal | Allocation Strategy | Intuition |
|--------|-------------------|-----------|
| BUY (prices expected to rise) | Front-load purchases | Buy more now while it is cheap |
| HOLD (no clear direction) | Even distribution | Spread risk across the procurement window |
| AVOID (prices expected to fall) | Back-load purchases | Defer purchases; prices should improve |

### Volatility Adjustment

When volatility is high (regardless of direction), flatten the allocation. High volatility means the model is less certain about the magnitude and timing of moves. Spreading purchases reduces the risk of catching a short-term spike.

### Constraint Integration

Real procurement has constraints: minimum order quantities, supplier lead times, warehouse capacity, letter of credit timing. The strategy engine must respect these. In CMI, we model:

- Total volume requirement over the procurement window
- Maximum single-shipment size
- Minimum days between orders
- Budget ceiling per period

The strategy optimizes within these constraints, not in a vacuum.

---

## Step 11: Build the UI

The UI has one job: help a procurement manager make a better decision in under 60 seconds.

### Core Views

1. **Price chart with forecast overlay:** Historical prices, model forecast with confidence bands (P25/P75), and key event markers. The chart should make the forecast uncertainty visible, not hide it.

2. **Strategy signal with attribution:** The BUY/HOLD/AVOID recommendation, plus a breakdown of what is driving it. "BUY because: model predicts +3.2% (40%), heuristic says undervalued at 22nd percentile (25%), news analysis flags India supply concerns (20%), sentiment bullish (15%)." Attribution builds trust.

3. **Model backtest results:** Visible to users, not hidden in a technical appendix. Show the walk-forward equity curve, directional accuracy by regime, and worst-case errors. Transparency about model limitations builds more trust than hiding them.

4. **Interactive scenario builder:** Let users adjust inputs (volume, timeline, budget) and see how the strategy changes. Procurement decisions involve judgment calls that no model can fully automate.

### Design Principles

- Mobile-first (procurement managers check prices on their phones)
- Dark/light mode (warehouse offices have variable lighting)
- Print-friendly strategy summary (for board presentations and LC applications)
- No login required for read-only access (reduce friction to adoption)

---

## Step 12: Security and Operations

### Rate Limiting

- Per-IP rate limits on all API endpoints
- Per-user rate limits on hosted AI inference
- Payload size validation (reject oversized requests)
- Input sanitization (commodity names, date ranges, numerical inputs)

### Abuse Protection

- Request signature validation
- Geographic rate limiting if needed
- Abuse detection heuristics (burst patterns, unusual query volumes)

### AI Usage Quotas

HF Inference Pro costs money. Implement:

- Daily quota per user for LLM calls
- Graceful degradation to heuristic-only when quota exceeded
- Admin dashboard showing usage trends

### Emergency Kill-Switch

If the model produces obviously wrong signals (e.g., BUY at all-time highs with no fundamental support), you need a way to override it without a code deploy. Implement:

- Feature flag to disable AI signals and fall back to heuristic-only
- Alert when model predictions diverge >2 standard deviations from recent pattern
- Manual override capability for the strategy signal

### Monitoring and Retraining

- **Drift detection:** Monitor input feature distributions weekly. If DXY volatility doubles, the model's learned coefficients may be stale.
- **Prediction monitoring:** Track realized vs. predicted returns. If directional accuracy drops below 50% over a 3-month window, trigger retraining.
- **Retraining cadence:** Monthly walk-forward retrain (automated). Quarterly full model review (human).

---

## Adapting for Another Commodity

To build this for coffee instead of cotton:

| Change | Cotton (current) | Coffee (new) |
|--------|-----------------|--------------|
| Target contract | CT=F (ICE Cotton #2) | KC=F (ICE Coffee C) |
| Acreage competition | Soybean, wheat, corn | Cocoa, sugar (tropical land) |
| Key FX pairs | CNY/USD, INR/USD, BDT/USD | BRL/USD, COP/USD, VND/USD |
| Input cost proxies | MOS (fertilizer), HO=F (diesel) | Same, plus labor indices |
| Weather factor | ENSO (India monsoon) | Brazil frost risk, Colombia rainfall |
| Seasonal features | US planting Apr-Jun, harvest Sep-Nov | Brazil harvest Apr-Sep, Colombia Oct-Jan |
| News RSS feeds | Cotton-specific sources | Coffee-specific sources |
| Substitution signal | Polyester (crude oil chain) | Tea (weak), specialty vs commodity coffee |

Everything else -- architecture, model stack, backtesting protocol, UI, security -- stays identical.

The framework is commodity-agnostic. The domain knowledge is in the factor selection and feature engineering. That is where you spend your time when adapting to a new commodity.

---

## Appendix: Lessons Learned

1. **Look-ahead bias is the silent killer.** We caught a 12% accuracy inflation from a 3-day lag on PMI data. Always audit release lags.

2. **Simpler models win more often than you expect.** Ridge regression beat boosted stumps on 21-day cotton forecasts in our walk-forward tests. Do not skip baselines.

3. **The LLM challenge is the feature users value most.** Statistical signals are table stakes. The ability to say "model says X but news says Y, here is why" is what makes procurement managers trust the system.

4. **Freight matters more than you think.** Container rates added 3-5 cents/lb to CIF cotton cost during the 2021-22 shipping crisis. Ignoring logistics is ignoring 5-10% of the landed cost.

5. **Monthly retraining is the right cadence.** Weekly retraining chases noise. Quarterly retraining misses regime changes. Monthly is the sweet spot for commodity markets.

6. **Transparency beats accuracy.** A model that is 55% directionally accurate but explains its reasoning gets adopted. A model that is 60% accurate but is a black box gets ignored. Build for trust.
