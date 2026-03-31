# Cotton Market Intelligence Wiki

This wiki describes the **current live MVP** running on Vercel and the next steps in the product roadmap.

## Live status

- **Production URL:** [https://cmi-notebooks.vercel.app](https://cmi-notebooks.vercel.app)
- **Stack:** Next.js + TypeScript + Vercel
- **Mode:** AI-assisted strategy generation with deterministic fallback

## What is live now

1. **Market benchmarks**
   - Cotton #2 futures via Yahoo Finance
   - 1Y/5Y percentile, z-score, volatility, moving averages, momentum

2. **News layer**
   - RSS ingestion from cotton/agri sources
   - Headline context shown in dashboard and included in strategy request

3. **Procurement strategy engine**
   - Input: company, required tonnes, horizon months
   - Output: signal (`STRONG_BUY/BUY/HOLD/AVOID`), confidence, rationale, monthly roadmap, risks, actions
   - Uses OpenAI when configured; falls back to deterministic heuristic logic

4. **Operator dashboard**
   - Price chart + moving averages
   - Signal badge and analysis text
   - Monthly purchase allocation (chart + table)
   - Download strategy JSON

## Architecture pages

- `wiki/How-It-Works.md` — current technical flow
- `wiki/Strategic-Procurement.md` — strategy logic and decision framing
- `wiki/Enterprise-DLC.md` — agile workflow, CI/CD, branch model
- `wiki/Engineering-Runbook.md` — IDE-agnostic continuation runbook (setup, CI/CD, Vercel dev/prod, release, rollback)

## Context pages

- `wiki/Business-Case.md`
- `wiki/Business-Model.md`
- `wiki/Bangladesh-Market.md`

## Notes

Older docs describing Python CLI / Docker / Streamlit are superseded by the current Vercel stack.

