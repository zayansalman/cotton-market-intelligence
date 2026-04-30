# Strategic Procurement

Core question:

> We need **X tonnes** in **Y months** with **these constraints**. What is the best month-by-month buying plan right now?

## Strategy behavior

The live app combines:
1. **Final analyst market forecast** from `/api/prediction`
2. **Price regime signals** (percentile, z-score, momentum)
3. **Volatility-aware pacing**
4. **Current headline context**
5. **Purchaser constraints** (V2: quality, timeline, commercial, finance, logistics)

## Input modes

### Basic mode (V1 compatible)
- `tonnage` (tonnes needed)
- `months` (planning horizon)
- Real-time price benchmarks + RSS headlines

### Advanced mode (V2)
Full `PurchaserInput` schema with 6 field groups:
- **Demand**: tonnage, horizon, consumption rate, inventory, safety stock
- **Timeline**: arrival windows, delivery cadence, urgency, receipt capacity
- **Quality**: origins, HVI specs (staple, micronaire, strength, color, trash), ginning, contamination
- **Commercial**: pricing mode, basis target, tolerance, lot rules
- **Logistics**: incoterm, ports, inland delivery, shipment window
- **Finance**: payment terms, credit days, FX, supplier limits, traceability

See [Purchaser-Inputs-Bangladesh](Purchaser-Inputs-Bangladesh.md) for full field reference.

## Output

| Field | V1 | V2 |
|-------|----|----|
| Signal (STRONG_BUY/BUY/HOLD/AVOID) | Yes | Yes |
| Confidence score | Yes | Yes |
| Executive summary | Yes | Yes |
| Market analysis | Yes | Yes |
| Monthly purchase tranches | Yes | Yes |
| Risk factors | Yes | Yes (+ constraint risks) |
| Next actions | Yes | Yes |
| Key levels (support/fair_value/resistance) | Yes | Yes |
| **Binding constraints** | — | Yes |
| **Assumption set** | — | Yes |
| **Constraint risks** | — | Yes |
| **Plan feasibility score** | — | Yes (0–100) |

## Decision framework

### Signal logic (fallback path)

- **Cheap regime** (low percentile, negative z-score) → `BUY` or `STRONG_BUY`
- **Expensive regime** (high percentile) → `AVOID`
- **Middle regime** → `HOLD`

### Roadmap shaping (V1)

- `STRONG_BUY/BUY`: front-load purchases (exponential decay)
- `AVOID`: back-load purchases (exponential growth)
- High volatility (>30%): flatten allocations to reduce timing risk

### Constraint adjustments (V2)

- **Urgency** (urgent/emergency): multiplies early-month weights
- **Receipt capacity**: caps front-loading when mill can't absorb fast
- **Strict quality** (2+ tight specs): smooths allocation to reduce execution pressure
- **Short credit** (≤90d): dampens early concentration
- **Single origin**: flagged as supply concentration risk

### AI enhancement

When an HF token is configured:
- `/api/prediction` first synthesizes quant model, heuristic, sentiment, news, and cross-market evidence into a final analyst forecast
- Strategy receives that final market forecast plus structured market, headline, and constraint context
- Returns structured JSON strategy
- If AI fails, system reverts to deterministic path

OpenAI is not currently wired into the strategy route. Keep docs and environment configuration aligned with the live `huggingface | heuristic` provider set until an OpenAI execution path is implemented.

## Scenario management (V2)

- **Save** full input + strategy as named scenario (localStorage)
- **Compare** two scenarios side-by-side (allocations, feasibility, risks)
- **Replay** with refreshed market data
- **Export/import** scenario JSON for backup/sharing

## Where this logic lives

| Module | Purpose |
|--------|---------|
| `src/app/api/strategy/route.ts` | API orchestration, request parsing, AI calls |
| `src/lib/schemas/purchaser-input.ts` | PurchaserInput zod schema + presets |
| `src/lib/schemas/strategy-request.ts` | V2 request parsing + legacy detection |
| `src/lib/engine/constraints.ts` | Constraint evaluation + pacing multipliers |
| `src/lib/engine/heuristic-v2.ts` | V2 heuristic strategy with constraint awareness |
| `src/lib/engine/feasibility.ts` | Plan feasibility scoring |
| `src/lib/engine/assumptions.ts` | Bangladesh origin lead-times + credit stress |
| `src/lib/scenarios/store.ts` | localStorage scenario CRUD |

## Operating guidance

Treat this as **decision support**, not autopilot execution:
- Keep procurement manager override authority
- Log and review strategy outputs by date
- Add approval gates for high-tonnage buys
- Use scenario comparison to explore constraint trade-offs before committing
