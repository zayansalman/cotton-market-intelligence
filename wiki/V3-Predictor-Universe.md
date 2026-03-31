# V3: Cotton Price Predictor Universe

**Issue:** [#26](https://github.com/zayansalman/cotton-market-intelligence/issues/26)

**Objective:** Identify all relevant predictors of cotton futures prices and map data sources, frequencies, lags, and expected directional effects.

---

## Executive Summary

Cotton prices are driven by a complex web of supply, demand, macro, and geopolitical factors. This document catalogs **60+ candidate predictors** across **8 factor groups**, ranked by:
- **Predictive power** (expected correlation strength)
- **Data availability** (free/paid, frequency, lag)
- **Lead time** (when signal becomes available vs price movement)

---

## Factor Groups

### 1. Supply-Side Factors

#### 1.1 Global Production & Acreage

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| USDA cotton acreage intentions (March report) | Annual | 2-3m | High | Excellent | Acreage ↑ → Supply ↑ → Price ↓ (6-9m lag) |
| USDA cotton acreage actual (June report) | Annual | 2m | High | Excellent | Confirmed acreage drives yield expectations |
| USDA yield forecasts (monthly, Aug-Nov) | Monthly | Current | Very High | Excellent | Yield ↓ → Production ↓ → Price ↑ (3-6m lag) |
| Global cotton balance sheet (ICAC/USDA) | Monthly | 2-4w | High | Excellent | Opening stocks, production, consumption, closing stocks |
| China cotton acreage & production | Annual | 2-3m | Medium | Good | 25-30% of global supply; policy-driven |
| India cotton output (IMD surveys) | Seasonal | 1-2m | Medium | Fair | ~25% of global supply; weather-dependent |
| Brazil cotton acreage (CONAB) | Quarterly | 2w | Medium | Good | Growing supplier; lead-time sensitive |

#### 1.2 Weather & Climate

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| US cotton region rainfall (NOAA/USDA) | Weekly | Real-time | High | Excellent | Below-normal rain → yield risk ↑ → Price ↑ (2-4w lag) |
| US cotton belt temperature anomalies | Weekly | Real-time | High | Excellent | Heat stress during bloom → yield loss → Price ↑ |
| India monsoon outlook (IMD) | Seasonal | 2w advance | Very High | Excellent | Monsoon failure → yield ↓ → Price ↑ (4-12w lag) |
| Global drought monitors (NOAA, IRI) | Weekly | Real-time | High | Excellent | Drought in production regions → supply shock |
| El Niño / La Niña index (NOAA) | Monthly | Current | Very High | Excellent | ENSO → regional rain patterns → 6-12m lead |
| Soil moisture anomalies (NOAA/NASA) | Weekly | Real-time | High | Excellent | Low soil moisture → stress → yield loss → lag 4-8w |

#### 1.3 Pest & Disease

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| Boll weevil / aphid pressure reports | Ad-hoc | 2-4w | Medium | Fair | Severe outbreaks → spray costs ↑ / yield ↓ → Price impact 4-8w |
| Cotton leaf curl virus (CLCuV) reports | Ad-hoc | 2-4w | Medium | Fair | India: CLCuV → yield loss → Price ↑ (6-12w lag) |
| Defoliation / crop damage surveys | Monthly | Current | Medium | Fair | Late-season damage → harvest loss → Price ↑ |

#### 1.4 Trade & Policy

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| US cotton export sales reports (USDA FAS) | Weekly | Current | High | Excellent | Export pace → demand signal → Price lead 2-4w |
| US cotton export shipments | Weekly | Current | High | Excellent | Actual shipments confirm demand flow |
| China cotton import tariffs / quotas | Event-driven | Real-time | Very High | Good | Tariff ↑ → China demand ↓ → Global price ↓ (2-8w lag) |
| India cotton export restrictions | Event-driven | Real-time | Very High | Good | Export ban → supply tightness → Price ↑ (1-4w lag) |
| US subsidies / planting incentives | Seasonal | 2-4w | Very High | Excellent | Subsidy changes → acreage intentions (March) → Price lag 6-9m |

---

### 2. Demand-Side Factors

#### 2.1 End-Use Consumption

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| Global mill use (ICAC) | Monthly | 4-6w | High | Excellent | Mill use ↑ → demand ↑ → Price ↑ (2-6w lag) |
| China textile/apparel PMI (Caixin) | Monthly | 1-3d | Very High | Excellent | PMI ↑ → mills buy cotton → Price ↑ (1-4w lag) |
| India spinning capacity utilization | Monthly | 2-4w | High | Good | Utilization ↑ → demand ↑ → Price ↑ (2-4w lag) |
| Bangladesh/Vietnam spinning output | Monthly | 2-4w | Medium | Fair | Production ↑ → upstream cotton demand → Price ↑ (3-8w lag) |
| Global apparel sales (same-store sales, e-commerce) | Weekly/Monthly | 1w lag | Medium | Fair | Retail ↓ → orders ↓ → mill demand ↓ → Price ↓ (4-12w lag) |
| Clothing & textile PMI (major economies) | Monthly | 1-3d | High | Good | PMI ↑ → order growth → mill bookings → Price ↑ (4-12w lag) |

#### 2.2 Inventory Dynamics

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| US cotton stock reports (USDA) | Weekly | 1w | High | Excellent | Stocks ↓ → tightness ↑ → Price ↑ (1-4w lag) |
| China cotton reserves (government data) | Monthly | 2-4w | Medium | Fair | Releases from reserves → supply ↑ → Price ↓ (2-8w lag) |
| Bangladesh/India mill inventory days | Monthly | 2-4w | Medium | Fair | Inventory drawdown → new buys → Price ↑ (2-6w lag) |

---

### 3. Macro & Financial Factors

#### 3.1 Currency & Capital Markets

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| USD index (DXY) | Daily | Real-time | Very High | Excellent | DXY ↑ → commodities ↓ (in other currencies) → Price ↓ (1-3d lag) |
| CNY/USD exchange rate | Daily | Real-time | Very High | Excellent | CNY weakness → China demand ↓ → Price ↓ (1-5d lag) |
| INR/USD exchange rate | Daily | Real-time | High | Excellent | INR weakness → India export competitiveness ↑ → Price ↑ (3-7d lag) |
| Global equity market volatility (VIX) | Daily | Real-time | High | Good | VIX ↑ → risk-off → commodities ↓ → Price ↓ (1-3d lag) |
| Real interest rates (US 10Y TIPS) | Daily | Real-time | High | Excellent | Real rates ↑ → commodity carry costs ↑ → Price ↓ (1-7d lag) |

#### 3.2 Inflation & Pricing

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| CPI / core inflation (major economies) | Monthly | 2-4w | Medium | Excellent | Inflation ↑ → input costs ↑ → Price ↑ (2-12w lag) |
| Energy prices (crude oil, natural gas) | Daily | Real-time | High | Excellent | Oil ↑ → input costs (fertilizer, chemicals, fuel) ↑ → Price ↑ (2-8w lag) |
| Polyester fiber prices | Daily | Real-time | High | Excellent | Polyester ↑ → cotton substitute pressure ↓ → Price ↓ (2-6w lag, weak) |
| Fertilizer prices (urea, DAP) | Weekly | Real-time | High | Good | Fertilizer ↑ → input costs ↑ → farmer sentiment ↓ → acreage ↓ → lag 6-9m |

#### 3.3 Credit & Liquidity

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| LIBOR/SONIA spread (credit stress) | Daily | Real-time | High | Good | Spread ↑ → credit stress → demand ↓ / hoarding ↑ → Price volatile |
| Cotton futures open interest (ICE) | Daily | Real-time | High | Excellent | OI ↑ → liquidity ↑ or spec buying → Price ↑ (short-term) |
| VIX-like commodity volatility | Daily | Real-time | High | Good | Volatility spike → forced liquidations / short covering → Price moves |

---

### 4. Geopolitical & Policy

#### 4.1 Trade Policy & Sanctions

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| US-China trade tension index (tariff announcements) | Event-driven | Real-time | Very High | Good | US tariff threats → China buying surge → Price ↑ (1-4w lag) |
| India-Pakistan tensions / border news | Event-driven | Real-time | High | Fair | Escalation → Pakistan supply risk ↑ → Price ↑ (1-2w lag, weak) |
| Russia/Belarus sanctions status | Event-driven | Real-time | Medium | Fair | Sanctions changes affect potash / fertilizer → cotton input costs |
| Turkey / Central Asia geopolitics | Event-driven | Real-time | Medium | Fair | Instability → logistics/shipping disruption → Price ↑ (2-6w lag, weak) |

#### 4.2 Government Intervention

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| China government cotton purchase announcements | Event-driven | Real-time | Very High | Good | Large purchases → demand signal → Price ↑ (1-3w lag) |
| India government cotton procurement / release | Event-driven | Real-time | Very High | Good | Releases → supply ↑ → Price ↓ (1-4w lag) |
| US farm bill subsidy changes | Seasonal | 2-4w | Very High | Excellent | Subsidy ↑ → acreage ↑ (next year) → lag 6-12m |

---

### 5. Freight & Logistics

#### 5.1 Shipping & Transportation

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| Container freight rates (Shanghai Containerized Freight Index) | Weekly | Real-time | Medium | Good | Shipping ↑ → landed cost ↑ → buyer demand ↓ → Price ↓ (1-4w lag) |
| Bunker prices (HFO, MGO) | Daily | Real-time | High | Good | Fuel ↑ → shipping costs ↑ → landed costs ↑ → demand pressure ↓ |
| Port congestion indices (Shanghai, Rotterdam, Chattanooga) | Weekly | Real-time | Medium | Fair | Congestion → supply backlog → supply uncertainty → Price ↑ (2-4w lag) |
| Suez Canal disruptions / closures | Event-driven | Real-time | Very High | Fair | Closure → Africa/Asia trade disrupted → supply timing → Price ↑ |

---

### 6. News & Sentiment

#### 6.1 Text & Event Signals

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| Cotton/textile news tone (Bloomberg, Reuters, ICAC) | Daily | Real-time | Medium | Fair | Negative sentiment → selling pressure → Price ↓ (1-5d lag) |
| Supply shock event mentions (pest, weather, trade) | Ad-hoc | Real-time | Very High | Fair | Shock event → immediate repricing → Price jump (0-1d lag) |
| Analyst price target revisions | Weekly | Current | Medium | Fair | Target ↑ → buy signals → Price ↑ (1-7d lag, weak) |
| Social media sentiment (cotton-related) | Daily | Real-time | Low | Poor | Unreliable; useful only for extreme sentiment spikes |

---

### 7. Technical & Seasonal Factors

#### 7.1 Seasonality & Calendar

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| Month of year / quarter | Fixed | N/A | N/A | Excellent | Q3-Q4 (harvest) → seasonal price ↓; Q1-Q2 → seasonal price ↑ |
| Days to season change (harvest, planting windows) | Fixed | N/A | N/A | Excellent | Seasonal calendar drives supply/demand rhythm |
| Holidays (Chinese New Year, US holidays) | Fixed | N/A | N/A | Good | Holiday → trading volume ↓ → spreads widen (minor effect) |

#### 7.2 Technical/Market Structure

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| Cotton futures term structure (backwardation/contango) | Daily | Real-time | High | Excellent | Backwardation → tight supply signal → Price ↑ (1-3w lag) |
| ICE cotton futures basis (spot vs futures) | Daily | Real-time | High | Excellent | Basis ↑ → supply tightness → Cash price ↑ (1-2w lag) |
| Cotton options IV (implied volatility) | Daily | Real-time | High | Good | IV spike → market uncertainty → volatility ↑ (1-3w lag) |

---

### 8. Competing/Complementary Commodities

#### 8.1 Fiber & Substitutes

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| Polyester staple fiber (PSF) prices | Daily | Real-time | Medium | Good | PSF ↑ → cotton demand ↑ (substitution) → Price ↑ (weak, 2-6w lag) |
| Acrylic fiber prices | Weekly | Real-time | Low | Fair | Less relevant to cotton directly |
| Synthetic rubber / petroleum prices | Daily | Real-time | Medium | Fair | Oil ↑ → polymer costs ↑ → polyester ↑ → cotton substitute pressure |

#### 8.2 Related Commodities

| Predictor | Frequency | Lag | Lead Time | Quality | Hypothesis |
|---|---|---|---|---|---|
| Wool prices | Monthly | Real-time | Low | Poor | Weak correlation; different market structure |
| Grain prices (corn, wheat) | Daily | Real-time | Low | Fair | Input cost linkage via machinery/fertilizer but weak direct correlation |

---

## Prioritized Feature Universe (Top 25)

Ranked by **predictive power × data availability × lead time**:

### Tier 1: Very High Priority (Build First)

1. **USDA cotton yield forecasts** (monthly, 6-9m lead on production cycle)
2. **China textile PMI** (monthly, 1-4w lead on mill demand)
3. **US cotton acreage (intention + actual)** (annual, 6-9m lead)
4. **Global mill use / ICAC balance sheet** (monthly, 2-6w lead)
5. **US cotton stock reports** (weekly, 1-4w lead)
6. **USD index (DXY)** (daily, 1-3d lead, strong technical signal)
7. **Cotton futures term structure / basis** (daily, 1-3w lead)
8. **US cotton region rainfall / temperature** (weekly, 2-4w lead)
9. **Crude oil prices** (daily, 2-8w lead via input costs)
10. **India monsoon forecast / actual** (seasonal, 4-12w lead)
11. **US cotton export sales pace** (weekly, 2-4w lead)
12. **Real interest rates (10Y TIPS)** (daily, 1-7d lead on carry)
13. **China cotton import tariffs / quotas** (event-driven, 2-8w lead)
14. **Inflation / CPI** (monthly, 2-12w lag)
15. **Global equity volatility (VIX)** (daily, 1-3d lead, risk-off signal)

### Tier 2: High Priority (Build Second)

16. **India cotton output / acreage** (annual, 6-9m lead)
17. **Cotton futures open interest** (daily, short-term signal)
18. **Bangladesh/India mill capacity utilization** (monthly, 2-8w lead)
19. **Clothing/apparel PMI** (monthly, 4-12w lead on orders)
20. **Container freight rates** (weekly, 1-4w lead on landed cost)
21. **Brazil cotton production** (quarterly, 6-9m lead)
22. **India monsoon wind patterns (real-time)** (weekly, 4-8w lead)
23. **China government cotton purchase announcements** (event, real-time impact)
24. **Polyester fiber prices** (daily, weak but notable substitute signal)
25. **Pest/disease reports (CLCuV, boll weevil)** (ad-hoc, 4-8w lead)

### Tier 3: Medium Priority (Build Third)

- Cotton options implied volatility
- India government cotton releases
- Bunker / energy prices
- Fertilizer price trends
- News sentiment (structured)
- Shipping port congestion
- Cross-currency effects (CNY, INR)

---

## Data Sources & Acquisition Map

| Source | Data | Frequency | Lag | Cost | Notes |
|---|---|---|---|---|---|
| **USDA NASS / FAS** | Acreage, yield, exports, stocks | Monthly/Seasonal | 1-4w | Free | Best-in-class; official source |
| **NOAA / NWS** | Weather, rainfall, temperature | Daily/Weekly | Real-time | Free | Official; comprehensive |
| **ICAC (International Cotton Advisory Committee)** | Global balance sheet, mill use | Monthly | 4-6w | Free | Authoritative; subscription available for faster access |
| **Caixin / NBS** | China PMI data | Monthly | 1-3d | Free (Caixin has paywall) | Real-time; key demand signal |
| **ICE / CBOT** | Futures prices, open interest, basis | Daily | Real-time | Free (delayed) / Paid (real-time) | Available via data vendors |
| **Yahoo Finance / Reuters / Bloomberg** | Commodity prices (oil, FX, volatility) | Daily | Real-time | Free (Yahoo) / Paid (Bloomberg) | Easy integration |
| **IMD (India Met Dept)** | Monsoon forecasts | Seasonal | 2w advance | Free | Official India weather authority |
| **CONAB (Brazil)** | Brazilian cotton acreage | Quarterly | 2w | Free | Official; Portuguese; RSS feed available |
| **Port authorities (Shanghai, Rotterdam, Chattanooga)** | Port congestion data | Weekly | Real-time | Free/Paid | Public; some have APIs |
| **Shipping indices (SCFI, Baltic Exchange)** | Container freight, shipping costs | Daily/Weekly | Real-time | Free (delayed) / Paid | Available via data vendors |
| **Reuters / Bloomberg / Trade publications** | News sentiment, event data | Daily | Real-time | Free (Reuters/Bloomberg) / Paid | Can be scraped responsibly |
| **Government trade databases** | US tariff data, sanctions lists | Event-driven | Real-time | Free | Official; event-driven impact |
| **Trading venues (CME, ICE)** | Volume, volatility, positioning | Daily | Real-time | Free (delayed) / Paid | Key for technical signals |

---

## Expected Lead Times & Lags Summary

| Lead Time | Typical Predictors | Modeling Implication |
|---|---|---|
| **0-3 days** | USD index, VIX, oil, technical signals, FX | Useful for 1w forecast; limited value for longer horizons |
| **1-4 weeks** | US export sales, stocks, news shocks, weather impacts | Core for 1-4w forecast; decay for longer horizons |
| **2-8 weeks** | Mill PMI, demand proxies, regional weather, logistics | Important for 1-3m forecast |
| **1-3 months** | Inflation, monsoon impacts, policy changes | Critical for 1-3m forecast |
| **6-12 months** | USDA acreage/yield cycle, global supply shifts, subsidy changes | Structural; long-term pricing regime |

---

## Hypothesis Summary: Expected Directional Effects

| Factor | Expected Direction | Confidence | Notes |
|---|---|---|---|
| Supply ↑ | Price ↓ | Very High | Fundamental; 2-12w lag depending on source |
| Demand ↑ | Price ↑ | Very High | Fundamental; 1-8w lag depending on signal |
| USD ↑ | Price ↓ | Very High | Technical/financial; 1-3d lag |
| Inflation ↑ | Price ↑ | High | Input cost pass-through; 2-12w lag |
| Real rates ↑ | Price ↓ | High | Carry cost; 1-7d lag |
| Oil ↑ | Price ↑ | High | Input costs; 2-8w lag |
| VIX ↑ | Price ↓ | High | Risk-off; 1-3d lag |
| Volatility ↑ | Price ↑ | Medium | Supply uncertainty premium; variable lag |
| Backwardation ↑ | Price ↑ | High | Supply tightness signal; 1-3w lag |
| Tariffs ↑ | Price ↓ | Medium | Demand reduction; 2-8w lag (weak signal) |
| Weather shock | Price ↑ | Medium-High | Supply risk; highly variable lag |
| Monsoon failure | Price ↑ | High | India/Pakistan supply risk; 4-12w lag |
| Mill PMI ↑ | Price ↑ | High | Demand signal; 2-8w lag |

---

## Data Quality & Leakage Considerations

### Avoid Look-Ahead Bias
- **USDA reports:** Release dates are announced in advance; include release lag in feature engineering
- **PMI / economic data:** Released 1-3 days after month-end; must lag by 1 day minimum
- **Weather forecasts:** Use only forecasts available at prediction date; never use actual outcomes
- **Trade data:** Tariff announcements are real-time; actual implementation has lag

### Data Freshness
- **Daily:** Prices, FX, VIX, oil, news (update intraday or daily)
- **Weekly:** Stocks, export sales, port congestion (update weekly)
- **Monthly:** PMI, mill use, acreage, production (update monthly)
- **Seasonal/Annual:** Yield, supply plans (update seasonally/annually)
- **Event-driven:** Tariffs, sanctions, purchases (ad-hoc)

---

## Next Steps

1. **Feature prioritization:** Confirm Tier 1 + Tier 2 feature list with domain experts
2. **Data pipeline design:** Build normalized dataset for training/backtesting (Issue #25)
3. **Lead-lag analysis:** Confirm expected lags with historical correlation analysis
4. **Regime analysis:** Identify periods of regime shifts and validate predictor stability
5. **Feature engineering:** Construct lagged/seasonal/interaction features from raw data (Issue #26)

---

## References

- USDA NASS / FAS publications and reports
- ICAC annual/quarterly reports and press releases
- CME/ICE contract specifications and trader reports
- Academic literature on commodity price forecasting (Pindyck, Kellogg, etc.)
- Industry publications (Cottonworks, ICA, trade magazines)
