# V3: Forecasting Data Dictionary

## Factor Registry

48 features engineered from 21 factor slots. Some slots are live Yahoo/FRED feeds; export sales and ENSO/weather are graceful placeholders until reliable free sources are connected.

| ID | Name | Group | Freq | Lag | Unit | Source | Dir | Economic Mechanism |
|---|---|---|---|---|---|---|---|---|
| `cotton_close` | Cotton #2 Futures | target | daily | 0 | $/lb | Yahoo (CT=F) | +1 | Target variable. ICE Cotton #2 is the benchmark contract for South Asian mill pricing. |
| `dxy` | US Dollar Index | macro | daily | 0 | index | Yahoo (DX-Y.NYB) | -1 | Cotton is USD-denominated. DXY up → cotton expensive for non-USD buyers → demand falls. R ~ -0.3 to -0.6. Lagged features (5d, 21d) capture the 3-7 day repricing delay. |
| `vix` | VIX | macro | daily | 0 | index | Yahoo (^VIX) | -1 | Risk-off proxy. VIX spike → institutional commodity positions unwound → cotton sells off. Also: mills defer procurement under uncertainty. |
| `crude_oil` | WTI Crude Oil | competing | daily | 0 | $/bbl | Yahoo (CL=F) | +1 | Polyester substitution: oil→naphtha→PX→PTA→PET→polyester. Oil up → polyester cost up → cotton demand up. Also drives freight costs. 2-4 week lag through petrochemical chain. |
| `natural_gas` | Natural Gas | competing | daily | 0 | $/MMBtu | Yahoo (NG=F) | +1 | Polyester energy cost proxy. Asian PET plants use NG. Also: cotton ginning/processing energy. Weaker than oil but additive. |
| `us10y` | US 10Y Treasury | macro | daily | 0 | % | Yahoo (^TNX) | -1 | Higher real rates → higher commodity carry cost → sell inventory pressure. Also: tightening policy → risk-off for commodity allocations. |
| `cny_usd` | CNY/USD | macro | daily | 0 | CNY/USD | Yahoo (CNY=X) | -1 | China consumes ~30% of global cotton. CNY weakness → cotton expensive for Chinese mills → demand falls. Most important cotton FX pair after DXY. |
| `inr_usd` | INR/USD | macro | daily | 0 | INR/USD | Yahoo (INR=X) | -1 | India is the largest cotton producer (~25% global). INR weakness → Indian cotton cheaper in USD terms → increased export competitiveness → supply up → price pressure. Also affects Indian mill import demand for competing fibers. |
| `bdt_usd` | BDT/USD | macro | daily | 0 | BDT/USD | Yahoo (BDT=X) | -1 | Bangladesh is the 2nd largest RMG exporter and a major cotton importer. BDT weakness → cotton more expensive for Bangladeshi mills → demand falls → price down. Primary user-base FX signal. |
| `bdiy` | Baltic Dry Index | freight | daily | 0 | index | Yahoo (^BDI) | +1 | Bulk shipping cost proxy. BDI up → freight cost up → CIF cotton price up. Also signals global trade activity. |
| `container_freight` | Container Freight (ZIM) | freight | daily | 0 | $/share | Yahoo (ZIM) | +1 | Container shipping cost proxy. Cotton moves in containers from origin to South Asian mills. ZIM up → container rates up → CIF cotton cost up. More relevant than BDI for containerized cotton trade. Spiked 300%+ during 2021-22 shipping crisis, adding 3-5 cents/lb to CIF cost. |
| `sp500` | S&P 500 | demand | daily | 0 | index | Yahoo (^GSPC) | +1 | Growth/risk proxy. Equities up → economic expectations up → apparel demand up → cotton demand up. Risk-on supports commodity allocations. |
| `breakeven_5y` | 5Y Breakeven Inflation | macro | daily | 1 | % | FRED (T5YIE) | +1 | Market-implied inflation expectations. Commodities are real assets — inflation up → cotton up ("inflation hedge" signal). |
| `china_pmi_mfg` | China Mfg PMI | demand | monthly | 3 | index | FRED | +1 | China is the world's largest cotton consumer. PMI > 50 = expansion → mills buying → demand up → price up. |
| `soybean` | Soybean Futures | competing | daily | 0 | $/bu | Yahoo (ZS=F) | -1 | **Strongest structural cross-commodity signal.** US Cotton Belt farmers choose between cotton and soybeans. Soybean up → less cotton acreage → supply down → cotton up (6-9mo lag). Cotton/soybean ratio tracked by every ag desk. |
| `wheat` | Wheat Futures | competing | daily | 0 | $/bu | Yahoo (ZW=F) | -1 | Acreage competition in Southern Plains (TX, OK). Winter wheat and cotton share irrigated acres. Also ag cycle proxy — grain rally → cotton follows via shared input costs. |
| `corn` | Corn Futures | competing | daily | 0 | $/bu | Yahoo (ZC=F) | -1 | Acreage switching in Delta states. Deepest ag futures market = sector barometer. Corn rally → cotton follows via ag sentiment + shared inputs. |
| `fertilizer_proxy` | Fertilizer (Mosaic) | supply | daily | 0 | $/share | Yahoo (MOS) | +1 | Input cost proxy. MOS is the largest US fertilizer producer (DAP, potash). Fertilizer up → production cost up → acreage floor rises → cotton price supported. Also signals global ag input inflation, which flows through to all crop production costs within 1-2 seasons. |
| `diesel` | Heating Oil (Diesel Proxy) | supply | daily | 0 | $/gal | Yahoo (HO=F) | +1 | Farm and logistics cost proxy. Diesel powers tractors, cotton pickers, ginning equipment, and trucking to ports. HO=F is the NYMEX heating oil contract, which tracks ultra-low sulfur diesel closely. Diesel up → production and logistics costs up → cotton price floor rises. |
| `enso_proxy` | ENSO Index | supply | monthly | 30 | index | NOAA/CPC future integration | +1 | El Nino-Southern Oscillation proxy. Currently a placeholder in the live pipeline. La Nina → stronger India monsoon → higher India cotton production (~25% of global supply). El Nino → weaker monsoon → drought risk → lower production → price up. |
| `us_cotton_exports` | US Export Sales | supply | weekly | 7 | 1000 bales | USDA FAS | +1 | Weekly export pace → real-time demand signal. Not yet available programmatically. |

