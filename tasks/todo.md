# Strategic procurement build — completed

## Checklist

- [x] Value percentile rank in benchmarks (`value_pct_rank_*d`) and buy rules using rank (not rolling median as “percentile”).
- [x] `AVOID` when value rank > 0.75 in `buy_rules.py` and `signals/buy_rules_v1.py`.
- [x] Procurement roadmap (`src/procurement/roadmap.py`) + orchestrator (`src/strategic.py`).
- [x] News RSS + sentiment tilt; synthesis with heuristic + optional OpenAI; robust JSON parse fallback in `synthesis.py`.
- [x] CLI `scripts/strategic_run.py`, notebook `notebooks/strategic_procurement_demo.ipynb`, `config/news_feeds.yml`, `PyYAML` in `requirements.txt`.
- [x] Docs: `README.md`, `wiki/Strategic-Procurement.md`, `wiki/Home.md`.

## Review

- **So what**: Buyers get a **month-by-month tonne plan** driven by **spot value rank**, **volatility** (damp aggressive tranches when vol spikes), and **headline tilt**, plus an auditable narrative (deterministic by default).
- **Verify locally**: Set `COTTON_DAILY_DATA_LOCAL_FILEPATH`, run `python scripts/strategic_run.py --tonnes 5000 --months 6`.
