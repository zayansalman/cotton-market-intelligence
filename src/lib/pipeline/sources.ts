/**
 * Data source fetchers for forecasting factors (#24).
 *
 * Each fetcher returns DataPoint[] from a free public API.
 * All fetchers handle errors gracefully — returning empty arrays
 * on failure so the pipeline continues.
 */

import type { DataPoint, FactorMeta } from "./types";
import { fetchWithTimeout } from "../api-security";

/* ------------------------------------------------------------------ */
/*  Yahoo Finance fetcher (reusable for any ticker)                    */
/* ------------------------------------------------------------------ */

async function fetchYahoo(
  symbol: string,
  years: number = 5
): Promise<DataPoint[]> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const start = now - years * 365 * 24 * 3600;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${now}&interval=1d`;

    const res = await fetchWithTimeout(url, {
      timeout: 15_000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return [];

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps: number[] = result.timestamp;
    const closes: (number | null)[] = result.indicators.quote[0].close;
    const points: DataPoint[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c == null || !Number.isFinite(c)) continue;
      points.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        value: Math.round(c * 10000) / 10000,
      });
    }

    return points;
  } catch (e) {
    console.error(`[pipeline] Yahoo fetch failed for ${symbol}:`, e);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  FRED fetcher (Federal Reserve Economic Data — free API)            */
/* ------------------------------------------------------------------ */

async function fetchFred(
  seriesId: string,
  apiKey: string | undefined
): Promise<DataPoint[]> {
  if (!apiKey) {
    console.warn(`[pipeline] FRED_API_KEY not set, skipping ${seriesId}`);
    return [];
  }
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=asc&observation_start=2019-01-01`;
    const res = await fetchWithTimeout(url, { timeout: 15_000 });
    if (!res.ok) return [];

    const data = await res.json();
    const obs: { date: string; value: string }[] = data?.observations ?? [];
    return obs
      .filter((o) => o.value !== ".")
      .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
      .filter((p) => Number.isFinite(p.value));
  } catch (e) {
    console.error(`[pipeline] FRED fetch failed for ${seriesId}:`, e);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Factor definitions + fetchers                                      */
/* ------------------------------------------------------------------ */

export interface FactorFetcher {
  meta: FactorMeta;
  fetch: () => Promise<DataPoint[]>;
}

export function buildFactorFetchers(): FactorFetcher[] {
  const fredKey = process.env.FRED_API_KEY;

  return [
    // ================================================================
    // TARGET VARIABLE
    // Cotton #2 ICE futures — the contract Bangladesh mills price
    // against. Used to derive lag, momentum, volatility, and regime
    // features. Prices >5 are in cents/lb (Yahoo inconsistency),
    // normalized to $/lb.
    // ================================================================
    {
      meta: {
        id: "cotton_close",
        name: "Cotton #2 Futures Close",
        group: "supply",
        frequency: "daily",
        release_lag_days: 0,
        unit: "$/lb",
        source: "Yahoo Finance (CT=F)",
        direction: 1,
      },
      fetch: async () => {
        const raw = await fetchYahoo("CT=F", 5);
        // Normalize cents to dollars
        return raw.map((p) => ({
          date: p.date,
          value: p.value > 5 ? Math.round((p.value / 100) * 10000) / 10000 : p.value,
        }));
      },
    },

    // ================================================================
    // MACRO: US DOLLAR INDEX (DXY)
    // Cotton is USD-denominated. DXY up → cotton more expensive for
    // non-USD buyers (Bangladesh, India, China) → demand falls →
    // price falls. Inverse correlation R ~ -0.3 to -0.6. Currency
    // moves lead commodity repricing by 3-7 trading days, which is
    // why we compute lagged DXY features (dxy_lag_5d, dxy_lag_21d).
    // ================================================================
    {
      meta: {
        id: "dxy",
        name: "US Dollar Index (DXY)",
        group: "macro",
        frequency: "daily",
        release_lag_days: 0,
        unit: "index",
        source: "Yahoo Finance (DX-Y.NYB)",
        direction: -1,
      },
      fetch: () => fetchYahoo("DX-Y.NYB", 5),
    },

    // ================================================================
    // MACRO: VIX (VOLATILITY INDEX)
    // Risk-off proxy. Commodities are risk assets held by
    // institutional investors. VIX spike → risk-off → positions
    // unwound → cotton sells off. Also: high uncertainty causes
    // mills to defer procurement (wait-and-see). Inverse correlation.
    // ================================================================
    {
      meta: {
        id: "vix",
        name: "CBOE Volatility Index (VIX)",
        group: "macro",
        frequency: "daily",
        release_lag_days: 0,
        unit: "index",
        source: "Yahoo Finance (^VIX)",
        direction: -1,
      },
      fetch: () => fetchYahoo("^VIX", 5),
    },

    // ================================================================
    // COMPETING COMMODITY: WTI CRUDE OIL
    // Polyester is cotton's primary synthetic substitute. The
    // transmission chain: oil → naphtha → PX → PTA → PET →
    // polyester fiber. Oil up → polyester production cost up →
    // cotton's relative competitiveness improves → cotton demand
    // up → cotton price up. Also: oil drives ocean freight costs
    // (shipping cotton is fuel-intensive). Positive correlation
    // with 2-4 week lag through the petrochemical chain.
    // ================================================================
    {
      meta: {
        id: "crude_oil",
        name: "WTI Crude Oil",
        group: "competing",
        frequency: "daily",
        release_lag_days: 0,
        unit: "$/barrel",
        source: "Yahoo Finance (CL=F)",
        direction: 1,
      },
      fetch: () => fetchYahoo("CL=F", 5),
    },

    // ================================================================
    // COMPETING: NATURAL GAS (POLYESTER ENERGY PROXY)
    // PET production (polyester feedstock) is energy-intensive.
    // Natural gas is a primary energy input for Asian PET plants.
    // NG up → polyester cost up → cotton substitution demand up.
    // Also: cotton ginning and textile processing use energy.
    // Weaker signal than crude oil but adds information.
    // ================================================================
    {
      meta: {
        id: "natural_gas",
        name: "Natural Gas (polyester energy proxy)",
        group: "competing",
        frequency: "daily",
        release_lag_days: 0,
        unit: "$/MMBtu",
        source: "Yahoo Finance (NG=F)",
        direction: 1,
      },
      fetch: () => fetchYahoo("NG=F", 5),
    },

    // ================================================================
    // MACRO: US 10Y TREASURY YIELD
    // Higher real rates → higher carry cost for holding physical
    // commodities → incentive to sell inventory → price pressure
    // down. Also: rising yields signal tightening monetary policy
    // → risk-off for commodity allocations. Inverse correlation.
    // ================================================================
    {
      meta: {
        id: "us10y",
        name: "US 10Y Treasury Yield",
        group: "macro",
        frequency: "daily",
        release_lag_days: 0,
        unit: "%",
        source: "Yahoo Finance (^TNX)",
        direction: -1,
      },
      fetch: () => fetchYahoo("^TNX", 5),
    },

    // ================================================================
    // MACRO: CNY/USD EXCHANGE RATE
    // China consumes ~30% of global cotton. CNY weakness → cotton
    // more expensive for Chinese mills → demand falls → global
    // cotton price falls. This is the single most important FX
    // pair for cotton after DXY. Inverse correlation.
    // ================================================================
    {
      meta: {
        id: "cny_usd",
        name: "CNY/USD Exchange Rate",
        group: "macro",
        frequency: "daily",
        release_lag_days: 0,
        unit: "CNY per USD",
        source: "Yahoo Finance (CNY=X)",
        direction: -1,
      },
      fetch: () => fetchYahoo("CNY=X", 5),
    },

    // ================================================================
    // FREIGHT: BALTIC DRY INDEX (BDI)
    // Proxy for global bulk shipping costs. Cotton is shipped in
    // containers, but BDI correlates with general freight rates.
    // BDI up → shipping cost up → CIF cotton price up → positive
    // correlation. Also signals global trade activity (demand).
    // ================================================================
    {
      meta: {
        id: "bdiy",
        name: "Baltic Dry Index (freight proxy)",
        group: "freight",
        frequency: "daily",
        release_lag_days: 0,
        unit: "index",
        source: "Yahoo Finance (^BDIY via FRED if available)",
        direction: 1,
      },
      fetch: () => fetchYahoo("^BDI", 3),
    },

    // ================================================================
    // DEMAND: S&P 500 (RISK APPETITE / GROWTH PROXY)
    // Equity markets up → economic growth expectations up → textile
    // demand (apparel) up → cotton demand up. Also: S&P 500 is a
    // proxy for institutional risk appetite — risk-on environments
    // support commodity allocations. Positive correlation.
    // ================================================================
    {
      meta: {
        id: "sp500",
        name: "S&P 500 (demand/risk proxy)",
        group: "demand",
        frequency: "daily",
        release_lag_days: 0,
        unit: "index",
        source: "Yahoo Finance (^GSPC)",
        direction: 1,
      },
      fetch: () => fetchYahoo("^GSPC", 5),
    },

    // ================================================================
    // MACRO: 5Y BREAKEVEN INFLATION RATE
    // Market-implied inflation expectations. Higher inflation →
    // commodities are real assets that benefit from inflation →
    // cotton price up. This is the "inflation hedge" signal.
    // FRED series T5YIE. 1-day publication lag.
    // ================================================================
    {
      meta: {
        id: "breakeven_5y",
        name: "5Y Breakeven Inflation Rate",
        group: "macro",
        frequency: "daily",
        release_lag_days: 1,
        unit: "%",
        source: "FRED (T5YIE)",
        direction: 1,
      },
      fetch: () => fetchFred("T5YIE", fredKey),
    },

    // === SUPPLY: US cotton export sales ===
    {
      meta: {
        id: "us_cotton_exports",
        name: "US Cotton Export Sales (weekly proxy)",
        group: "supply",
        frequency: "weekly",
        release_lag_days: 7,
        unit: "1000 480-lb bales",
        source: "FRED (if available) or USDA FAS",
        direction: 1,
      },
      // USDA weekly exports aren't on FRED — use a proxy or skip
      fetch: async () => [],
    },

    // ================================================================
    // DEMAND: CHINA MANUFACTURING PMI
    // China is the world's largest cotton consumer (~30% of global
    // mill use). PMI > 50 = expansion → mills buying cotton →
    // demand up → price up. 3-day publication lag (released 1st
    // of month for prior month). FRED series MPMICNMA669S.
    // ================================================================
    {
      meta: {
        id: "china_pmi_mfg",
        name: "China Manufacturing PMI",
        group: "demand",
        frequency: "monthly",
        release_lag_days: 3,
        unit: "index",
        source: "FRED (MPMICNMA669S) if available",
        direction: 1,
      },
      fetch: () => fetchFred("MPMICNMA669S", fredKey),
    },

    // ================================================================
    // COMPETING: SOYBEAN FUTURES (PLANTING COMPETITION)
    // The strongest structural cross-commodity signal for cotton.
    // US Cotton Belt farmers choose between cotton and soybeans
    // based on relative profitability every planting season.
    // Soybean futures up → farmers plant more soybeans → less
    // cotton acreage → cotton supply contracts → cotton price
    // rises with 6-9 month lag. The cotton/soybean ratio is
    // tracked by every ag commodity desk. USDA Prospective
    // Plantings (March) is the key event. Inverse direction.
    // ================================================================
    {
      meta: {
        id: "soybean",
        name: "Soybean Futures",
        group: "competing" as const,
        frequency: "daily" as const,
        release_lag_days: 0,
        unit: "$/bushel",
        source: "Yahoo Finance (ZS=F)",
        direction: -1 as const,
      },
      fetch: () => fetchYahoo("ZS=F", 5),
    },
    // ================================================================
    // COMPETING: WHEAT FUTURES (PLANTING COMPETITION)
    // Acreage competition in the Southern Plains (Texas, Oklahoma).
    // Winter wheat and cotton share irrigated acres. Also a broader
    // ag commodity cycle proxy — when the grain complex rallies,
    // cotton follows with lag because input costs (fertilizer,
    // fuel, labor) correlate and farmer profitability shifts.
    // Weaker signal than soybean but real. Inverse direction.
    // ================================================================
    {
      meta: {
        id: "wheat",
        name: "Wheat Futures",
        group: "competing" as const,
        frequency: "daily" as const,
        release_lag_days: 0,
        unit: "$/bushel",
        source: "Yahoo Finance (ZW=F)",
        direction: -1 as const,
      },
      fetch: () => fetchYahoo("ZW=F", 5),
    },
    // ================================================================
    // COMPETING: CORN FUTURES (ACREAGE + AG COMPLEX BAROMETER)
    // Acreage switching in Delta states (Mississippi, Arkansas).
    // Corn is the deepest agricultural futures market and acts as
    // a barometer for the entire ag complex — corn rallies drag
    // cotton via macro ag sentiment and shared input costs.
    // Also: corn/ethanol demand affects fuel prices → freight.
    // Inverse direction for acreage competition mechanism.
    // ================================================================
    {
      meta: {
        id: "corn",
        name: "Corn Futures",
        group: "competing" as const,
        frequency: "daily" as const,
        release_lag_days: 0,
        unit: "$/bushel",
        source: "Yahoo Finance (ZC=F)",
        direction: -1 as const,
      },
      fetch: () => fetchYahoo("ZC=F", 5),
    },
  ];
}
