# Business Case

## Customer problem

Cotton is a major working-capital item for spinning mills. Purchases are frequently made with:
- Limited benchmarks (no clear view of price vs history or real price regimes)
- Poor discipline under volatility (buying into spikes)
- Weak linkage between operations (spindles/yarn mix) and procurement quantity

The result is avoidable cost, inconsistent inventory coverage, and reactive decision-making.

## What changes with this tool

This tool standardizes procurement decisions into:
- **Price context**: cheap/normal/expensive quantified (percentiles, z-scores, real price).
- **Timing policy**: buy/hold/avoid rules that can be configured and backtested.
- **Sizing policy**: order quantity tied to operational capacity and target inventory days.

## Value creation (how mills save money)

The value comes from three levers:
- **Avoid overpaying in high regimes**: reduce purchases when prices are statistically expensive or volatility is elevated.
- **Accumulate in low regimes**: build inventory when prices are cheap and volatility is normal.
- **Right-size inventory**: prevent both stockouts and excessive working-capital lockup by anchoring buys to consumption and a target days policy.

## What V1 is (and is not)

V1 is intentionally:
- **Transparent and auditable** (rules + benchmarks, no black-box model decisions)
- **Configurable** (thresholds and mill profiles in YAML)

V1 is not yet:
- A full trading/hedging platform (ICE futures, basis, FX hedging)
- A forecasting platform (ARIMA/Prophet/foundation models)
- A production system (auth, RBAC, audit logs, approvals)

These are roadmap items once V1 is validated with mill data and decision workflows.

