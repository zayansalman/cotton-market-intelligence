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
    // === SUPPLY ===
    // Cotton price itself (used as input feature — lags, momentum)
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

    // === MACRO: USD index ===
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

    // === MACRO: VIX ===
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

    // === COMPETING: Crude Oil ===
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

    // === COMPETING: Polyester (proxy: PET/PX through oil) ===
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

    // === MACRO: 10Y Treasury yield ===
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

    // === MACRO: CNY/USD ===
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

    // === FREIGHT: Baltic Dry Index ===
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

    // === DEMAND: S&P 500 (risk appetite proxy) ===
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

    // === MACRO: Breakeven inflation ===
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

    // === DEMAND: China textile PMI proxy ===
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

    // === COMPETING: Soybean futures (planting competition) ===
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
    // Wheat futures (planting competition)
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
    // Corn futures (planting competition)
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