## Direction Key

- **+1 (positive)**: Factor up → cotton price up
- **-1 (inverse)**: Factor up → cotton price down

## Why These Specific Factors

Every factor is included because it captures a documented economic mechanism:

| Mechanism | Factors | Evidence |
|-----------|---------|----------|
| **Acreage competition** | Soybean, wheat, corn | USDA Prospective Plantings data shows direct substitution |
| **Polyester substitution** | Oil, natural gas | Petrochemical chain: oil→PET→polyester→cotton demand |
| **USD denominator effect** | DXY, CNY/USD, INR/USD, BDT/USD | Cotton priced in USD, 70%+ of buyers are non-USD |
| **Risk appetite** | VIX, S&P 500 | Commodity positions are risk assets in institutional portfolios |
| **Monetary policy** | US 10Y, breakeven inflation | Carry cost, inflation hedge, growth expectations |
| **Trade logistics** | Baltic Dry Index, ZIM (container freight) | Shipping cost component of CIF cotton; containerized and bulk channels |
| **End-use demand** | China PMI, S&P 500 | Mill consumption signals |
| **Input costs** | Fertilizer (MOS), diesel (HO=F) | Production cost floor; acreage decision driver |
| **Weather/climate** | ENSO proxy | India monsoon → 25% of global cotton production |
| **Local FX demand** | INR/USD, BDT/USD | Producer and consumer currency effects on trade flows |

## Lagged Features — Why Cross-Market Lags Matter

| Feature | Lag | Rationale |
|---------|-----|-----------|
| `dxy_lag_5d`, `dxy_lag_21d` | 5d, 21d | Currency moves lead commodity repricing by ~1 week. The repricing mechanism: FX move → import cost recalculation → procurement behavior change → exchange-level price impact. |
| `oil_lag_5d`, `oil_lag_21d` | 5d, 21d | Petrochemical chain takes 2-4 weeks from crude oil price to polyester fiber price. The substitution effect from polyester to cotton is not instantaneous. |
| `vix_lag_5d` | 5d | Volatility shocks propagate to commodities with a delay — institutional rebalancing happens over days, not minutes. |

## Sentiment Feature

`sentiment_score` is reserved in the feature matrix and live sentiment is returned as sidecar context from HF financial sentiment analysis. Do not interpret sentiment as validated model accuracy unless it is actually present in a trained feature path.

## Release Lag

The `release_lag_days` field prevents look-ahead bias in backtesting. Data is only "visible" to the model after the publication delay. This is the single most important design decision for backtest integrity.

## Data Quality Checks

Each factor is assessed on: total points, missing %, staleness (days since last observation), outlier count (>3 standard deviations).

## Environment Variables

| Var | Required | Purpose |
|---|---|---|
| `FRED_API_KEY` | Optional | Enables FRED data series. Free at https://fred.stlouisfed.org/docs/api/api_key.html |
