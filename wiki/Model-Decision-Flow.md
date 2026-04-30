# How CMI Makes Procurement Decisions -- End-to-End Flow

This document explains the prediction and strategy pipeline: every data source, every feature, every model, and how the live app turns a market forecast into procurement timing support. A reader should be able to distinguish current runtime behavior from target ensemble work.

---

## 1. Data Sources

CMI defines 21 forecasting factor slots across live Yahoo/FRED data and graceful placeholders, plus RSS news feeds for analyst context.

### Yahoo Finance (daily market factors)

| Ticker | Factor ID | What It Is | Why It Matters for Cotton |
|---|---|---|---|
| `CT=F` | cotton_close | Cotton #2 ICE Futures | The target variable. All predictions and signals derive from this. |
| `DX-Y.NYB` | dxy | US Dollar Index | Cotton is USD-denominated globally. USD strength suppresses commodity prices because the same physical commodity costs more in local currency, reducing demand. Inverse correlation is well-documented. |
| `^VIX` | vix | CBOE Volatility Index | Risk appetite proxy. When VIX spikes, commodity speculators de-risk, creating short-term selling pressure independent of fundamentals. |
| `CL=F` | crude_oil | WTI Crude Oil | Polyester is petroleum-derived. When oil rises, polyester costs rise, making cotton relatively cheaper and increasing substitution demand. |
| `NG=F` | natural_gas | Natural Gas | Second polyester energy input. Natural gas is a feedstock for PTA (purified terephthalic acid), a key polyester precursor. |
| `^TNX` | us10y | US 10Y Treasury Yield | Tightening monetary conditions reduce speculative commodity positioning and increase inventory carrying costs for physical traders. |
| `CNY=X` | cny_usd | CNY/USD Exchange Rate | China consumes ~30% of global cotton. CNY depreciation makes imports more expensive for Chinese mills, suppressing demand at the margin. |
| `^BDI` | bdiy | Baltic Dry Index | Freight cost proxy. Rising freight costs affect delivered economics and can change importer demand even when futures are unchanged. |
| `^GSPC` | sp500 | S&P 500 | Broad risk appetite and demand proxy. Cotton demand tracks economic activity with a lag. |
| `ZS=F` | soybean | Soybean Futures | Planting competition. US farmers choose between cotton and soybeans based on relative profitability. Rising soybean prices incentivize acreage switching away from cotton. |
| `ZW=F` | wheat | Wheat Futures | Same planting competition dynamic as soybeans, particularly in the US Southeast. |
| `ZC=F` | corn | Corn Futures | Third competing crop for US acreage allocation. |

### FRED (Federal Reserve Economic Data, 2 series)

| Series | Factor ID | What It Is | Why It Matters |
|---|---|---|---|
| `T5YIE` | breakeven_5y | 5Y Breakeven Inflation Rate | Inflation expectations drive commodity price levels. Cotton is a real asset. Rising inflation expectations are structurally bullish for commodities. |
| `MPMICNMA669S` | china_pmi_mfg | China Manufacturing PMI | Leading indicator for Chinese textile demand. PMI above 50 signals expanding manufacturing, which pulls cotton demand forward. Monthly release, 3-day lag. |

### RSS News Feeds (7 sources)

| Feed | Content | Signal Type |
|---|---|---|
| cottongrower.com | US cotton production, crop conditions | Supply-side fundamentals |
| textileworld.com | Downstream demand, mill activity | Demand-side fundamentals |
| usda.gov | WASDE reports, crop estimates, export data | Official supply/demand statistics |
| blogs.worldbank.org (agriculture) | Global agricultural policy, trade | Macro agricultural context |
| reuters.com (commodities) | Real-time market news, price drivers | Breaking market events |
| icac.org | International Cotton Advisory Committee | Global supply/demand balance |
| fibre2fashion.com | Asian textile industry news | Regional demand intelligence |

Headlines are processed through DistilRoBERTa (financial sentiment fine-tuned) to produce a sentiment score from -1 (bearish) to +1 (bullish).

---

## 2. Feature Engineering Pipeline

Raw data from the sources above is transformed into 48 features across 9 groups. Every feature uses only past and current data -- no look-ahead bias.

### Group 1: Lag Features (3 features)

**What they capture:** Autocorrelation in the cotton price series.

