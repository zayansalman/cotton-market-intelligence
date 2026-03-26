# How It Works (V1)

This page explains the V1 data → benchmarks → signal → quantity pipeline.

## Data inputs

- **Cotton spot (MacroTrends CSV)**: daily $/lb series
- **CPI (FRED)**: used for inflation-adjusted (real) price series
- Optional: **World Bank Cotton A Index** (monthly, forward-filled to daily)

## Benchmarks

Computed on daily history:
- Rolling percentiles (e.g. 1Y and 3Y)
- Rolling z-scores (e.g. 90D and 252D)
- Rolling volatility (e.g. 30D and 90D)
- Real price and indexed real price

## Mill capacity → base quantity

Using spindle count, RPM, yarn count (Ne), efficiency, shifts/day, and waste factor:
- Estimate daily cotton consumption (tons/day)
- Convert target days of inventory + buys per year into a base order size (tons/buy)

## Buy decision

Signal categories:
- `STRONG_BUY`, `BUY`, `HOLD`, `AVOID`

Rules (configurable):
- **Value**: buy more when the price is in a cheap percentile band
- **Volatility filter**: slow down buying if realized volatility is elevated
- Quantity = base quantity × signal multiplier

## Outputs

- A decision object containing:
  - signal
  - reasons
  - suggested quantity
  - underlying benchmark metrics (for auditability)

