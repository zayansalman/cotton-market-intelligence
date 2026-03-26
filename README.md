# cotton-market-intelligence

Cotton market intelligence and cotton buying decision support for spinning mills.

This project exists to help mills answer three questions with quantified, auditable logic:
- **Are we paying a good price?** (benchmarks vs history and real prices)
- **Should we buy now or wait?** (rule-based buy signals with volatility filters)
- **How much should we buy?** (mill capacity → daily consumption → order sizing)

See the wiki for the full business case and operating model:
- `wiki/Home.md`
- `wiki/Business-Case.md`
- `wiki/Business-Model.md`

## Project structure

- **V1 decision stack (canonical)**
  - `src/cotton_prices.py`: MacroTrends + World Bank + FRED CPI alignment and real price series.
  - `src/benchmarks.py`: rolling percentiles, z-scores, volatility, and snapshots.
  - `src/capacity.py`: spindle-based capacity → daily cotton tons → base order quantity.
  - `src/buy_rules.py`: STRONG_BUY/BUY/HOLD/AVOID and quantity scaling.
  - `src/config_loader.py`: load mill profiles and signal thresholds from YAML.
  - `config/mill_profiles.yml`, `config/signals.yml`: configuration inputs.

- **Demo and docs**
  - `notebooks/cotton_v1_core_demo.ipynb`: end-to-end V1 demo.
  - `scripts/visual_tool.py`: matplotlib dashboard and PNG export.
  - `docs/TOOL_SCOPE_V1.md`: V1 scope and assumptions.

- **Legacy engine (kept for reference)**
  - `src/cotton_data.py`, `src/mill_profile.py`, `src/signals.py`, `src/decision_engine.py`
  - `scripts/run_buy_signal.py`, `notebooks/cotton_exploration.ipynb`

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

### Visual dashboard

```bash
python -m scripts.visual_tool
```

Renders a matplotlib dashboard: spot price, 1Y percentile band, current signal, suggested quantity (tons), and 30d volatility. Saves to `output/cotton_dashboard.png`. Requires `COTTON_DAILY_DATA_LOCAL_FILEPATH` in `.env` or data at `data/cotton_macrotrends_daily.csv`.

### Notebook

1. Start Jupyter (or VS Code / Cursor Jupyter support) in this repo.
2. Open `notebooks/cotton_v1_core_demo.ipynb` (V1) or `notebooks/cotton_exploration.ipynb` (legacy).
3. Run the cells to explore prices, benchmarks, and buy decisions.

## Notes

- `.env` is git-ignored and should never be committed; keep all secrets and local-only paths there.
- The new `src/` modules are the primary interface going forward; older helpers and notebooks are kept only for historical context and ad-hoc analysis.

## Compliance & auditability (practical)

This is **decision support** tooling. It is designed to be auditable:
- **Deterministic logic**: signals are produced by explicit code + YAML configs.
- **Traceable inputs**: data sources and transformations are documented (see `docs/TOOL_SCOPE_V1.md`).
- **Explainability**: decisions include the metrics used (percentiles, z-scores, vol, base quantity).

If this evolves into a managed service, add: change control, model risk governance (if forecasts are introduced), data lineage, and access controls (principles aligned with FCA/BaFin/SEC expectations for controlled decision systems).