| Feature | Definition |
|---|---|
| `cotton_lag_5d` | Cotton price 5 trading days ago |
| `cotton_lag_21d` | Cotton price 21 trading days ago (1 month) |
| `cotton_lag_63d` | Cotton price 63 trading days ago (1 quarter) |

**Why they exist:** Cotton prices exhibit significant serial correlation. The price 5 days ago contains information about today's price that raw returns do not capture. Lag features give the model a reference frame: "where was the price relative to recent history?"

### Group 2: Momentum Features (4 features)

**What they capture:** Trend continuation and reversal signals.

| Feature | Definition |
|---|---|
| `cotton_ret_5d` | 5-day percentage return |
| `cotton_ret_21d` | 21-day percentage return |
| `cotton_ret_63d` | 63-day percentage return |
| `cotton_ret_126d` | 126-day (6-month) percentage return |

**Why they exist:** Momentum is the most persistent factor in commodity markets. Positive momentum at the 21-day scale tends to persist, while extreme momentum at the 126-day scale tends to revert. The model uses multiple horizons to distinguish trend following from mean reversion regimes.

### Group 3: Volatility Features (3 features)

**What they capture:** Regime classification and execution risk assessment.

| Feature | Definition |
|---|---|
| `cotton_vol_10d` | 10-day realized volatility (annualized, sqrt(252)) |
| `cotton_vol_21d` | 21-day realized volatility (annualized) |
| `cotton_vol_63d` | 63-day realized volatility (annualized) |

**Why they exist:** Volatility regimes fundamentally change how the market behaves. In high-vol regimes (>35% annualized), mean reversion dominates. In low-vol regimes (<20%), trends persist. The model needs to know which regime it is operating in before interpreting momentum signals. Volatility also directly affects procurement strategy: high vol means spreading purchases to reduce execution risk.

### Group 4: Regime Features (4 features)

**What they capture:** Market state conditioning for other features.

| Feature | Definition |
|---|---|
| `vol_regime` | Categorical: 0=low (<20%), 1=normal (20-35%), 2=high (>35%) |
| `trend_regime` | 1=uptrend (MA50 > MA200), -1=downtrend, 0=range |
| `pct_rank_63d` | Percentile rank over 63 trading days |
| `pct_rank_252d` | Percentile rank over 252 trading days (1 year) |

**Why they exist:** A 5% return means different things in different regimes. In a low-vol uptrend, +5% is a strong continuation. In a high-vol downtrend, +5% is a dead cat bounce. Regime features condition the model's interpretation of all other signals.

### Group 5: Technical Features (4 features)

**What they capture:** Standard technical analysis signals used by physical commodity traders.

| Feature | Definition |
|---|---|
| `rsi_14` | 14-day Relative Strength Index (0-100) |
| `ma_cross_50_200` | 50d MA minus 200d MA (golden cross / death cross) |
| `dist_from_52w_high` | Percentage distance from 252-day high |
| `dist_from_52w_low` | Percentage distance from 252-day low |

**Why they exist:** Physical cotton traders use these signals. Self-fulfilling prophecy is real: when enough market participants watch the same levels, those levels become meaningful. RSI extremes (>70, <30) reliably identify short-term reversal zones in commodities.

### Group 6: Cross-Market Features (8 features)

**What they capture:** Inter-market relationships and macro pressures.

| Feature | Definition |
|---|---|
| `cotton_dxy_ratio` | Cotton price / DXY ratio |
| `cotton_oil_ratio` | Cotton price / Crude oil ratio |
| `dxy_ret_21d` | DXY 21-day return |
| `vix_level` | Current VIX level |
| `oil_ret_21d` | Crude oil 21-day return |
| `sp500_ret_21d` | S&P 500 21-day return |
| `cotton_soybean_ratio` | Cotton / Soybean price ratio |
| `cotton_wheat_ratio` | Cotton / Wheat price ratio |

**Why they exist:** Cotton does not trade in isolation. The DXY relationship (inverse) is the single strongest cross-market predictor. The soybean and wheat ratios capture planting competition: when these ratios fall (competitors getting relatively more expensive), farmers shift acreage to soybeans/wheat, reducing future cotton supply.

### Group 7: Lagged Cross-Market Features (6 features)

**What they capture:** Lead-lag relationships where other markets move before cotton reprices.

| Feature | Definition |
|---|---|
| `dxy_lag_5d` | DXY level 5 days ago |
| `dxy_lag_21d` | DXY level 21 days ago |
| `oil_lag_5d` | Crude oil level 5 days ago |
| `oil_lag_21d` | Crude oil level 21 days ago |
| `vix_lag_5d` | VIX level 5 days ago |
| `soybean_ret_21d` | Soybean 21-day return |

