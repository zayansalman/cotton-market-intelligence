# Business Model

This section describes how a cotton market intelligence + buying decision tool can be monetized and operationalized.

## Primary buyer

- **Spinning mill procurement / GM / CFO** (who owns cotton P&L + working capital)
- Secondary: trading desk, planning team, inventory controller

## Product packaging

### Option A — SaaS subscription (recommended default)

- Tiered pricing by scale:
  - number of spindles / monthly cotton volume
  - number of mills/sites
  - number of supported price sources (ICE/basis/FX add-ons)
- Includes:
  - dashboards + reports
  - alerting
  - configuration management
  - support / onboarding

### Option B — Managed service + savings share

- Lower fixed fee + performance fee based on measurable savings against a benchmark:
  - agreed benchmark index (e.g., Cotton A Index / ICE nearby + basis policy)
  - auditable methodology and exclusions (quality mix changes, force majeure)

### Option C — Enterprise license / on-prem

- For mills with strict data residency/security needs.
- Higher upfront, annual maintenance, integration services.

## Data business model

Data sources tend to split into:
- **Free/public** (World Bank, FRED, some USDA series)
- **licensed** (Cotlook A Index, ICE futures, some origin/basis feeds)

Commercial packaging should separate:
- **Software subscription**
- **Data pass-through costs** (licensed feeds) with transparency

## Key proof points for adoption

- Demonstrate backtested improvement vs current practice:
  - average realized buy price vs baseline strategy
  - inventory coverage stability
  - volatility exposure reduction
- Strong governance:
  - deterministic logic (signals reproducible)
  - versioned configs
  - audit trails for decisions (in production phase)

