# Visual Tool

The visual dashboard renders cotton price history, benchmark bands, and the current buy signal.

## Run

```bash
python -m scripts.visual_tool
```

## Output

- **File**: `output/cotton_dashboard.png`
- **Contents**:
  - Cotton spot price ($/lb) over time
  - 1Y rolling p25–p75 band (shaded)
  - 1Y median (dashed)
  - Current signal badge (STRONG_BUY / BUY / HOLD / AVOID)
  - Suggested quantity (tons)
  - 30d rolling volatility (log returns)

## Requirements

- `COTTON_DAILY_DATA_LOCAL_FILEPATH` in `.env` pointing to MacroTrends CSV, or
- Data file at `data/cotton_macrotrends_daily.csv`