**Why they are lagged, not contemporaneous:** Currency moves lead commodity repricing by approximately 1 week. When the dollar strengthens, cotton does not immediately reprice -- physical traders and speculators adjust positions with a delay. Lagged DXY is a stronger predictor of cotton returns than contemporaneous DXY. The same lead-lag dynamic exists for oil (polyester substitution effects take time to manifest in buying behavior) and VIX (risk-off cascades from equities to commodities over days, not hours).

### Group 8: Calendar and Seasonal Features (5 features)

**What they capture:** Cotton's strong seasonal patterns.

| Feature | Definition |
|---|---|
| `month` | Month of year (1-12) |
| `quarter` | Quarter (1-4) |
| `day_of_week` | Day of week (0=Mon, 4=Fri) |
| `is_planting_season` | 1 if March-May (US cotton planting) |
| `is_harvest_season` | 1 if October-December (US cotton harvest) |

**Why they exist:** Cotton has some of the strongest seasonality of any commodity. US planting (Mar-May) introduces supply uncertainty that tends to push prices higher. Harvest (Oct-Dec) increases physical supply, creating seasonal downward pressure. Ignoring seasonality in a cotton model is leaving information on the table.

### Sentiment Feature (1 feature)

| Feature | Definition |
|---|---|
| `sentiment_score` | Aggregate news sentiment from DistilRoBERTa, scaled -1 to +1 |

**Why it exists:** Sentiment captures information that is not yet reflected in price but is embedded in news text. In the live app it is primarily sidecar context and strategy/news input; it should not be interpreted as validated model accuracy unless it is present in a trained model path.

---

## 3. Model Stack

Eight models, from trivially simple to moderately complex. The simple models exist to keep the complex ones honest.

**Live route note:** `/api/prediction` now runs the 8-model TypeScript stack first and reports real train/test metrics when that stack produces the primary forecast. Qwen 2.5 7B runs as analyst context and fallback. If both are unavailable or implausible, a deterministic momentum/mean-reversion heuristic is used.

### Baseline Models (4)

| Model | What It Does | Why It Is Included |
|---|---|---|
| **Naive (last value)** | Predicts tomorrow = today. | The floor. Any model that cannot beat "price stays the same" is useless. If the naive baseline wins, the market is a random walk at that horizon and we should not pretend otherwise. |
| **Historical mean** | Predicts the long-run average. | Tests whether recent price is informative at all. If the mean beats the naive, the market is mean-reverting. If naive beats the mean, the market is trending. |
| **Moving average** | Predicts the n-day average will continue. | Captures simple trend-following. If this beats the naive, trends are tradable at the given horizon. |
| **Seasonal naive** | Predicts this year's price = same calendar day last year. | Tests whether seasonality alone explains future returns. If seasonal beats naive, calendar effects are dominant. |

### ML Models (4)

| Model | What It Does | Why It Is Included |
|---|---|---|
| **Ridge regression** | L2-regularized linear regression on all 48 features. | Captures linear relationships between features and forward returns while handling multicollinearity. With 48 features drawn from overlapping factor groups (momentum and MA features share price data), multicollinearity is guaranteed. Ridge shrinks unstable coefficients toward zero without dropping features entirely. |
| **Elastic net** | Combined L1+L2 regularized linear regression on all 48 features. | Combines Ridge's multicollinearity stability with Lasso's feature selection. In a 48-feature space with correlated groups, elastic net identifies the most informative features while keeping correlated predictors stable. |
| **Gradient boosted stumps** | Gradient-boosted ensemble of depth-1 decision trees. | Captures non-linear interactions that ridge cannot -- for example, "high volatility AND low momentum" behaves differently from either condition alone. Depth-1 trees (stumps) are the minimum viable unit of non-linearity: enough to capture threshold effects without overfitting. Boosting ensembles hundreds of weak learners into a strong predictor. |
| **Gradient boosted trees (depth 3)** | Gradient-boosted ensemble of depth-3 decision trees. | Captures higher-order conditional interactions that stumps miss -- for example, "high vol AND low momentum AND harvest season" is a three-way interaction that depth-1 trees cannot represent. Depth-3 provides complementary signal to stumps while remaining constrained enough to avoid overfitting at ~1000 samples. |

