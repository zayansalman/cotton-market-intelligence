# cmi-notebooks

Cotton price predictions, analytics, and intelligence for business trading decisions. This repo contains Jupyter notebooks plus a small set of reusable Python helpers for proof-of-concept and exploratory analysis.

## Project structure

- `cmi_mt_daily.ipynb`: Daily cotton price notebook. Loads the MacroTrends daily CSV, cleans the series, removes outliers, and visualizes the time series with Plotly.
- `cmi_wb_monthly.ipynb`: Monthly / World Bank commodities notebook. Loads the World Bank monthly commodities Excel, reshapes headers, and provides a macro context around cotton.
- `data_functions.py`: Shared data access helpers (FRED fetching, cotton CSV loader, World Bank commodities loader).
- `util_functions.py`: Generic utilities for column search and Z-score based outlier handling.

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

1. Start Jupyter (or VS Code / Cursor Jupyter support) in this repo.
2. Open one of the notebooks:
   - `cmi_mt_daily.ipynb` for daily price analysis.
   - `cmi_wb_monthly.ipynb` for monthly macro/commodities context.
3. Run all cells from top to bottom. The notebooks will:
   - Load and clean the relevant data from the paths defined in `.env`.
   - Use `data_functions.py` and `util_functions.py` to keep logic reusable.
   - Produce interactive Plotly visualizations and tables for inspection.

## Notes

- `.env` is git-ignored and should never be committed; keep all secrets and local-only paths there.
- The notebooks are intended for exploration, not production deployment, but the helpers in `data_functions.py` and `util_functions.py` are structured so they can be reused in future services or pipelines.
