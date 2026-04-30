"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

const DOCS = [
  {
    id: "overview",
    title: "How It Works",
    content: `## Cotton Market Intelligence — How It Works

### The Problem
Bangladesh spinning mills need to decide WHEN and HOW MUCH cotton to buy. Buy too early at high prices → margin squeeze. Buy too late → stockout. The optimal strategy depends on price levels, momentum, volatility regime, supply/demand fundamentals, and geopolitical context.

### Our Approach
CMI works like a senior analyst desk: build multiple independent reads of the market, then ask the LLM analyst to synthesize the final call.

**1. Quantitative Model Stack**
The forecast route runs an 8-model TypeScript stack over 48 engineered features. The chosen model reports real train/test metrics and becomes evidence for the analyst.

**2. Statistical Heuristic**
Price percentile rank + z-score + volatility regime -> candidate forecast. Simple, robust, deterministic. The honest baseline that any advanced model must beat.

**3. HF Analyst Synthesis**
Qwen 2.5 7B Instruct ingests the model-stack forecast, heuristic forecast, sentiment, headlines, and cross-market context. It makes the final analyst judgment instead of blindly averaging signals.

**4. Sentiment Analysis**
DistilRoBERTa financial sentiment on RSS headlines. Aggregate bullish/bearish/neutral score. Useful at the margin, but never presented as validated statistical accuracy.

### Fallback Discipline
Forecasts degrade in order: LLM analyst synthesis -> model stack -> deterministic heuristic. Fallback forecasts keep confidence bands, but validation metrics are shown only when they truly came from the model stack.`,
  },
  {
    id: "data",
    title: "Data Sources",
    content: `## Forecast Factors + News

### Market Prices (Yahoo Finance)
- **Cotton #2 (CT=F)** — Target variable, ICE benchmark
- **DXY** — USD index, inverse correlation (R ~ -0.3 to -0.6)
- **WTI Crude Oil (CL=F)** — Polyester substitution chain (oil→naphtha→PX→PTA→PET→polyester)
- **Natural Gas (NG=F)** — Polyester energy cost proxy
- **VIX** — Risk-off/risk-on proxy
- **US 10Y Treasury** — Carry cost, monetary policy signal
- **CNY/USD** — China demand (30% of global cotton consumption)
- **S&P 500** — Growth/risk appetite proxy
- **Soybean (ZS=F)** — Acreage competition (strongest structural cross-commodity signal)
- **Wheat (ZW=F)** — Acreage competition, ag cycle proxy
- **Corn (ZC=F)** — Acreage switching, ag complex barometer

### Input Costs (farmer economics → planting decisions)
- **Mosaic Co (MOS)** — DAP fertilizer cost proxy. Cotton is nitrogen/phosphorus-hungry. Fertilizer up → breakeven up → less acreage.
- **ULSD Diesel (HO=F)** — Farm machinery, ginning, transport costs. Directly affects farmer operating margin.

### Freight (cotton logistics)
- **Baltic Dry Index (^BDI)** — Bulk shipping proxy
- **ZIM Shipping (ZIM)** — Container freight proxy. Cotton moves in containers, not bulk.

### FX (producing + consuming countries)
- **INR/USD** — India (25% of global production AND consumption)
- **BDT/USD** — Bangladesh (largest raw cotton importer, our primary market)

### Macro (FRED, optional)
- **5Y Breakeven Inflation** — Inflation hedge signal
- **China Manufacturing PMI** — End-use demand indicator

### Graceful Placeholders
US cotton export sales and ENSO/weather slots exist in the factor universe, but currently return empty series until reliable free data sources are connected. The pipeline continues when any factor is unavailable.

### News (7 RSS Feeds)
CottonGrower, TextileWorld, USDA, World Bank, Reuters Commodities, ICAC, Fibre2Fashion

### Sentiment (HF AI)
- **DistilRoBERTa** financial sentiment on all headlines → aggregate score`,
  },
  {
    id: "features",
    title: "48 Features, 9 Groups",
    content: `## Feature Engineering (48 Features, 9 Groups)

### Lag (3): cotton_lag_5d, 21d, 63d
Autocorrelation in price series. Cotton shows mean-reversion at weekly scale, momentum at monthly.

### Momentum (4): 5d, 21d, 63d, 126d returns
Percentage returns over price levels (stationarity). Captures trend continuation/reversal.

### Volatility (3): 10d, 21d, 63d realized vol
Annualized via sqrt(252). Regime classification: <20% low, 20-35% normal, >35% high.

### Regime (4): vol_regime, trend_regime, pct_rank_63d, 252d
Market state conditioning. Models need to know "what kind of market is this?"

### Technical (4): RSI-14, MA cross (50-200), distance from 52w high/low
Standard TA signals. RSI-14 captures overbought/oversold. MA cross = trend confirmation.

### Cross-Market (19): DXY/oil/VIX levels + lagged 5d/21d, ratios, soybean/wheat/corn, fertilizer, diesel, container freight, INR/BDT FX, polyester spread, corn return
**Lagged features are key**: DXY at t-5 predicts cotton at t better than DXY at t. Currency repricing takes 3-7 days.
**Input cost ratios**: cotton/fertilizer and cotton/diesel capture farmer profitability — when input costs rise faster than cotton price, acreage contracts.
**Polyester spread**: cotton price minus polyester cost proxy — the actual substitution signal mills use.

### Calendar (5): month, quarter, DOW, harvest flag, planting flag
Cotton has strong seasonality: US planting Mar-May, harvest Oct-Dec.

### Sentiment (1): sentiment_score
Reserved feature column plus live evidence for the LLM analyst from financial news headlines. The app does not claim historical model accuracy from headline sentiment as a standalone signal.`,
  },
  {
    id: "models",
    title: "Model Stack",
    content: `## 8 Models + HF Analyst Context

### Baselines (honest null hypothesis)
- **Naive (Random Walk)**: Predicts zero return. If you can't beat this, your model has no value.
- **Historical Mean**: Predicts average training return. Tests if there's a drift.
- **Moving Average (21d)**: Predicts mean of last 21 returns. Simple momentum.
- **Seasonal Naive**: Same-month-last-year return. Tests if seasonality alone has signal.

### Advanced
- **Ridge Regression**: L2-regularized linear model. Handles multicollinearity in 48 correlated features. Lambda=0.01.
- **Elastic Net (L1+L2)**: Combined L1/L2 regularization. Feature selection with multicollinearity stability in 48-feature space.
- **Gradient Boosted Stumps**: 50 rounds of single-split decision trees (lr=0.1). Captures non-linear feature interactions without deep trees. Best bias-variance trade-off at our sample size (~1000 days).
- **Gradient Boosted Trees (depth 3)**: Deeper trees capture higher-order conditional interactions (e.g., high vol AND low momentum AND harvest season). Complementary signal to stumps.

### HF AI Context
- **Qwen 2.5 7B Instruct**: Final analyst synthesis over candidate forecasts, news reasoning, and cross-market context
- **DistilRoBERTa**: Financial sentiment classification on headlines

### Champion Selection
Composite score: -RMSE + 0.5 * direction_accuracy. Must beat naive on at least one metric. Walk-forward validated, not single-split.`,
  },
  {
    id: "security",
    title: "Security",
    content: `## Security Architecture (6 Layers)

1. **Abuse Protection** — Bot detection (suspicious UA patterns), IP denylist/allowlist, repeat offender escalation, emergency kill-switch (API_KILL_SWITCH=1)
2. **Rate Limiting** — Per-IP sliding window + burst + cooldown per endpoint
3. **Payload Guard** — 512KB max, strict JSON object validation
4. **Schema Validation** — Zod strict mode on all API inputs, no z.any()
5. **Usage Quotas** — Per-IP daily/monthly + global daily AI inference budget
6. **Safe Errors** — No internal details leaked, generic messages only`,
  },
  {
    id: "tech",
    title: "Tech Stack",
    content: `## Technology Choices

| Choice | Why |
|--------|-----|
| **Next.js 16** | Server components + API routes in one deploy. No CORS, shared types. |
| **TypeScript** | Single-language stack including ML models. Deploy simplicity over Python ecosystem. |
| **Serverless Core** | Market data is fetched on demand. localStorage handles client scenarios and alerts. Optional Supabase stores forecast history when configured. |
| **Zod** | Runtime + compile-time safety from one schema definition. |
| **Recharts** | Declarative React charts. Good enough for area/bar/composed. |
| **HF Inference** | Optional final analyst synthesis. Without HF, the app degrades to model-stack or heuristic forecasts. |
| **Vitest** | Native ESM, zero config, fast. |
| **Vercel** | One-click deploy, edge network, serverless functions. |

### Why TypeScript ML?
Ridge regression and gradient boosted stumps in pure TypeScript. A Python quant stack would need a separate microservice, Docker, API gateway. For 48 features and ~1000 training samples, TypeScript models are fast enough (<100ms) and far simpler to deploy.`,
  },
];

