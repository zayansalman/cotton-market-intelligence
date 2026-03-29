# CMI — Status & Remaining Work

Updated: 2026-03-29

## What works (proven by tests)

| Component | Tests | Status |
|-----------|-------|--------|
| `buy_rules.py` — value rank → STRONG_BUY/BUY/HOLD/AVOID | 9 | **Passing** |
| `procurement/roadmap.py` — tonnage allocation, signal shaping, vol flattening, news tilt | 11 | **Passing** |
| `intelligence/news.py` — keyword scoring (bearish/bullish) | 4 | **Passing** |
| `intelligence/hf_nlp.py` — FinBERT/multilingual label mapping, blend logic | 9 | **Passing** |
| `intelligence/synthesis.py` — heuristic narrative (no API key) | 7 | **Passing** |
| `pipeline_snapshot.py` — stage enumeration, config check, snapshot structure | 5 | **Passing** |
| CI (`ci.yml`) — compile, pytest, snapshot artifact, Docker image build | — | **Green on develop** |

Total: **47 unit tests**, all passing.

## What works (manual / needs data)

| Component | Notes |
|-----------|-------|
| `strategic.py` — end-to-end orchestration | Needs `COTTON_DAILY_DATA_LOCAL_FILEPATH` CSV. Tested manually in previous sessions. |
| `scripts/strategic_run.py` — CLI | Same data dependency. |
| News RSS fetch | Depends on live internet + feed availability. 5 feeds configured. |
| HF sentiment pipeline | Works when `transformers`+`torch` installed. Tested manually. |
| OpenAI narrative | Works when `OPENAI_API_KEY` set. Falls back to heuristic cleanly. |
| Dashboard (`dashboard/app.py`) | Streamlit app, reads snapshot JSON. Docker image builds in CI. |

## Known gaps

- [ ] **No end-to-end integration test with real data** — would need a fixture CSV or a small synthetic dataset.
- [ ] **Bengali/Bangla feeds** — placeholder only. Need actual RSS URLs from BD textile media.
- [ ] **RSS feed resilience** — some feeds may 403 or timeout; currently silently skipped. Could log warnings.
- [ ] **No authentication for dashboard** — fine for internal/dev, needs auth for production.
- [ ] **No scheduled re-runs** — cronjob or Airflow DAG not built yet.
- [ ] **Merge `develop` → `main`** — `develop` is ahead with all fixes and tests.

## Lessons learned

1. **Test the math, not just the imports.** The news tilt sign bug was only caught by writing a real assertion on tranche ordering.
2. **CI needs explicit PYTHONPATH.** pytest + namespace packages + GitHub Actions needs `PYTHONPATH=.` in the workflow.
3. **Don't ship commented-out placeholder feeds.** Either add real URLs or document the gap clearly.
