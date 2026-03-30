# Strategic Procurement (Current MVP)

Core question:

> We need **X tonnes** in **Y months**. What is the best month-by-month buying plan right now?

## Live strategy behavior

The live app combines:
1. **Price regime signals**
2. **Volatility-aware pacing**
3. **Current headline context**
4. **AI reasoning (optional) with deterministic fallback**

## Input

- `company`
- `tonnage`
- `months`
- Real-time price benchmarks
- Current RSS headlines

## Output

- Signal (`STRONG_BUY`, `BUY`, `HOLD`, `AVOID`)
- Confidence score
- Executive summary
- Market analysis
- Monthly purchase tranches (`month`, `%`, `tonnes`, rationale)
- Risk factors
- Next actions
- Key levels (`support`, `fair_value`, `resistance`)

## Decision framework

### Signal logic (fallback path)

- **Cheap regime** (low percentile, negative z-score) → `BUY` or `STRONG_BUY`
- **Expensive regime** (high percentile) → `AVOID`
- **Middle regime** → `HOLD`

### Roadmap shaping

- `STRONG_BUY/BUY`: front-load purchases
- `AVOID`: back-load purchases
- High volatility: flatten allocations to reduce timing risk

### AI enhancement

When OpenAI is configured:
- model receives structured market + headline context
- returns structured JSON strategy for execution and audit trails
- if AI fails, system reverts to deterministic path

## Where this logic lives

- `src/app/api/strategy/route.ts` — orchestration, AI call, fallback
- `src/app/api/prices/route.ts` — benchmark calculations
- `src/app/api/headlines/route.ts` — news ingestion

## Operating guidance

Treat this as **decision support**, not autopilot execution:
- Keep procurement manager override authority
- Log and review strategy outputs by date
- Add approval gates for high-tonnage buys

## Next upgrades

- Basis-aware strategy (futures + local landed cost)
- Supplier/lot constraints in optimization
- Backtest mode for confidence calibration
