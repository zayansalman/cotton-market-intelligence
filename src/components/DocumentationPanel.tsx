"use client";

import { useState } from "react";

const DOCS = [
  {
    id: "overview",
    title: "How It Works",
    content: `## Cotton Market Intelligence — How It Works

### The Problem
Bangladesh spinning mills need to decide WHEN and HOW MUCH cotton to buy. Buy too early at high prices → margin squeeze. Buy too late → stockout. The optimal strategy depends on price levels, momentum, volatility regime, supply/demand fundamentals, and geopolitical context.

### Our Approach
CMI combines four intelligence sources into a unified procurement signal:

**1. Quantitative Model (40% weight)**
Walk-forward validated prediction model trained on 41 features across 8 groups. Uses gradient boosted stumps for non-linear pattern capture. Evaluated with expanding-window backtesting — no future data leakage.

**2. Statistical Heuristic (25% weight)**
Price percentile rank + z-score + volatility regime → signal. Simple, robust, deterministic. Never catastrophically wrong. The honest baseline that any advanced model must beat.

**3. LLM News Analysis (20% weight)**
Qwen 2.5 7B Instruct analyzes headlines for forward-looking price implications. Identifies geopolitical events, supply disruptions, demand shifts. Can OVERRIDE statistical signals when news context demands it (e.g., India export ban makes "AVOID at 99th percentile" wrong).

**4. Sentiment Analysis (15% weight)**
DistilRoBERTa financial sentiment on RSS headlines. Aggregate bullish/bearish/neutral score. Weakest signal but adds information orthogonal to price data.

### The Ensemble
Weighted combination with confidence from source agreement. When all 4 sources agree → high confidence. When they disagree → lower confidence, wider error bands.`,
  },
  {
    id: "data",
    title: "Data Sources",
    content: `## 21 Data Sources (Institutional Grade)

### Market Prices (Yahoo Finance — 12 tickers)
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

### Macro (FRED)
- **5Y Breakeven Inflation** — Inflation hedge signal
- **China Manufacturing PMI** — End-use demand indicator

### News (7 RSS Feeds)
CottonGrower, TextileWorld, USDA, World Bank, Reuters Commodities, ICAC, Fibre2Fashion

### Sentiment (HF AI)
- **DistilRoBERTa** financial sentiment on all headlines → aggregate score`,
  },
  {
    id: "features",
    title: "41 Features",
    content: `## Feature Engineering (50 Features, 9 Groups)

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

### Cross-Market (19): DXY/oil/VIX levels + lagged 5d/21d, ratios, soybean/wheat/corn, fertilizer, diesel, container freight, INR/BDT FX, polyester spread
**Lagged features are key**: DXY at t-5 predicts cotton at t better than DXY at t. Currency repricing takes 3-7 days.
**Input cost ratios**: cotton/fertilizer and cotton/diesel capture farmer profitability — when input costs rise faster than cotton price, acreage contracts.
**Polyester spread**: cotton price minus polyester cost proxy — the actual substitution signal mills use.

### Calendar (5): month, quarter, DOW, harvest flag, planting flag
Cotton has strong seasonality: US planting Mar-May, harvest Oct-Dec.

### Sentiment (1): aggregate HF sentiment score
NLP-derived market mood from financial news headlines.`,
  },
  {
    id: "models",
    title: "Model Stack",
    content: `## 6 Models + 3 HF AI Models

### Baselines (honest null hypothesis)
- **Naive (Random Walk)**: Predicts zero return. If you can't beat this, your model has no value.
- **Historical Mean**: Predicts average training return. Tests if there's a drift.
- **Moving Average (21d)**: Predicts mean of last 21 returns. Simple momentum.
- **Seasonal Naive**: Same-month-last-year return. Tests if seasonality alone has signal.

### Advanced
- **Ridge Regression**: L2-regularized linear model. Handles multicollinearity in 41 correlated features. Lambda=0.01.
- **Gradient Boosted Stumps**: 50 rounds of single-split decision trees (lr=0.1). Captures non-linear feature interactions without deep trees. Best bias-variance trade-off at our sample size (~1000 days).

### HF AI Models
- **Qwen 2.5 7B Instruct**: LLM analyst for news reasoning and price forecasting
- **DistilRoBERTa**: Financial sentiment classification on headlines
- **Chronos T5**: Amazon's time-series foundation model for probabilistic forecasts

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
| **No Database** | Stateless. All data from external APIs. localStorage for client state. Zero ops. |
| **Zod** | Runtime + compile-time safety from one schema definition. |
| **Recharts** | Declarative React charts. Good enough for area/bar/composed. |
| **HF Inference** | Open models, no vendor lock-in, $9/mo Pro. Multi-provider failover. |
| **Vitest** | Native ESM, zero config, fast. |
| **Vercel** | One-click deploy, edge network, serverless functions. |

### Why TypeScript ML?
Ridge regression and gradient boosted stumps in pure TypeScript. A Python quant stack would need a separate microservice, Docker, API gateway. For 41 features and ~1000 training samples, TypeScript models are fast enough (<100ms) and far simpler to deploy.`,
  },
];

export default function DocumentationPanel() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const activeDoc = DOCS.find((d) => d.id === activeTab);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-md px-3 py-1.5 transition-colors"
      >
        Docs
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex">
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
    </div>
  );
}
