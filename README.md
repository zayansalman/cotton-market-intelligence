# cotton-market-intelligence

Cotton market intelligence, pricing benchmarks, and buy-signal tooling for spinning mills. This repo contains Jupyter notebooks plus a small set of reusable Python helpers and scripts for proof-of-concept and exploratory analysis.

## Project structure

- `src/cotton_data.py`: external data loaders and basic metrics (MacroTrends daily, World Bank monthly, FRED CPI/PPI).
- `src/mill_profile.py`: spinning mill representation and capacity/consumption logic.
- `src/signals.py`: price benchmarks, CPI-adjusted prices, volatility, and buy/hold/avoid signal classification.
- `src/decision_engine.py`: orchestration layer that combines data, signals, and mill profile into a single recommendation.
- `scripts/run_buy_signal.py`: CLI entry point that runs the engine for an example mill and prints a human-readable summary.
- `notebooks/cotton_exploration.ipynb`: curated notebook for exploration and presentations.
- Legacy notebooks and helpers:
  - `cmi_mt_daily.ipynb`, `cmi_wb_monthly.ipynb`, `data_functions.py`, `util_functions.py`, `cotton_buy_tool.py`, `run_buy_signal.py` (kept for reference but superseded by the `src/` modules).

## Setup

1. Create and activate a virtual environment (Python 3.10+ recommended).
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Create a `.env` file in the repo root with any local paths or URLs you need, for example:

```bash
# Local file paths
COTTON_DAILY_DATA_LOCAL_FILEPATH=/path/to/cotton-prices-historical-chart-data.csv
WB_COMMODITIES_DATA_LOCAL_FILEPATH=/path/to/CMO-Historical-Data-Monthly.xlsx

# Optional: remote World Bank URL
WB_COMMODITIES_DATA_FILE_URL=https://thedocs.worldbank.org/en/doc/5d903e848db1d1b83e0ec8f744e55570-0350012021/related/CMO-Historical-Data-Monthly.xlsx
```

## Usage

### CLI (recommended entry point)

1. Ensure `.env` is configured as below.
2. From the repo root, run:

```bash
python -m scripts.run_buy_signal
```

This will:
- Load daily cotton prices from the MacroTrends CSV.
- Fetch CPI from FRED.
- Compute benchmarks and classify a buy/hold/avoid signal.
- Suggest a purchase quantity (bales and kg) for the example mill profile.

### Notebook

1. Start Jupyter (or VS Code / Cursor Jupyter support) in this repo.
2. Open `notebooks/cotton_exploration.ipynb`.
3. Run the cells to:
   - Explore nominal vs real cotton prices.
   - Visualize volatility regimes.
   - Inspect the engine’s recommendations over time for a sample mill.

## Notes

- `.env` is git-ignored and should never be committed; keep all secrets and local-only paths there.
- The new `src/` modules are the primary interface going forward; older helpers and notebooks are kept only for historical context and ad-hoc analysis.
