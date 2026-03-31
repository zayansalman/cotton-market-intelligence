# Price Prediction Roadmap (V3)

This page tracks the full issue-driven implementation plan for institutional-grade cotton price prediction.

## Program objective

Deliver reliable cotton price forecasts that combine:
- quantitative market and macro factors
- qualitative signals from news, politics, and policy
- supply-side regional/farming/production drivers
- demand-side end-user and textile consumption drivers
- lagged correlations, seasonality, and regime-aware effects

The program must include robust backtesting, explicit current-model accuracy rating, and live forecast visualization on the landing page chart.

## Epic

- [#23 V3: Global cotton price prediction program (quant + qualitative, institutional-grade)](https://github.com/zayansalman/cotton-market-intelligence/issues/23)

## Workstream tracker

| Sequence | Issue | Workstream | Primary deliverable |
|---|---|---|---|
| 1 | [#24](https://github.com/zayansalman/cotton-market-intelligence/issues/24) | Predictor research | Complete factor universe and source map (including additional required factors) |
| 2 | [#25](https://github.com/zayansalman/cotton-market-intelligence/issues/25) | Data foundation | Multi-source, release-lag-aware forecasting dataset |
| 3 | [#26](https://github.com/zayansalman/cotton-market-intelligence/issues/26) | Feature engineering | Lagged, regime, and seasonal signal library |
| 4 | [#27](https://github.com/zayansalman/cotton-market-intelligence/issues/27) | Model development | Baseline + advanced quant model stack and champion selection |
| 5 | [#28](https://github.com/zayansalman/cotton-market-intelligence/issues/28) | Backtesting | Walk-forward performance report (no leakage) |
| 6 | [#29](https://github.com/zayansalman/cotton-market-intelligence/issues/29) | Accuracy governance | Current-model rating and production thresholds |
| 7 | [#30](https://github.com/zayansalman/cotton-market-intelligence/issues/30) | API productization | Forecast API contract with uncertainty and metadata |
| 8 | [#31](https://github.com/zayansalman/cotton-market-intelligence/issues/31) | UX delivery | Landing-page chart forecast overlay + confidence bands |
| 9 | [#32](https://github.com/zayansalman/cotton-market-intelligence/issues/32) | Operations | Drift monitoring, retraining cadence, rollback posture |

## Release gates

V3 should be considered production-ready only when:
1. Backtest quality is published with horizon/regime slices.
2. Current model has an explicit rating against defined thresholds.
3. Forecast and confidence bands are visible in the landing page chart.
4. Monitoring and retraining controls are active.

## Working mode

Use issue-driven execution and branch naming:
- `feature/<issue-id>-<short-slug>`

Each PR should link the issue (`Refs #<id>` or `Closes #<id>`) and include test evidence.
