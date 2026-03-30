# How It Works (Current MVP)

This page explains the live flow in the Vercel/Next.js app.

## End-to-end flow

1. **Fetch market prices** (`/api/prices`)
2. **Compute benchmarks** (percentiles, z-score, volatility, moving averages, momentum)
3. **Fetch headlines** (`/api/headlines`)
4. **Generate procurement strategy** (`/api/strategy`)
5. **Render dashboard** (`src/app/page.tsx`)

## 1) Market data

Source:
- Yahoo Finance chart endpoint for Cotton #2 futures (`CT=F`)

Normalization:
- Converts cent quotes to $/lb when needed
- Filters null values
- Produces a clean time series for charting + analytics

## 2) Benchmark engine

From price history, the app computes:
- 1Y and 5Y percentile rank
- 1Y z-score
- 30d and 90d annualized volatility
- 50d and 200d moving averages
- 30d and 90d momentum
- 1Y high and low

These metrics drive signal generation and roadmap pacing.

## 3) News ingestion

RSS feeds are fetched server-side and parsed into:
- title
- summary
- link
- published timestamp

News is used as context in AI strategy generation and displayed in the UI.

## 4) Strategy logic

Input parameters:
- company
- required tonnes
- horizon (months)
- current benchmarks
- current headlines

### AI mode

If `OPENAI_API_KEY` exists:
- sends structured prompt + current market/news context
- expects strict JSON response with signal + monthly plan + risks/actions

### Fallback mode

If no API key or AI call fails:
- deterministic heuristic computes:
  - signal (`STRONG_BUY`, `BUY`, `HOLD`, `AVOID`)
  - confidence
  - monthly allocation weights
  - key levels and action list

## 5) Dashboard output

The UI displays:
- price chart with MA overlays
- current signal + confidence
- executive summary and market analysis
- month-by-month tonnage roadmap (table + chart)
- risk factors and next actions
- downloadable strategy JSON

## Auditable behavior

- All core calculations are explicit in code
- Fallback path remains deterministic
- API responses are structured and inspectable

