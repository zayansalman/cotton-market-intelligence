# Cotton Market Intelligence Wiki

This wiki explains **why this project exists**, **what it does**, and **how it creates value** for spinning mills.

## Why this exists

Spinning mills often buy cotton with limited decision support:
- Price context is hard to quantify (cheap/expensive vs history, real vs nominal).
- Purchases happen in volatile regimes without a consistent policy.
- Quantity decisions are not tied to spindle capacity and target inventory coverage.

This project turns those choices into a **repeatable, auditable process**.

## What the tool delivers (V1)

- **Benchmarks**: percentiles, z-scores, inflation-adjusted prices, rolling volatility.
- **Buy signal**: STRONG_BUY / BUY / HOLD / AVOID from explicit rule logic.
- **Quantity**: base order quantity derived from mill capacity and inventory policy, scaled by signal strength.
- **Visual output**: a simple dashboard to share internally.

See: `docs/TOOL_SCOPE_V1.md`.

## Where to start

- Business framing:
  - `wiki/Business-Case.md`
  - `wiki/Business-Model.md`
- How it works:
  - `wiki/How-It-Works.md`
- Visual tool:
  - `wiki/Visual-Tool.md`

