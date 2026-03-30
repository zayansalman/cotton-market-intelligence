# Cotton Market Intelligence (CMI)

Production MVP for cotton procurement intelligence, deployed on Vercel.

**Live app:** [https://cmi-notebooks.vercel.app](https://cmi-notebooks.vercel.app)

CMI helps a spinning mill answer:
1. Is cotton currently cheap or expensive vs recent history?
2. Should we buy now, phase buys, or delay?
3. If we need X tonnes in Y months, what is the month-by-month buy roadmap?

## Current architecture (live)

- **Frontend:** Next.js (App Router) + React + Tailwind
- **Backend:** Next.js API routes (server-side)
- **Charts:** Recharts
- **Hosting:** Vercel
- **CI:** GitHub Actions (`npm ci` + `npm run build`)

## What the app does today

### 1) Price intelligence (`/api/prices`)
- Pulls Cotton #2 futures (`CT=F`) from Yahoo Finance
- Computes:
  - 1Y/5Y percentile rank
  - 1Y z-score
  - 30d/90d annualized volatility
  - 50d and 200d moving averages
  - 30d/90d momentum

### 2) News ingestion (`/api/headlines`)
- Pulls RSS headlines from cotton/agri sources
- Surfaces latest headlines as context for decisions

### 3) Strategy generation (`/api/strategy`)
- Inputs: company name, required tonnes, horizon months, live benchmarks, headlines
- Output:
  - Signal: `STRONG_BUY | BUY | HOLD | AVOID`
  - Confidence score
  - Executive summary
  - Market analysis
  - Monthly purchase plan (tonnes + % per month)
  - Risks and next actions
  - Key levels (support, fair value, resistance)
- **AI mode:** uses OpenAI if `OPENAI_API_KEY` is configured
- **Fallback mode:** deterministic heuristic strategy (no API key needed)

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional env vars

Create `.env.local`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

If no key is set, the app still works with statistical fallback logic.

## Deploy

### Vercel (recommended)
1. Import this repo in Vercel
2. Deploy branch `develop` (or `main` for production)
3. Add `OPENAI_API_KEY` in Vercel project environment variables

## Repo map (current)

- `src/app/page.tsx` — main dashboard UI
- `src/app/api/prices/route.ts` — market data + benchmarks
- `src/app/api/headlines/route.ts` — RSS ingestion
- `src/app/api/strategy/route.ts` — AI + heuristic strategy engine
- `src/components/*` — charts, cards, signal UI
- `.github/workflows/ci.yml` — build verification

## Roadmap (next)

- Add Bangladesh-specific data feeds and basis overlays
- Add multi-mill scenario comparison
- Add backtesting / decision replay mode
- Add alerting (email/WhatsApp/Slack) on signal changes

## Documentation

See `wiki/Home.md` for current capability summary and planning pages.
