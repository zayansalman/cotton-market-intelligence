# Quantitative Rationale: Cotton Market Intelligence

**Document version**: 1.0
**Last updated**: 2026-04-04
**Audience**: Commodity trading desks, quant teams, data science reviewers
**System**: CMI (Cotton Market Intelligence) -- iFarmer procurement analytics

---

## Table of Contents

1. [Price Signal Construction](#1-price-signal-construction)
2. [Volatility Framework](#2-volatility-framework)
3. [Strategy Signal Logic](#3-strategy-signal-logic)
4. [Allocation Model](#4-allocation-model)
5. [V3 Feature Engineering](#5-v3-feature-engineering)
6. [Model Selection](#6-model-selection)
7. [Walk-Forward Backtesting](#7-walk-forward-backtesting)
8. [Release-Lag Alignment](#8-release-lag-alignment)
9. [Prediction Intervals](#9-prediction-intervals)
10. [Financial Sentiment Analysis](#10-financial-sentiment-analysis)
11. [Bangladesh-Specific Rationale](#11-bangladesh-specific-rationale)

---

## 1. Price Signal Construction

The V2 heuristic engine constructs four families of price signals. Each answers a different question, and their combination eliminates blind spots that any single indicator would leave.

### Percentile Rank (1Y, 5Y)

**What it does.** For a given close price, the 1Y percentile rank counts the fraction of daily closes in the trailing 252 trading days that fall below the current price. The 5Y rank does the same over ~1,260 days.

**Why non-parametric ranking over raw price.** Cotton #2 futures exhibit fat tails, regime shifts, and occasional limit moves. The Jarque-Bera test on daily cotton returns since 2000 rejects normality at any conventional significance level. Parametric measures like "price is 1.5 standard deviations below mean" implicitly assume a symmetric, thin-tailed distribution. Percentile rank makes no distributional assumption. It maps any price onto [0, 1] regardless of whether the underlying distribution is skewed, bimodal, or heavy-tailed. For a procurement system that must avoid being wrong in tails, this robustness is non-negotiable.

**Why 1Y and 5Y.** The 1Y window captures the current contract cycle and recent supply/demand fundamentals. It answers "is the price cheap relative to recent history?" The 5Y window spans roughly one full cotton production cycle (planting decisions propagate to supply over 2-3 years) and answers "is the price cheap in structural terms?" A price at the 10th percentile on 1Y but the 50th on 5Y suggests a short-term dip within a secular uptrend -- a different trade than a price at the 10th percentile on both.

**Alternatives considered.** Z-score (included separately), quantile regression, kernel density estimation. KDE and quantile regression add complexity without meaningfully improving signal quality at the daily frequency for a procurement system. The percentile rank is O(n) to compute, trivially interpretable, and impossible to mis-specify.

### Z-Score (1Y)

**What it does.** Standardizes the current price as (price - mean_252d) / std_252d.

**Why include it alongside percentile rank.** The z-score is parametric and captures magnitude of deviation. A percentile rank of 0.05 means "below 95% of recent prices" but says nothing about how far below. A z-score of -2.5 versus -1.2 both map to low percentiles but represent very different opportunities. The z-score encodes distance from center in units of recent volatility.

**When each dominates.** In normal, mean-reverting markets, the z-score is a better signal because the Gaussian approximation is reasonable and the magnitude information is actionable. In trending or structurally breaking markets (trade wars, COVID supply shocks), the percentile rank is more robust because the z-score's assumption of stationarity breaks down. The heuristic strategy uses both jointly (rank < 0.15 AND z < -1) to require agreement between the non-parametric and parametric views.

### 50-Day and 200-Day Moving Averages

**Why 50 and 200.** These are the most widely tracked moving average windows in commodity markets. The 50d approximates a quarter's trading activity; the 200d approximates a year's. Their ubiquity creates self-fulfilling dynamics: when CTAs and trend-followers use 50/200 crossovers as systematic signals, the crossovers themselves move flow. This is not a flaw but a feature -- we want to measure what the market measures.

**Golden cross / death cross.** The system tracks `above_ma_50d` and `above_ma_200d` as boolean flags and computes `ma_cross_50_200` as the continuous spread (50d MA minus 200d MA). The continuous version is preferred over the binary because it preserves information about the strength of the trend. A spread of +$0.02 versus +$0.08 are both "golden crosses" but represent very different convictions.

**Alternatives considered.** Exponential moving averages (EMA), Hull moving average, adaptive moving averages. EMAs would be marginally more responsive but add a decay parameter that must be tuned. For a procurement advisory system (not a high-frequency trading system), the added responsiveness does not justify the added complexity. Simple moving averages are also deterministic and trivially reproducible.

### 30-Day and 90-Day Momentum

**What it does.** Percentage change in price over 30 and 90 calendar days (approximately 21 and 63 trading days).

**Why these lookbacks.** The 30d momentum captures the current month's direction and is the most common reporting interval in commodity procurement (monthly review cycles). The 90d momentum captures the current quarter and aligns with import credit tenors and seasonal patterns. Together they detect momentum-trend divergence: positive 90d but negative 30d suggests a pullback within an uptrend, which is a distinct procurement signal from a broad sell-off.

**Interaction with mean-reversion signals.** Momentum and mean-reversion signals are intentionally kept separate. The heuristic engine does not attempt to synthesize them into a single score because their relative predictive power depends on the volatility regime. In low-vol, range-bound markets, mean-reversion signals dominate. In trending, high-vol markets, momentum signals dominate. The allocation model handles this interaction through volatility dampening rather than through signal fusion.

---

## 2. Volatility Framework

### Realized Volatility via Daily Returns

**Computation.** Daily log-returns are computed as `(close_t - close_{t-1}) / close_{t-1}`. The rolling standard deviation of these returns over a window of N days is annualized by multiplying by sqrt(252), where 252 is the standard convention for trading days per year.

**Why sqrt(252) and not sqrt(365).** Volatility scales with the square root of time under the assumption of i.i.d. returns (which is approximately true at daily frequency for variance scaling, even though returns themselves are not i.i.d.). The correct scaling factor is the number of *trading* days, not calendar days, because weekends and holidays contribute zero variance. Using 365 would overstate annualized volatility by approximately 20%.

**Why not EWMA or GARCH.** Exponentially weighted moving average (EWMA) volatility gives more weight to recent observations, which makes it more responsive to vol regime changes. GARCH(1,1) models volatility clustering explicitly. Both are superior estimators of conditional volatility. However, this system runs in a stateless TypeScript environment with no persistent model state. GARCH requires maximum likelihood estimation on each request, which is computationally expensive and fragile in a serverless context. EWMA requires a decay parameter (typically 0.94 per RiskMetrics) that introduces another tunable. The simple rolling standard deviation is deterministic, stateless, and sufficient for the purpose of regime classification (not option pricing, where GARCH matters).

### 30% Annualized Volatility Threshold

**Why 30%.** Cotton #2 futures have exhibited annualized 30d volatility ranging from roughly 12% (quiet periods, 2018) to 60%+ (COVID disruption, 2020; post-COVID rally, 2021-2022). The long-run median is approximately 22-25%. A threshold of 30% sits roughly 1 standard deviation above the median volatility of volatility and marks the boundary between "normal market conditions" and "dislocated/stressed conditions" where execution risk becomes material.

**What happens at the boundary.** The system does not use a hard cutoff in the allocation model. When vol > 30%, the allocation weights are blended 70% toward the computed weights and 30% toward uniform. This is a continuous function of the vol threshold flag, not a discontinuous jump. The 30% threshold triggers the blending; it does not create a cliff.

### Three-Bucket Regime Classification

**Why 3 buckets (low/normal/high).** The V3 feature engineering uses a finer classification for model conditioning: `vol_regime` = 0 (low, <20% annualized), 1 (normal, 20-35%), 2 (high, >35%). Three regimes are chosen because they map to economically distinct procurement environments:

- **Low vol (<20%):** Tight ranges. Mean-reversion works. Procurement can be deliberate.
- **Normal vol (20-35%):** Standard market. Standard procurement cadence.
- **High vol (>35%):** Dislocated. Execution risk is high. Spread purchases. Reduce position size per tranche.

Two regimes would conflate normal and high, which is dangerous. Four or more would fragment the training data within each regime, making regime-conditional evaluation unreliable.

---

## 3. Strategy Signal Logic

### Heuristic Decision Thresholds

The heuristic engine classifies market state into four signals: STRONG_BUY, BUY, HOLD, AVOID. The logic is:

```
rank < 0.15 AND z < -1   --> STRONG_BUY  (confidence 80)
rank < 0.30              --> BUY          (confidence 65)
rank > 0.80              --> AVOID         (confidence 70)
else                     --> HOLD          (confidence 50)
```

**Why both rank and z for STRONG_BUY.** STRONG_BUY triggers aggressive front-loading. Getting this wrong is costly (building inventory at the top). Requiring both conditions (bottom 15th percentile AND more than 1 standard deviation below mean) creates a dual-confirmation gate. The rank ensures the price is historically cheap in distribution terms. The z-score ensures it is meaningfully below the mean, not just at the bottom of a very tight range (where rank < 0.15 could be triggered by a few basis points of movement).

**Why rank < 0.15 and not 0.10 or 0.20.** At rank < 0.10, the signal fires too rarely (~25 days per year) to be actionable in a monthly procurement cycle. At 0.20, the signal includes too many marginal observations. The 0.15 threshold fires roughly 38 days per year, which means it typically activates during 2-3 distinct windows per year -- matching the natural rhythm of "attractive entry points" in cotton markets.

**Why z < -1 and not -1.5 or -2.** At z < -2, the condition is too restrictive and would miss many genuine opportunities. At z < -0.5, it is too permissive and dilutes the signal. The -1 threshold corresponds to approximately the 16th percentile of a normal distribution, which harmonizes with the rank < 0.15 condition.

### Asymmetric Thresholds

**BUY triggers at rank < 0.30 but AVOID only at rank > 0.80.** This asymmetry is intentional and reflects the asymmetric risk profile of a cotton spinning mill. Running out of cotton is catastrophic (production stops, fixed costs continue, customer orders default). Overpaying for cotton is painful but survivable (margin compression). Therefore, the system is biased toward buying too early rather than deferring too long. The BUY zone (0.15-0.30) is wider than the AVOID zone (0.80-1.0) because the cost of false negatives (missing a genuine buying opportunity) exceeds the cost of false positives (buying slightly early).

### Confidence Scoring

**Why 80/65/50/70 and not continuous.** Continuous confidence scores would imply a precision the heuristic does not possess. These are four distinct confidence tiers that communicate degree of conviction to the end user (a procurement manager). The values are calibrated by the following logic:

- **STRONG_BUY at 80:** Dual confirmation (rank + z-score). Historically reliable as a contrarian entry.
- **BUY at 65:** Single condition. Reasonable conviction but not as strong.
- **HOLD at 50:** No directional signal. Confidence is at the coin-flip baseline.
- **AVOID at 70:** Strong signal (price is historically expensive), but higher confidence than HOLD because the extreme rank provides genuine information. A price at the 85th percentile is genuinely expensive. The confidence exceeds HOLD because the signal is not absence of information (HOLD) but presence of a directional warning (AVOID).

---

## 4. Allocation Model

### Exponential Weighting for BUY/STRONG_BUY

**Formula.** `weight_i = exp(-0.3 * i)` where `i` is the month index (0-indexed).

**Why exponential decay.** Linear front-loading (e.g., allocating 40/30/20/10 over 4 months) creates an even spread. Exponential decay concentrates purchasing more aggressively in the first months, which is correct when the signal says "price is cheap." The first month receives disproportionate weight because: (a) the signal is strongest at the point of measurement, (b) price signals decay as new information arrives, and (c) the opportunity cost of delay is asymmetric (price can rally quickly, but procurement lead-times are fixed).

**Why lambda = 0.3.** The decay constant controls how aggressively front-loaded the plan is. At lambda = 0.3 over a 6-month horizon:
- Month 1 weight: exp(0) = 1.00 (normalized ~26%)
- Month 3 weight: exp(-0.6) = 0.55 (normalized ~14%)
- Month 6 weight: exp(-1.5) = 0.22 (normalized ~6%)

This produces a roughly 4:1 ratio between the first and last months. At lambda = 0.1, the ratio would be 1.6:1 (too flat -- barely distinguishable from uniform). At lambda = 0.5, the ratio would be 12:1 (too aggressive -- puts nearly all volume in month 1, which creates execution risk). Lambda = 0.3 balances urgency with practical execution constraints (warehouse capacity, LC limits, shipping schedules).

### Back-Loading for AVOID

**Formula.** `weight_i = exp(0.3 * i)` -- the mirror image.

**Rationale.** When price is expensive, time is the mill's ally. Deferring procurement bets on mean-reversion and/or the arrival of new supply (harvest). The exponential back-loading ensures minimal immediate commitment while keeping the plan responsive to changing conditions (each month's allocation can be re-evaluated against fresh signals).

### Volatility Dampening

**Formula.** When vol > 30%: `weight_i = 0.7 * base_weight_i + 0.3`

**Why blend toward uniform.** High volatility means the directional signal is less reliable. Even if the rank says "cheap," a 35% annualized vol market can move 5-7% in a week, making the current "cheap" reading potentially transient. Blending 30% toward uniform (the `+ 0.3` term before renormalization) acts as a Bayesian prior toward "we don't know" while still respecting the 70% weight on the directional signal.

**Why 70/30 and not 50/50 or 90/10.** The 70/30 split reflects a judgment call: even in high-vol, the directional signal retains most of its information (the rank is still computed over a 1Y window that encompasses the high-vol period). Going to 50/50 would effectively neutralize the signal, which defeats the purpose. Going to 90/10 would provide insufficient dampening in genuinely dislocated markets.

### Uniform Allocation for HOLD

The null hypothesis. When no directional signal is present, the optimal strategy under maximum ignorance is to distribute purchases uniformly across the planning horizon. This is the minimax strategy: it minimizes the worst-case outcome over all possible price paths. It also matches the natural interpretation of "HOLD" -- maintain baseline procurement cadence.

---

## 5. V3 Feature Engineering

The V3 prediction stack constructs 48 features across 9 groups from daily aligned data. The groupings reflect the causal structure of cotton price formation.

### Feature Groups and Their Rationale

| Group | Count | Why |
|-------|-------|-----|
| Lag | 3 | Autoregressive structure: past prices predict future prices |
| Momentum | 4 | Trend persistence at multiple horizons |
| Volatility | 3 | Regime conditioning -- models behave differently under different vol |
| Regime | 4 | Categorical state variables for conditional prediction |
| Technical | 4 | Market microstructure signals (RSI, MA cross, distance from extremes) |
| Cross-market | 19 | Macro, intermarket, input cost, FX, freight, and substitution dependencies |
| Calendar | 5 | Seasonality in planting, growing, harvest cycles |
| Sentiment | 1 | NLP-derived market mood from financial news headlines |

### Lag Features (5d, 21d, 63d)

**Why these specific lags.** The lags correspond to weekly (5 trading days), monthly (21 trading days), and quarterly (63 trading days) horizons. These are the standard reporting and decision-making cadences in commodity procurement. The 5d lag captures short-term autocorrelation (mean-reversion at the weekly scale). The 21d lag captures monthly patterns (option expiry effects, first-notice-day dynamics in futures). The 63d lag captures quarterly seasonality (USDA quarterly reports, import planning cycles).

**Alternatives considered.** Daily lags (1d, 2d, ..., 10d) are commonly used in time-series models but would create highly collinear features with minimal marginal information. The three chosen lags span three distinct time scales with low mutual correlation.

### Momentum (5d to 126d Returns)

**Why percentage returns over price levels.** Raw price levels are non-stationary (they drift and trend). Percentage returns are approximately stationary, which is a requirement for standard regression and tree-based models. Using raw prices would cause the model to learn level-dependent relationships that break when prices move to new ranges. Stationarity is enforced by the transformation, not assumed from the data.

**Why 4 lookbacks (5d, 21d, 63d, 126d).** These span week, month, quarter, and half-year momentum. Short-term momentum (5d) captures microstructure and order flow persistence. Long-term momentum (126d) captures structural trends. The combination allows the model to detect momentum divergences (short-term down, long-term up) that are among the most informative patterns in commodity markets.

### Rolling Volatility (10d, 21d, 63d)

**Why three windows.** A single volatility estimate conflates regime changes with normal fluctuation. The 10d window is responsive to sudden vol spikes (limit moves, reports). The 21d window is the standard monthly estimator. The 63d window is stable and captures the ambient volatility environment. A model that sees all three can detect vol term structure changes (short-dated vol spiking while long-dated vol is stable suggests a transient event, not a regime change).

### RSI-14

**Why 14 periods.** The 14-day RSI is a Wilder (1978) convention adopted universally. Like the 50/200 MA, its ubiquity makes it self-reinforcing. Traders watch RSI-14; when it crosses 30 or 70, flow follows.

**What signal RSI adds over raw momentum.** RSI normalizes momentum to a [0, 100] bounded scale. A 5% weekly return means something very different in a low-vol environment (extreme) versus a high-vol environment (normal). RSI implicitly adjusts for this by comparing gains to losses over the lookback window. It is, in effect, a volatility-adjusted momentum oscillator.

### MA Cross (50d minus 200d)

**Why the continuous spread over a binary flag.** A binary "golden cross yes/no" discards information. The spread tells the model how much the short-term trend exceeds the long-term trend. A spread of +$0.01 (barely golden) versus +$0.05 (strong uptrend) should produce different predictions. The continuous value preserves this gradient.

### Cross-Market Ratios (Cotton/DXY, Cotton/Oil)

**Why ratios rather than raw levels.** The cotton/DXY ratio isolates the "real" price of cotton after removing the mechanical effect of USD strength. When the dollar strengthens, cotton (denominated in USD) tends to fall, but this is a currency effect, not a fundamental supply/demand signal. The ratio strips this out. Similarly, the cotton/oil ratio provides a relative-value signal between competing fibers (polyester is an oil derivative; when oil rises relative to cotton, polyester becomes more expensive, which supports cotton demand). Ratios are also more stationary than levels.

### Calendar Features

**Why cotton seasonality matters.** Cotton is an annual crop with a deterministic production calendar:

- **March-May (Northern Hemisphere planting):** Uncertainty peaks. Weather risk is priced in. Prices are volatile.
- **June-September (growing season):** USDA crop condition reports drive weekly moves.
- **October-December (US harvest):** New supply arrives. Basis narrows. Prices tend to weaken.

The `is_harvest_season` and `is_planting_season` binary flags allow the model to condition on these structural periods. The `month` and `quarter` features capture finer seasonality (e.g., January tender season, August pre-harvest procurement).

### Vol Regime and Trend Regime as Categorical Features

**Why categorical, not continuous.** The regime variables are designed as discrete state indicators (vol_regime: 0/1/2; trend_regime: -1/0/1) rather than continuous measures because tree-based models partition on thresholds anyway, and the regime boundaries represent genuine economic discontinuities. A market in "low vol" behaves qualitatively differently from one in "high vol" -- the relationship between features and target changes. Encoding this as a discrete state variable allows the model to learn regime-conditional relationships.

---

## 6. Model Selection

### Why Start with Baselines

Four baselines are implemented: Naive (random walk, predicts zero return), Historical Mean, Moving Average (21d), and Seasonal Naive (same-month average). These are not decorative. They are the honest null hypothesis.

If a machine learning model cannot beat "predict zero return" on out-of-sample data, it has negative value. This is common in financial forecasting. Starting with baselines and requiring that any deployed model beats naive on RMSE enforces intellectual honesty and prevents the trap of deploying a model that is complex but useless.

### Ridge Regression (L2 Regularization)

**Why L2 over L1 (Lasso).** Financial features are correlated by construction (cotton_ret_5d and cotton_ret_21d share 5 days of returns; cotton_vol_10d and cotton_vol_21d share 10 days of data). Lasso (L1) performs variable selection by driving coefficients to exactly zero. In the presence of multicollinearity, Lasso's selection is unstable -- it arbitrarily picks one of two correlated features and drops the other, and this selection changes with small perturbations of the data. Ridge (L2) shrinks all coefficients toward zero without forcing any to exactly zero, which is more stable when features are correlated. For a system that needs reproducible, interpretable results, L2 stability is preferred over L1 sparsity.

**Why lambda = 0.01.** The regularization penalty is `lambda * n * sum(beta_j^2)`, where n is the sample size. At lambda = 0.01, the penalty is mild -- just enough to stabilize the normal equations inversion and prevent multicollinearity from causing explosive coefficients. This was chosen empirically: at lambda = 0.001, the model overfits (test RMSE increases); at lambda = 0.1, the model underfits (coefficients are shrunk too aggressively and the model degenerates toward predicting near-zero returns). Lambda = 0.01 sits in the "goldilocks zone" for this feature set.

**Prediction clamping.** Ridge predictions are clamped to [-0.5, +0.5] (i.e., max predicted return of +/-50%). This prevents the linear model from producing physically implausible predictions when it encounters feature values outside the training distribution.

### Gradient Boosted Stumps

**Why single-split stumps instead of deep trees.** A decision stump makes exactly one split: "if feature_j <= threshold, predict A; else predict B." Deep trees (depth 3+) capture higher-order feature interactions but are prone to overfitting on the small, noisy datasets typical of financial time series. With ~800-1000 training samples and 48 features, a deep tree ensemble would memorize noise. Single-split stumps are high-bias, low-variance learners. Gradient boosting accumulates many weak learners, each explaining a small piece of residual signal. This is the classic bias-variance trade-off: prefer low variance when signal-to-noise is low.

**Why 50 rounds.** Each boosting round adds one stump. With a learning rate of 0.1, the effective contribution of each stump is dampened: `prediction += 0.1 * stump_prediction`. After 50 rounds, the cumulative contribution is at most 50 * 0.1 = 5 units of stump output. Empirically, train loss stops improving meaningfully after ~40-60 rounds on this dataset. 50 rounds balances training time (O(n * p * 20 quantiles * 50 rounds), feasible in <1 second for n ~ 1000) with model expressiveness.

**Why learning rate = 0.1.** A lower learning rate (0.01) would require more rounds to converge (500+), increasing latency. A higher rate (0.3+) would cause individual stumps to overfit to residuals, making the ensemble less stable. The value 0.1 is a well-established default in the gradient boosting literature (Friedman 2001) and works well for financial datasets with moderate sample sizes.

### Elastic Net (L1+L2 Regularization)

**Why add elastic net alongside Ridge.** Elastic net combines L1 (Lasso) and L2 (Ridge) penalties. In a 48-feature space with correlated groups, pure L2 keeps all features but may spread weight too thinly. Pure L1 is unstable with correlated features. Elastic net provides the best of both: L1 drives truly uninformative features to zero (effective feature selection), while L2 stabilizes the coefficients among correlated survivors. This is particularly valuable when the feature space has grown from the original design, as some features may be redundant.

**Mixing parameter.** The L1/L2 ratio is set to favor L2 (alpha ~ 0.1-0.3 on the L1 side), keeping the model closer to Ridge behavior while allowing mild sparsity. This was tuned via walk-forward validation.

### Gradient Boosted Trees (Depth 3)

**Why add deeper trees alongside stumps.** Stumps capture single-variable threshold effects. Depth-3 trees capture three-way conditional interactions -- for example, "high vol AND low momentum AND harvest season" -- that stumps cannot represent without many more rounds. With 48 features and ~1000 samples, depth-3 is the practical ceiling: depth-4+ trees would have too many leaf nodes relative to sample size.

**Complementary signal.** Stumps and depth-3 trees are deliberately both included because they capture different signal types. The champion selection process (composite score on walk-forward RMSE + directional accuracy) determines which contributes to the ensemble. In practice, stumps tend to win at shorter horizons (5d) while depth-3 trees perform better at longer horizons (63d) where multi-factor conditioning matters more.

### Why NOT Neural Networks / LSTM / Transformers

Three reasons, in order of importance:

1. **Runtime environment.** The system is a stateless Next.js API running on Vercel. There is no Python runtime, no GPU, and no persistent model state. Neural network inference requires either a hosted model API (latency, cost, dependency) or WebAssembly/ONNX inference (complex, still slow for LSTMs). Ridge regression and boosted stumps fit and predict in <100ms in pure TypeScript.

2. **Sample size.** With ~1000-1250 daily observations and 48 features, we are firmly in the "small data" regime where deep learning has no advantage over properly regularized linear models and shallow ensembles. The universal approximation theorem is irrelevant when you do not have enough data to estimate the parameters.

3. **Interpretability.** Ridge coefficients directly indicate which features drive the forecast and by how much. Stump feature splits are similarly interpretable. A procurement manager needs to understand *why* the model says "buy" -- a black-box neural network prediction would not be trusted or acted upon.

### Champion Selection Criterion

The champion model is the non-baseline model with the lowest RMSE on the held-out test set, subject to the constraint that it beats the naive baseline. If no non-baseline model beats naive, naive is deployed -- the system honestly reports "we have no useful prediction" rather than deploying a model that adds noise.

This is deliberately conservative. In financial forecasting, false confidence is worse than admitted ignorance.

---

## 7. Walk-Forward Backtesting

### Expanding Window over Rolling Window

**The choice.** At each step, the model is trained on *all* data from the start up to the current point (expanding window), not a fixed-width recent window (rolling window).

**Why.** Rolling windows discard old data. In cotton markets, rare events (trade wars, pandemics, droughts) may not recur within a rolling window but leave important patterns in the data. An expanding window retains these. The trade-off is regime stationarity: if the data-generating process has changed fundamentally, old data may hurt. In practice, the Ridge regularization and boosted stump ensemble are robust to mild non-stationarity because they do not memorize specific observations.

### Why NOT K-Fold Cross-Validation

K-fold cross-validation randomly assigns observations to folds, violating temporal ordering. A model trained on 2024 data and evaluated on 2022 data has *perfect look-ahead information* -- it has seen the future. This inflates accuracy metrics by 10-30% in financial time-series settings and produces models that appear excellent on paper but fail in production. Walk-forward validation strictly preserves the arrow of time: train on past, test on future, advance, repeat.

### Step Size (21 Trading Days)

The backtest re-trains the model every 21 trading days (~1 calendar month). This matches the procurement review cadence: mills typically reassess procurement strategy monthly. Testing at finer granularity (daily) would be computationally expensive without providing additional insight. Testing at coarser granularity (quarterly) would produce too few evaluation points for reliable statistics.

### Minimum Training Size (200 Days)

Approximately one calendar year of trading data. This ensures the model has seen at least one seasonal cycle before making its first prediction. With 48 features and ~200 observations, Ridge regression has roughly a 6:1 observation-to-feature ratio, which is tight but adequate given L2 regularization.

### Metrics Suite

| Metric | What It Tells You | Why Include It |
|--------|-------------------|----------------|
| MAE | Average magnitude of error | Robust to outliers; interpretable in return units |
| RMSE | Quadratic-weighted average error | Penalizes large errors more; standard loss function |
| MAPE | Scale-independent error | Allows comparison across different price levels |
| sMAPE | Symmetric MAPE | Avoids MAPE's asymmetry (large when actual is near zero) |
| Direction accuracy | % of correct up/down calls | The most commercially relevant metric -- mills care about direction more than magnitude |
| P95 absolute error | Tail risk measure | Answers "how bad can it get?" -- critical for risk management |
| Information ratio | Mean error / std of error | Signal-to-noise of the model's alpha; borrowed from portfolio management |

No single metric tells the full story. A model with low RMSE but 48% direction accuracy is worse than one with slightly higher RMSE and 55% direction accuracy for a procurement system that acts on directional calls.

### Regime Slicing

Walk-forward results are decomposed by vol regime (low/normal/high) and trend regime (uptrend/downtrend/range). This is essential for deployment decisions. A model that excels in low-vol but collapses in high-vol should not be trusted in a high-vol environment. Regime-sliced metrics prevent the Simpson's paradox trap where aggregate metrics look acceptable but hide regime-specific failure.

---

## 8. Release-Lag Alignment

### The Problem: Look-Ahead Bias

Look-ahead bias occurs when a model uses information at time T that was not actually available at time T. In financial backtesting, this is the single most common source of inflated performance. If a model "knows" Monday's USDA export report while predicting Sunday's close, the backtest is worthless.

### How Release-Lag Alignment Prevents It

Each factor in the data pipeline has a `release_lag_days` metadata field specifying how many calendar days after the observation date the data becomes publicly available. The `alignToDaily` function implements the following logic:

For each calendar date in the alignment grid, the function computes the "available date" as `current_date - release_lag_days`. It then forward-fills only those factor observations whose dates fall on or before the available date. The result is that at any point in the alignment, only information that would have been genuinely available to a trader at that point is visible to the model.

For daily market data (cotton close, DXY, VIX), `release_lag_days = 0` because prices are available at market close. For weekly USDA export sales, `release_lag_days = 7`. For monthly China PMI, `release_lag_days = 3`.

### Why This Is the Single Most Important Design Decision

Every other quantitative choice in this system -- feature selection, model architecture, hyperparameters -- is secondary. If the data alignment is contaminated with look-ahead bias, all downstream metrics are fictional. A model that appears to beat naive by 15% in a contaminated backtest may lose money in production. The release-lag alignment is the foundation of honest evaluation.

---

## 9. Prediction Intervals

### RMSE-Based 95% Confidence Interval

**Formula.** `predicted_return +/- (test_RMSE * 1.96)`

**Why this works.** By the central limit theorem, the distribution of prediction errors converges to normality as the sample size grows, provided the errors are independent and identically distributed. The 1.96 multiplier corresponds to the 97.5th percentile of the standard normal distribution, yielding a 95% two-sided interval. With 100+ test observations in a typical walk-forward run, the CLT approximation is reasonable.

**Where it breaks down.** The assumption of i.i.d. errors is violated when errors are serially correlated (common in trending markets) or when error variance is regime-dependent (errors are larger in high-vol regimes). In these cases, the interval is too narrow during high-vol and too wide during low-vol. Additionally, RMSE is a symmetric measure, and cotton returns exhibit positive skew (rallies are faster than declines), so the true interval should be asymmetric.

**Why not quantile regression or conformal prediction.** Quantile regression would produce asymmetric, potentially more accurate intervals but requires fitting separate models for each quantile (10th, 90th), doubling training time and complexity. Conformal prediction provides finite-sample coverage guarantees but requires an exchangeability assumption that is violated by time-series ordering. Both are theoretically superior but add substantial implementation complexity for marginal improvement in a procurement advisory context where the interval is informational (not used for option pricing or VaR calculations).

---

## 10. Financial Sentiment Analysis

### Why NLP Sentiment Adds Signal

Price data reflects the market's consensus. News sentiment captures the narrative that drives the next consensus shift. A USDA report showing lower-than-expected acreage is bullish information that will be priced in, but between publication and full price adjustment, the sentiment signal leads the price signal. For a procurement system that operates on a monthly cadence, this leading indicator effect is valuable.

### Why DistilRoBERTa over Larger Models

The model used is `mrm8488/distilroberta-finetuned-financial-news-sentiment-analysis`, a distilled RoBERTa model fine-tuned on the Financial PhraseBank dataset. Three considerations drove this choice:

1. **Latency.** The model runs on Hugging Face's serverless inference API. Larger models (RoBERTa-large, GPT-class) have 2-5x higher latency. The sentiment analysis runs in parallel with other API calls, and keeping it under 2 seconds prevents it from becoming a bottleneck.

2. **Cost.** Serverless inference is billed per compute-second. DistilRoBERTa is ~60% smaller than RoBERTa-base, translating directly to lower cost per headline batch.

3. **Diminishing returns.** The task is ternary classification (positive/negative/neutral) on short financial headlines. The marginal accuracy gain from a 350M parameter model over a 82M parameter model on this specific task is in the low single digits. The procurement system uses sentiment as one of many inputs, not as a standalone signal.

### Aggregate Scoring

Per-headline sentiment scores (positive, negative, neutral probabilities) are aggregated via weighted average: `aggregate = mean(positive_i - negative_i)` across all headlines. This maps to a [-1, +1] scale where +1 is unanimously bullish and -1 is unanimously bearish. Thresholds of +/-0.1 classify the aggregate as bullish/neutral/bearish.

### Limitations

The model was fine-tuned on Financial PhraseBank, which consists of English-language financial news covering equities, bonds, and general macroeconomics. It has no cotton-specific training data. Terms like "good crop progress" (bearish for cotton prices because it implies abundant supply) may be misclassified as "positive" by a model that associates "good" with positive sentiment. This domain-specific inversion is a known limitation and is mitigated by the system's multi-signal architecture: sentiment is one input among many, not a standalone driver.

---

## 11. Bangladesh-Specific Rationale

### Landed Cost Chain

The landed cost calculator transforms a Cotton #2 futures price (USD/lb) into the effective cost in BDT/kg at a Bangladeshi mill gate. The chain is:

```
Futures (USD/lb)
  + Basis (cents/lb, origin-dependent)
  = Delivered price (USD/lb)
  * 2,204.62 lb/tonne
  = Cotton cost (USD/tonne)
  + Freight (USD/tonne, route-dependent)
  = CIF cost (USD/tonne)
  + Insurance (% of CIF)
  + Import duty (% of CIF + insurance)
  = Pre-wastage cost (USD/tonne)
  / (1 - wastage %)
  = Effective cost (USD/tonne)
  * FX rate (BDT/USD) / 1000
  = Effective cost (BDT/kg)
```

**Why each component matters:**

- **Basis** (default +7 cents/lb): The premium over futures for physical delivery of a specific origin and quality. Ranges from +3c (Indian Shankar-6, prompt) to +15c (US Pima, specialty). This is the most variable component and the one mills negotiate hardest.
- **Freight** (default $85/tonne): Containerized shipping from origin port to Chittagong. Ranges from $40-60 (India, short route) to $80-120 (US Gulf/Brazil). The Baltic Dry Index is included in the feature set as a leading indicator.
- **Insurance** (default 0.5%): Marine cargo insurance. Stable, low-impact component.
- **Duty** (default 1%): Bangladesh customs duty on raw cotton. Currently concessional for the RMG sector. Subject to policy changes.
- **Wastage** (default 1.5%): Ginning, cleaning, and processing loss. Higher for lower-grade cotton (2-3%); lower for combed cotton (0.5-1%).
- **FX** (default 117 BDT/USD): The BDT/USD rate. The taka has been under pressure since 2022; the FX component can swing landed cost by 5-10% independent of cotton prices.

### Import Credit Constraints

Bangladeshi mills purchase cotton on Letter of Credit (LC) terms. The two primary structures are:

- **At sight:** Payment upon document presentation. Lower cost but requires immediate USD liquidity.
- **Usance (90-180 days):** Deferred payment. More common for large orders. The usance period effectively provides free financing but limits total exposure (banks impose LC limits per mill).

LC limits constrain procurement pacing. A mill with a $5M LC limit cannot accelerate purchases beyond what the limit accommodates, regardless of how attractive the price signal is. The allocation model's monthly_plan must be executable within these constraints, which is why even STRONG_BUY does not recommend 100% in month 1.

### Origin Lead-Times

| Origin | Lead Time | Typical Basis | Use Case |
|--------|-----------|---------------|----------|
| India (Shankar-6) | 2-4 weeks | +3 to +7 c/lb | Spot replenishment, standard counts |
| Central Asian (Uzbek) | 4-6 weeks | +5 to +10 c/lb | Mid-staple, seasonal |
| US (Memphis/Texas) | 6-10 weeks | +8 to +15 c/lb | Premium quality, long-staple |
| Brazil | 6-10 weeks | +7 to +12 c/lb | Growing share, good quality/price |
| West Africa (CFA) | 8-12 weeks | +5 to +10 c/lb | Organic, sustainability compliance |

These lead-times interact with the urgency-weighted allocation. When the signal is STRONG_BUY and the mill needs cotton within 4 weeks, only Indian origins are executable. The longer-lead US and Brazilian origins require that the BUY signal persist for 6+ weeks to be actionable. This is why the allocation model does not simply say "buy everything now" -- execution constraints impose a natural pacing.

---

*This document reflects the quantitative architecture as of V3.9 (production monitoring, drift detection, retraining). All thresholds and parameters are documented in the source code and subject to revision based on walk-forward backtest results.*