export default function DocumentationPanel() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const activeDoc = DOCS.find((d) => d.id === activeTab);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const panel = open && mounted ? createPortal(
    <div className="fixed inset-0 flex" style={{ zIndex: 9999 }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-2xl bg-zinc-900 border-l border-zinc-700 overflow-y-auto">
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4 flex items-center justify-between z-10">
          <h2 className="text-sm font-semibold text-zinc-100">Documentation</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-zinc-400 hover:text-white text-lg"
          >
            x
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 p-4 pb-0">
          {DOCS.map((doc) => (
            <button
              key={doc.id}
              onClick={() => setActiveTab(doc.id)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                activeTab === doc.id
                  ? "bg-blue-600/20 border border-blue-500 text-blue-300"
                  : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {doc.title}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4 prose prose-invert prose-sm max-w-none">
          {activeDoc && (
            <div
              dangerouslySetInnerHTML={{
                __html: activeDoc.content
                  .replace(/^## (.*)/gm, '<h2 class="text-lg font-semibold text-zinc-100 mt-6 mb-2">$1</h2>')
                  .replace(/^### (.*)/gm, '<h3 class="text-sm font-semibold text-zinc-300 mt-4 mb-1">$1</h3>')
                  .replace(/\*\*(.*?)\*\*/g, '<strong class="text-zinc-200">$1</strong>')
                  .replace(/\n\n/g, '</p><p class="text-sm text-zinc-400 mb-2">')
                  .replace(/^- (.*)/gm, '<li class="text-sm text-zinc-400 ml-4">$1</li>')
                  .replace(/\| (.*?) \|/g, (match) => `<span class="font-mono text-xs">${match}</span>`),
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-md px-3 py-1.5 transition-colors"
      >
        Docs
      </button>
      {panel}
    </>
  );
}