### Hugging Face AI Context (non-blocking)

| Model | Role |
|---|---|
| **DistilRoBERTa** (financial sentiment) | Classifies news headlines as bullish/bearish/neutral. Produces sidecar context and feeds strategy/news analysis when available. |
| **Qwen 2.5 7B Instruct** | Acts as an AI analyst: reads market data and headlines, produces a directional forecast with qualitative reasoning. Used as sidecar context and fallback in `/api/prediction`; strategy uses it when `HF_TOKEN` is configured. |

---

## 4. Walk-Forward Validation

### Why Expanding Window, Not K-Fold

K-fold cross-validation on time series data is invalid. It allows future data to inform past predictions because folds are randomly assigned regardless of temporal order. A model trained on 2024 data and tested on 2023 data is cheating -- it has access to information that did not exist at prediction time.

Walk-forward validation respects temporal ordering:

```
Window 1:  Train [day 0 ........... day 200]  Predict [day 201 ... day 221]
Window 2:  Train [day 0 ................ day 221]  Predict [day 222 ... day 242]
Window 3:  Train [day 0 .................... day 242]  Predict [day 243 ... day 263]
  ...
Window N:  Train [day 0 .............................. day T]  Predict [day T+1 ... T+21]
```

### Configuration

- **Window type:** Expanding (not sliding). The training set grows with each step, giving later windows more data. Expanding windows are more appropriate than sliding windows when the underlying relationships are stable: more data always helps.
- **Step size:** 21 trading days (1 month). Each step advances the prediction origin by one month, generating ~60 out-of-sample test points over 5 years.
- **Horizons:** 5-day (1 week), 21-day (1 month), 63-day (1 quarter).

### Regime Slicing

Walk-forward results are sliced by volatility regime (low/normal/high) and trend regime (up/down/range) to identify conditional model performance. A model that works in low-vol uptrends but fails in high-vol downtrends is dangerous because high-vol downtrends are exactly when you need accurate forecasts most.

### Accuracy Scorecard

Each model receives a traffic-light rating per horizon:

- **Green:** Beats naive baseline, directional accuracy > 55%, RMSE below threshold.
- **Amber:** Beats naive on one metric but not all three.
- **Red:** Fails to beat naive on any metric.

The scorecard is the evaluation framework. The live route selects a champion from the trained stack and then applies plausibility checks before a forecast reaches the UI. Fallback paths explicitly report that no historical model validation metrics are claimed.

---

## 5. Signal Combination

`computeUnifiedSignal` supports a four-source target ensemble. The live prediction endpoint currently treats the model-stack forecast as primary and shows Qwen/sentiment as sidecar context. The live strategy endpoint wires heuristic, sentiment, and news-analysis legs; the model and LLM forecast legs are not yet connected to strategy.

### Target Source Weights

| Source | Weight | Rationale |
|---|---|---|
| **Model forecast** | 40% | Highest weight because it is the only source validated against real out-of-sample data via walk-forward. It processes 48 features across 9 groups and has proven it can beat the naive baseline. Data-rich, statistically tested. |
| **Benchmarks/heuristic** | 25% | Simple percentile rank and z-score logic. Cannot be catastrophically wrong because the rules are transparent and well-understood. Acts as a sanity check on the model. If the model says BUY but the heuristic says AVOID, confidence drops. |
| **LLM analyst** | 20% | Has access to qualitative context that no statistical model can process: geopolitical events, trade policy changes, weather forecasts, USDA report interpretation. The signal is valuable but noisy and not validated against historical data. |
| **Sentiment** | 15% | Weakest signal individually but adds information orthogonal to price. Sentiment captures what the market is thinking before it finishes acting. Low weight because NLP on short headlines is inherently noisy. |

### Why These Specific Weights

The weights follow an inverse relationship to model complexity and overfitting risk:

- The heuristic (25%) is dead simple and cannot overfit. It gets a high weight relative to its sophistication because reliability matters more than precision.
- The ML model (40%) is more complex but is walk-forward validated, which constrains overfitting risk. It earns the highest weight through demonstrated performance.
- The LLM (20%) is the most complex component and the hardest to validate historically. It gets a meaningful but not dominant weight.
- Sentiment (15%) is a single scalar derived from noisy NLP. Useful at the margin, dangerous if overweighted.

### Confidence Computation

Confidence is computed from source agreement, not from any single source's self-reported confidence:

```
agreement = (sources agreeing with ensemble direction) / (total active sources)
confidence = min(0.95, agreement * 0.7 + 0.3)
```

This means:
- All 4 sources agree: confidence = min(0.95, 1.0 * 0.7 + 0.3) = 0.95
- 3 of 4 agree: confidence = min(0.95, 0.75 * 0.7 + 0.3) = 0.825
- 2 of 4 agree: confidence = min(0.95, 0.5 * 0.7 + 0.3) = 0.65
- Split: confidence = 0.65 (floor, because even a random split produces 50% agreement)

The floor of 0.30 prevents zero-confidence signals. The cap of 0.95 prevents false certainty.

### Signal Mapping

The ensemble's weighted return maps to procurement signals:

| Weighted Return | Signal |
|---|---|
| > +2% | STRONG_BUY |
| > +0.5% | BUY |
| -0.5% to +0.5% | HOLD |
| < -0.5% | AVOID |

### Graceful Degradation

When a source is unavailable, the app degrades rather than blocking the user. `/api/prediction` uses model stack -> Qwen -> heuristic. `/api/strategy` uses Hugging Face when available and falls back to the constraint-aware heuristic.

---

## 6. Strategy Generation

The strategy engine translates price regime, volatility, headline context, and purchaser constraints into a concrete procurement plan. Full model-stack forecast wiring into strategy is a tracked next step, not current runtime behavior.

### Signal to Allocation Timing

The core principle: **front-load BUY signals, back-load AVOID signals.**

```
BUY/STRONG_BUY:  Exponential decay weighting
                 Month 1 gets the most tonnage, each subsequent month gets less.
                 Rationale: locking in a good price today eliminates execution risk.

AVOID:           Exponential growth weighting
                 Month 1 gets the least tonnage, each subsequent month gets more.
                 Rationale: defer purchases when price is elevated.

HOLD:            Uniform weighting
                 Equal tonnage each month.
                 Rationale: no strong signal, maintain baseline cadence.
```

The exponential weighting uses a decay factor of 0.3:
- BUY: `weight[i] = exp(-0.3 * i)` (front-loaded)
- AVOID: `weight[i] = exp(0.3 * i)` (back-loaded)

### Volatility Adjustment

When 30-day annualized volatility exceeds 30%, the allocation is flattened:

```
adjusted_weight[i] = 0.7 * original_weight[i] + 0.3
```

This pulls extreme allocations toward uniform, spreading purchases across months to reduce execution risk in volatile markets. A mill should not commit 60% of tonnage in month 1 when the price could swing 5% in a week.

### Constraints Adjustment (V2 Purchaser Input)

The raw allocation is modified by purchaser-specific constraints:

- **Timeline urgency:** Short horizons compress the allocation curve.
- **Credit limits:** LC opening delays may prevent month-1 front-loading even on a STRONG_BUY.
- **Quality/origin constraints:** Origin-specific lead times shift the allocation forward to account for shipping.
- **Warehouse capacity:** Physical storage limits cap any single month's delivery.

### Decision Transparency

When the unified-signal overlay is available, strategy responses include `decision_drivers` showing what each active source contributed. The full four-leg example below is the target shape:

```
decision_drivers: [
  {
    source: "Quantitative Model",
    weight: 0.40,
    direction: "up",
    magnitude: 0.018,
    reasoning: "Walk-forward champion predicts 1.80% return (confidence: 72%)"
  },
  {
    source: "Statistical Heuristic",
    weight: 0.25,
    direction: "up",
    magnitude: 0.015,
    reasoning: "Percentile/z-score heuristic: BUY"
  },
  {
    source: "AI Analyst (LLM)",
    weight: 0.20,
    direction: "up",
    magnitude: 0.012,
    reasoning: "Qwen predicts 1.20% return based on seasonal tailwinds"
  },
  {
    source: "News Sentiment",
    weight: 0.15,
    direction: "flat",
    magnitude: 0.002,
    reasoning: "Headline sentiment: neutral (0.10)"
  }
]
```

This allows any user to trace the final BUY signal back through the ensemble to each data source and understand exactly why the system made that recommendation.

---

## 7. Full System Flow Diagram

