### Cotton Decision Tool – V1 Core Scope

**Objective**: Provide spinning mills with a first version of a quantitative cotton buying aid that combines price benchmarks, mill capacity-based quantities, and simple rule-based buy signals using existing data sources.

### Features in V1

- **Data layer**
  - Daily cotton spot series from MacroTrends via `load_cotton_prices` in `src/cotton_prices.py`.
  - Optional World Bank monthly Cotton A Index forward-filled to daily.
  - CPI from FRED and a CPI-adjusted real cotton spot series.

- **Benchmark layer**
  - Rolling percentiles (1y, 3y) of spot price.
  - Rolling z-scores (90d, 252d) of spot price.
  - Rolling log-return volatility (30d, 90d).
  - Real price indexed to a base year (default 2015).

- **Mill capacity and quantity**
  - Spindle-based mill profile (`MillProfile` in `src/capacity.py`).
  - Daily cotton consumption in metric tons from spindle count, RPM, yarn count, efficiency, shifts, and waste factor.
  - Base order quantity per buy from target inventory days and buys per year, with optional max order cap.

- **Buy signals**
  - Rule-based `STRONG_BUY` / `BUY` / `HOLD` / `AVOID` using:
    - Value: current price percentile vs 1-year history.
    - Volatility: 30d realized volatility vs its median.
  - Quantity scaling by signal strength using `SignalConfig` in `src/buy_rules.py`.

- **Configuration and demo**
  - YAML mill profiles in `config/mill_profiles.yml`.
  - YAML signal thresholds in `config/signals.yml`.
  - Config loaders in `src/config_loader.py`.
  - End-to-end notebook `notebooks/cotton_v1_core_demo.ipynb`.
  - Visual dashboard: `python -m scripts.visual_tool` → `output/cotton_dashboard.png`.

### Explicitly Out of Scope for V1

- ICE futures, basis vs A Index, and multi-origin basis modelling.
- Bangladesh landed cost and FX integration.
- Weather, USDA WASDE, and broader macro factors beyond CPI.
- Advanced forecasting models (ARIMA/Prophet/ML).
- Alerts (email/SMS), dashboards, or API endpoints.

These will be considered for subsequent iterations once V1 is exercised with real mill data.

