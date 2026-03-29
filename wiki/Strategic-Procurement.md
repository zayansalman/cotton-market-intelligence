# Strategic procurement (roadmap)

This layer answers a **commercial question**, not only “buy today or wait”:

> *We need **X tonnes** of cotton in the next **Y months**. What is the month-by-month purchase plan, grounded in price signals, volatility, and recent headlines?*

## What it does

1. **Price intelligence** — Loads daily spot series, computes benchmarks (including **value percentile rank** vs rolling history, volatility, moving-average momentum).
2. **Spot signal** — `STRONG_BUY` / `BUY` / `HOLD` / `AVOID` with a **near-term suggested order size** scaled by mill capacity (from `config/mill_profiles.yml`).
3. **News digest** — Fetches RSS from `config/news_feeds.yml`. **Keyword** scan (transparent rules) is **blended** with **Hugging Face** sentiment (default: **ProsusAI/finbert** for financial tone). Install `requirements-ml.txt` for transformers. Optional **semantic re-ranking** (`CMI_HF_RELEVANCE=1`) uses `sentence-transformers` to prioritize cotton/commodity-relevant headlines. For **Bengali** feeds, set `CMI_HF_SENTIMENT_MODEL=nlptown/bert-base-multilingual-uncased-sentiment`. The combined score **tilts** roadmap timing (e.g. accelerate cover when flow skews tight / stressful).
4. **Roadmap** — `src/procurement/roadmap.py` spreads the **full X tonnes** across months, blending:
   - signal (front-load vs back-load),
   - volatility (flatten toward a steadier pace when vol is high),
   - news tilt.
5. **Narrative** — `src/intelligence/synthesis.py` produces an executive summary and rationale. With **`OPENAI_API_KEY`** set, it can call OpenAI for a richer write-up; otherwise it uses deterministic heuristics (auditable, no API).

## How to run

1. Configure `.env` with at least `COTTON_DAILY_DATA_LOCAL_FILEPATH` pointing at the MacroTrends cotton CSV (same as the rest of the stack).
2. Optional: `WB_COMMODITIES_DATA_LOCAL_FILEPATH` for World Bank alignment; `OPENAI_API_KEY` + `OPENAI_MODEL` (defaults in code) for LLM narrative.
3. From repo root:

```bash
python scripts/strategic_run.py --company "ACME Spinning" --tonnes 5000 --months 6
```

JSON output for dashboards or logs:

```bash
python scripts/strategic_run.py --tonnes 5000 --months 6 --json
```

## Code map

| Piece | Location |
|--------|-----------|
| End-to-end orchestration | `src/strategic.py` |
| Monthly tranches | `src/procurement/roadmap.py` |
| RSS + sentiment | `src/intelligence/news.py` |
| Narrative | `src/intelligence/synthesis.py` |
| Value rank & benchmarks | `src/analytics/benchmarks_v1.py` (via `src/benchmarks.py`) |

## Governance

This remains **decision support**: deterministic rules and configs are the source of truth; LLM text is optional narration on top. For production, add data lineage, change control, and (if external news/APIs are used) licensing and latency SLAs.