```
                        RAW DATA SOURCES
  +------------------+  +----------------+  +------------------+
  | Yahoo Finance    |  | FRED           |  | RSS Feeds (7)    |
  | factor feeds     |  | T5YIE          |  | cottongrower     |
  | CT=F, DXY, VIX,  |  | MPMICNMA669S   |  | textileworld     |
  | CL=F, NG=F, ^TNX |  |                |  | usda, worldbank  |
  | CNY=X, ^BDI,     |  |                |  | reuters, icac    |
  | ^GSPC, ZS=F,     |  |                |  | fibre2fashion    |
  | ZW=F, ZC=F       |  |                |  |                  |
  +--------+---------+  +-------+--------+  +--------+---------+
           |                    |                     |
           v                    v                     v
  +----------------------------------------------------------+
  |              runPipeline() -- parallel fetch               |
  |  Promise.allSettled -> graceful partial failure             |
  |  Release-lag alignment -> forward-fill to daily index      |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              buildFeatures() -- 48 features                |
  |                                                            |
  |  [lag] [momentum] [volatility] [regime] [technical]        |
  |  [cross-market] [lagged cross-market] [calendar]           |
  |  [sentiment]                                               |
  +---------------------------+------------------------------+
                              |
           +------------------+------------------+
           |                                     |
           v                                     v
  +--------------------+               +--------------------+
  | trainAndEvaluate() |               | HF AI Context      |
  |                    |               |                    |
  | 4 baselines:       |               | DistilRoBERTa      |
  |   naive, mean,     |               |   -> sentiment     |
  |   MA, seasonal     |               |                    |
  |                    |               | Qwen 2.5 7B        |
  | 4 ML models:       |               |   -> analyst       |
  |   ridge, elastic   |               |      context       |
  |   net, GBM stumps, |               |                    |
  |   GBM trees        |               |                    |
  | Walk-forward       |               |                    |
  | validation         |               |                    |
  | (expanding window, |               |                    |
  |  21-day step)      |               |                    |
  +--------+-----------+               +---------+----------+
           |                                     |
           v                                     v
  +----------------------------------------------------------+
  |              Live Forecast + Strategy Signals              |
  |                                                            |
  |  Prediction: model stack primary, Qwen/heuristic fallback  |
  |  Strategy: heuristic baseline + sentiment/news overlay     |
  |  Target: four-source computeUnifiedSignal integration      |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              Strategy Generation                           |
  |                                                            |
  |  Signal -> allocation timing (front/back-load)             |
  |  Volatility -> flatten if vol > 30%                        |
  |  Purchaser constraints -> adjust for credit, warehouse     |
  |                                                            |
  |  Output:                                                   |
  |    signal, confidence, executive_summary,                  |
  |    monthly_plan[], risk_factors[], next_actions[],          |
  |    key_levels, decision_drivers[]                           |
  +---------------------------+------------------------------+
                              |
                              v
  +----------------------------------------------------------+
  |              Client (React 19 SPA)                         |
  |                                                            |
  |  StrategyResults: signal badge, executive summary,         |
  |    monthly plan table, risk factors, decision driver       |
  |    breakdown showing each source's contribution            |
  |                                                            |
  |  ForecastOverlay: prediction chart with confidence band    |
  |  PriceChart: 5Y price with MA overlays and forecast line   |
  +----------------------------------------------------------+
```

---

## Appendix: Feature Count by Group

| Group | Count | Features |
|---|---|---|
| Lag | 3 | cotton_lag_5d, cotton_lag_21d, cotton_lag_63d |
| Momentum | 4 | cotton_ret_5d, cotton_ret_21d, cotton_ret_63d, cotton_ret_126d |
| Volatility | 3 | cotton_vol_10d, cotton_vol_21d, cotton_vol_63d |
| Regime | 4 | vol_regime, trend_regime, pct_rank_63d, pct_rank_252d |
| Technical | 4 | rsi_14, ma_cross_50_200, dist_from_52w_high, dist_from_52w_low |
| Cross-market | 19 | cotton_dxy_ratio, cotton_oil_ratio, dxy_ret_21d, vix_level, oil_ret_21d, sp500_ret_21d, cotton_soybean_ratio, cotton_wheat_ratio, fertilizer_level, diesel_level, container_freight_level, inr_usd_level, bdt_usd_level, cotton_fertilizer_ratio, cotton_diesel_ratio, polyester_spread, corn_ret_21d, wheat_ret_21d, soybean_ret_21d |
| Calendar/seasonal | 5 | month, quarter, day_of_week, is_harvest_season, is_planting_season |
| Sentiment | 1 | sentiment_score |
| **Total** | **48** | + forward returns (fwd_return_5d/21d/63d) as targets |
