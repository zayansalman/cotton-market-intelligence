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
- `wiki/Strategic-Procurement.md` (multi-month purchase roadmap)
- `wiki/Enterprise-DLC.md` (branches, CI/CD, Docker — **no local Python required**)

## Project structure

- **V1 decision stack (canonical)**
  - `src/cotton_prices.py`: MacroTrends + World Bank + FRED CPI alignment and real price series.
  - `src/benchmarks.py`: rolling percentiles, z-scores, volatility, and snapshots.
  - `src/capacity.py`: spindle-based capacity → daily cotton tons → base order quantity.
  - `src/buy_rules.py`: STRONG_BUY/BUY/HOLD/AVOID and quantity scaling.
  - `src/config_loader.py`: load mill profiles and signal thresholds from YAML.
  - `config/mill_profiles.yml`, `config/signals.yml`: configuration inputs.

- **Strategic procurement (multi-month roadmap)**
  - `src/strategic.py`: orchestrates benchmarks → buy signal → news digest → monthly tranche plan → narrative.
  - `src/procurement/roadmap.py`: allocates total tonnes across months using signal, volatility, and news tilt.
  - `src/intelligence/`: RSS headlines, optional **Hugging Face** sentiment (`src/intelligence/hf_nlp.py`, `requirements-ml.txt`), optional OpenAI narrative (`OPENAI_API_KEY`).
  - `config/news_feeds.yml`: RSS URLs for daily scan.
  - `scripts/strategic_run.py`: CLI for “X tonnes in Y months”.
  - `wiki/Strategic-Procurement.md`: business + technical overview.

- **Demo and docs**
  - `notebooks/cotton_v1_core_demo.ipynb`: end-to-end V1 demo.
  - `notebooks/strategic_procurement_demo.ipynb`: roadmap + narrative demo.
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

3. **Optional (recommended for production NLP):** Hugging Face sentiment + optional relevance ranking:

```bash
pip install -r requirements-ml.txt
```

Sets `CMI_USE_HF_NLP` implicitly on when `transformers` is importable. Override with `CMI_USE_HF_NLP=0` for keyword-only. See `src/intelligence/hf_nlp.py` and `wiki/Strategic-Procurement.md`.

4. Create a `.env` file (copy from `.env.example`) with any paths or URLs you need, for example:

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

### Strategic procurement (X tonnes in Y months)

From the repo root, with `COTTON_DAILY_DATA_LOCAL_FILEPATH` in `.env` (or pass `--csv`):

```bash
python scripts/strategic_run.py --company "ACME Spinning" --tonnes 5000 --months 6
```

Add `--json` for machine-readable output. Optional: set `OPENAI_API_KEY` for richer narrative text.

### Notebook

1. Start Jupyter (or VS Code / Cursor Jupyter support) in this repo.
2. Open `notebooks/cotton_v1_core_demo.ipynb` (V1), `notebooks/strategic_procurement_demo.ipynb` (roadmap), or `notebooks/cotton_exploration.ipynb` (legacy).
3. Run the cells to explore prices, benchmarks, and buy decisions.

### Cloud-first: Docker + pipeline dashboard (no local Python)

If you **cannot run Python locally**, use Docker or CI only:

```bash
# Build and open Streamlit UI at http://localhost:8501
docker compose up --build
```

- **Pipeline dashboard:** `dashboard/app.py` — shows DLC stages (config → data → benchmarks → signal → news → roadmap → narrative) and loads `artifacts/pipeline_snapshot.json` when present.
- **Snapshot file (for CI / audit):** `python scripts/write_pipeline_snapshot.py -o artifacts/pipeline_snapshot.json` (after `pip install -r requirements.txt` in any environment with the repo checked out — or run the same job in GitHub Actions).
- **CI/CD:** `.github/workflows/ci.yml` runs `pytest`, `compileall`, writes the snapshot, uploads it as an artifact, and builds the Docker image on every push and PR.
- **Branches & governance:** see `wiki/Enterprise-DLC.md` (`main` / `develop` / `feature/*`, required checks).
- **GitHub Codespaces:** `.devcontainer/devcontainer.json` for a browser-based IDE with Docker.

```bash
make docker-build   # image only
make ci-local         # compile + tests (needs Python)
```

## Notes

- `.env` is git-ignored and should never be committed; keep all secrets and local-only paths there.
- The new `src/` modules are the primary interface going forward; older helpers and notebooks are kept only for historical context and ad-hoc analysis.

## Compliance & auditability (practical)

This is **decision support** tooling. It is designed to be auditable:
- **Deterministic logic**: signals are produced by explicit code + YAML configs.
- **Traceable inputs**: data sources and transformations are documented (see `docs/TOOL_SCOPE_V1.md`).
- **Explainability**: decisions include the metrics used (percentiles, z-scores, vol, base quantity).

If this evolves into a managed service, add: change control, model risk governance (if forecasts are introduced), data lineage, and access controls (principles aligned with FCA/BaFin/SEC expectations for controlled decision systems).
