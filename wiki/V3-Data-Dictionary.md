# V3: Forecasting Data Dictionary

**Issue:** [#24](https://github.com/zayansalman/cotton-market-intelligence/issues/24)

## Factor Registry

| ID | Name | Group | Frequency | Lag (days) | Unit | Source | Direction |
|---|---|---|---|---|---|---|---|
| `cotton_close` | Cotton #2 Futures Close | supply | daily | 0 | $/lb | Yahoo Finance (CT=F) | +1 |
| `dxy` | US Dollar Index | macro | daily | 0 | index | Yahoo Finance (DX-Y.NYB) | -1 |
| `vix` | CBOE Volatility Index | macro | daily | 0 | index | Yahoo Finance (^VIX) | -1 |
| `crude_oil` | WTI Crude Oil | competing | daily | 0 | $/barrel | Yahoo Finance (CL=F) | +1 |
| `natural_gas` | Natural Gas | competing | daily | 0 | $/MMBtu | Yahoo Finance (NG=F) | +1 |
| `us10y` | US 10Y Treasury Yield | macro | daily | 0 | % | Yahoo Finance (^TNX) | -1 |
| `cny_usd` | CNY/USD Exchange Rate | macro | daily | 0 | CNY/USD | Yahoo Finance (CNY=X) | -1 |
| `bdiy` | Baltic Dry Index | freight | daily | 0 | index | Yahoo Finance (^BDI) | +1 |
| `sp500` | S&P 500 | demand | daily | 0 | index | Yahoo Finance (^GSPC) | +1 |
| `breakeven_5y` | 5Y Breakeven Inflation | macro | daily | 1 | % | FRED (T5YIE) | +1 |
| `china_pmi_mfg` | China Manufacturing PMI | demand | monthly | 3 | index | FRED (MPMICNMA669S) | +1 |
| `us_cotton_exports` | US Cotton Export Sales | supply | weekly | 7 | 1000 bales | USDA FAS | +1 |

## Direction Key

- **+1**: Positive correlation with cotton price (factor up → cotton up)
- **-1**: Negative correlation (factor up → cotton down)

## Release Lag

The `release_lag_days` field indicates how many calendar days after the observation date the data becomes publicly available. The pipeline uses this to prevent look-ahead bias during backtesting — data is only "visible" to the model after the lag period.

## Data Quality Checks

Each factor is assessed on:
- **Total points**: Number of observations fetched
- **Missing %**: Percentage of expected observations that are absent
- **Stale days**: Days since last available observation
- **Outlier count**: Points > 3 standard deviations from mean

## Extending the Pipeline

To add a new factor:
1. Add a `FactorFetcher` entry in `src/lib/pipeline/sources.ts`
2. Define the `FactorMeta` with correct frequency, lag, and direction
3. Implement the `fetch()` function returning `DataPoint[]`
4. Update this data dictionary
5. The pipeline runner picks it up automatically

## Environment Variables

| Var | Required | Purpose |
|---|---|---|
| `FRED_API_KEY` | Optional | Enables FRED data series (breakeven inflation, PMI). Free at https://fred.stlouisfed.org/docs/api/api_key.html |
