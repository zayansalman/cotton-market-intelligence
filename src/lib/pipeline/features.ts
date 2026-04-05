/**
 * Feature engineering library for cotton price forecasting (#27).
 *
 * All transforms are pure functions operating on aligned daily data.
 * No look-ahead bias — every feature uses only past/current data.
 *
 * Feature groups:
 * 1. Lagged values and momentum
 * 2. Volatility regime indicators
 * 3. Cross-market ratios and spreads
 * 4. Calendar/seasonal features
 * 5. Technical signals (MA crossovers, RSI)
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FeatureRow {
  date: string;
  /** Target: cotton close price. */
  target: number;
  /** Forward returns for supervised learning (may be NaN at end). */
  fwd_return_5d: number | null;
  fwd_return_21d: number | null;
  fwd_return_63d: number | null;
  /** Feature values keyed by feature name. */
  features: Record<string, number | null>;
}

export interface FeatureSpec {
  name: string;
  group: "lag" | "momentum" | "volatility" | "cross_market" | "calendar" | "technical" | "regime";
  description: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function lag(arr: (number | null)[], periods: number): (number | null)[] {
  const result: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = periods; i < arr.length; i++) {
    result[i] = arr[i - periods];
  }
  return result;
}

function pctChange(arr: (number | null)[], periods: number): (number | null)[] {
  const result: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = periods; i < arr.length; i++) {
    const prev = arr[i - periods];
    const curr = arr[i];
    if (prev != null && curr != null && prev !== 0) {
      result[i] = (curr - prev) / prev;
    }
  }
  return result;
}

function rollingMean(arr: (number | null)[], window: number): (number | null)[] {
  const result: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = window - 1; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - window + 1; j <= i; j++) {
      if (arr[j] != null) {
        sum += arr[j]!;
        count++;
      }
    }
    result[i] = count > 0 ? sum / count : null;
  }
  return result;
}

function rollingStd(arr: (number | null)[], window: number): (number | null)[] {
  const means = rollingMean(arr, window);
  const result: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = window - 1; i < arr.length; i++) {
    const m = means[i];
    if (m == null) continue;
    let sumSq = 0;
    let count = 0;
    for (let j = i - window + 1; j <= i; j++) {
      if (arr[j] != null) {
        sumSq += (arr[j]! - m) ** 2;
        count++;
      }
    }
    result[i] = count > 1 ? Math.sqrt(sumSq / count) : null;
  }
  return result;
}

function rollingMax(arr: (number | null)[], window: number): (number | null)[] {
  const result: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = window - 1; i < arr.length; i++) {
    let max = -Infinity;
    for (let j = i - window + 1; j <= i; j++) {
      if (arr[j] != null && arr[j]! > max) max = arr[j]!;
    }
    result[i] = max === -Infinity ? null : max;
  }
  return result;
}

function rollingMin(arr: (number | null)[], window: number): (number | null)[] {
  const result: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = window - 1; i < arr.length; i++) {
    let min = Infinity;
    for (let j = i - window + 1; j <= i; j++) {
      if (arr[j] != null && arr[j]! < min) min = arr[j]!;
    }
    result[i] = min === Infinity ? null : min;
  }
  return result;
}

/** RSI (Relative Strength Index). */
function rsi(prices: (number | null)[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = new Array(prices.length).fill(null);
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    if (prices[i] == null || prices[i - 1] == null) continue;
    const delta = prices[i]! - prices[i - 1]!;
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? -delta : 0);

    if (gains.length >= period) {
      const avgGain = gains.slice(-period).reduce((s, v) => s + v, 0) / period;
      const avgLoss = losses.slice(-period).reduce((s, v) => s + v, 0) / period;
      result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Feature catalog                                                    */
/* ------------------------------------------------------------------ */

export const FEATURE_SPECS: FeatureSpec[] = [
  // Lag features
  { name: "cotton_lag_5d", group: "lag", description: "Cotton price 5 days ago" },
  { name: "cotton_lag_21d", group: "lag", description: "Cotton price 21 days ago" },
  { name: "cotton_lag_63d", group: "lag", description: "Cotton price 63 days ago" },

  // Momentum
  { name: "cotton_ret_5d", group: "momentum", description: "5-day return" },
  { name: "cotton_ret_21d", group: "momentum", description: "21-day return" },
  { name: "cotton_ret_63d", group: "momentum", description: "63-day return" },
  { name: "cotton_ret_126d", group: "momentum", description: "126-day (6mo) return" },

  // Volatility
  { name: "cotton_vol_10d", group: "volatility", description: "10-day realized vol (annualized)" },
  { name: "cotton_vol_21d", group: "volatility", description: "21-day realized vol (annualized)" },
  { name: "cotton_vol_63d", group: "volatility", description: "63-day realized vol (annualized)" },

  // Regime
  { name: "vol_regime", group: "regime", description: "Volatility regime: 0=low (<20), 1=normal (20-35), 2=high (>35)" },
  { name: "trend_regime", group: "regime", description: "Trend regime: 1=uptrend, -1=downtrend, 0=range" },
  { name: "pct_rank_63d", group: "regime", description: "Price percentile rank over 63 days" },
  { name: "pct_rank_252d", group: "regime", description: "Price percentile rank over 252 days" },

  // Technical
  { name: "rsi_14", group: "technical", description: "14-day RSI" },
  { name: "ma_cross_50_200", group: "technical", description: "50d MA minus 200d MA (golden/death cross)" },
  { name: "dist_from_52w_high", group: "technical", description: "% distance from 252-day high" },
  { name: "dist_from_52w_low", group: "technical", description: "% distance from 252-day low" },

  // Cross-market
  { name: "cotton_dxy_ratio", group: "cross_market", description: "Cotton / DXY ratio" },
  { name: "cotton_oil_ratio", group: "cross_market", description: "Cotton / Crude oil ratio" },
  { name: "dxy_ret_21d", group: "cross_market", description: "DXY 21-day return" },
  { name: "vix_level", group: "cross_market", description: "VIX level" },
  { name: "oil_ret_21d", group: "cross_market", description: "Crude oil 21-day return" },
  { name: "sp500_ret_21d", group: "cross_market", description: "S&P 500 21-day return" },

  // Lagged cross-market
  { name: "dxy_lag_5d", group: "cross_market", description: "DXY 5 days ago" },
  { name: "dxy_lag_21d", group: "cross_market", description: "DXY 21 days ago" },
  { name: "oil_lag_5d", group: "cross_market", description: "Crude oil 5 days ago" },
  { name: "oil_lag_21d", group: "cross_market", description: "Crude oil 21 days ago" },
  { name: "vix_lag_5d", group: "cross_market", description: "VIX 5 days ago" },
  // Cross-commodity ratios
  { name: "cotton_soybean_ratio", group: "cross_market", description: "Cotton / Soybean ratio" },
  { name: "cotton_wheat_ratio", group: "cross_market", description: "Cotton / Wheat ratio" },
  { name: "soybean_ret_21d", group: "cross_market", description: "Soybean 21-day return" },
  { name: "cotton_corn_ratio", group: "cross_market", description: "Cotton / Corn ratio (acreage competition)" },
  { name: "corn_ret_21d", group: "cross_market", description: "Corn 21-day return" },
  // Input costs & supply chain
  { name: "fertilizer_ret_21d", group: "cross_market", description: "Fertilizer proxy (MOS) 21-day return — input cost signal" },
  { name: "diesel_ret_21d", group: "cross_market", description: "Diesel (ULSD) 21-day return — farm + logistics cost" },
  { name: "container_freight_ret_21d", group: "cross_market", description: "Container freight (ZIM) 21-day return" },
  { name: "cotton_fertilizer_ratio", group: "cross_market", description: "Cotton / fertilizer ratio — farmer profitability proxy" },
  { name: "cotton_diesel_ratio", group: "cross_market", description: "Cotton / diesel ratio — operating margin proxy" },
  // FX (producing + consuming countries)
  { name: "inr_usd_ret_21d", group: "cross_market", description: "INR/USD 21-day return — India demand/supply signal" },
  { name: "bdt_usd_ret_21d", group: "cross_market", description: "BDT/USD 21-day return — Bangladesh demand signal" },
  // Polyester spread
  { name: "cotton_polyester_spread", group: "cross_market", description: "Cotton price vs polyester cost proxy (cotton - oil*0.012)" },
  // Sentiment
  { name: "sentiment_score", group: "cross_market", description: "News sentiment aggregate score (-1 to +1)" },

  // Calendar/seasonal
  { name: "month", group: "calendar", description: "Month of year (1-12)" },
  { name: "quarter", group: "calendar", description: "Quarter (1-4)" },
  { name: "day_of_week", group: "calendar", description: "Day of week (0=Mon, 4=Fri)" },
  { name: "is_harvest_season", group: "calendar", description: "1 if Oct-Dec (US harvest)" },
  { name: "is_planting_season", group: "calendar", description: "1 if Mar-May (US planting)" },
];

/* ------------------------------------------------------------------ */
/*  Feature builder                                                    */
/* ------------------------------------------------------------------ */

/**
 * Build feature matrix from aligned daily data.
 *
 * @param dates - Sorted daily date strings
 * @param aligned - Output of alignToDaily(): date → { factor_id: value }
 * @returns Feature rows ready for model training/inference
 */
export function buildFeatures(
  dates: string[],
  aligned: Record<string, Record<string, number>>
): FeatureRow[] {
  const cotton = dates.map((d) => aligned[d]?.cotton_close ?? null);
  const dxy = dates.map((d) => aligned[d]?.dxy ?? null);
  const oil = dates.map((d) => aligned[d]?.crude_oil ?? null);
  const vix = dates.map((d) => aligned[d]?.vix ?? null);
  const sp500 = dates.map((d) => aligned[d]?.sp500 ?? null);
  const soybean = dates.map((d) => aligned[d]?.soybean ?? null);
  const wheat = dates.map((d) => aligned[d]?.wheat ?? null);
  const corn = dates.map((d) => aligned[d]?.corn ?? null);
  const fertilizer = dates.map((d) => aligned[d]?.fertilizer_proxy ?? null);
  const diesel = dates.map((d) => aligned[d]?.diesel ?? null);
  const containerFreight = dates.map((d) => aligned[d]?.container_freight ?? null);
  const inrUsd = dates.map((d) => aligned[d]?.inr_usd ?? null);
  const bdtUsd = dates.map((d) => aligned[d]?.bdt_usd ?? null);

  // Precompute arrays
  const cottonRet5 = pctChange(cotton, 5);
  const cottonRet21 = pctChange(cotton, 21);
  const cottonRet63 = pctChange(cotton, 63);
  const cottonRet126 = pctChange(cotton, 126);

  const cottonLag5 = lag(cotton, 5);
  const cottonLag21 = lag(cotton, 21);
  const cottonLag63 = lag(cotton, 63);

  // Daily returns for vol calculation
  const dailyRets = pctChange(cotton, 1);
  const vol10 = rollingStd(dailyRets, 10);
  const vol21 = rollingStd(dailyRets, 21);
  const vol63 = rollingStd(dailyRets, 63);
  const sqrt252 = Math.sqrt(252);

  const ma50 = rollingMean(cotton, 50);
  const ma200 = rollingMean(cotton, 200);
  const high252 = rollingMax(cotton, 252);
  const low252 = rollingMin(cotton, 252);
  const rsi14 = rsi(cotton, 14);

  const dxyRet21 = pctChange(dxy, 21);
  const oilRet21 = pctChange(oil, 21);
  const sp500Ret21 = pctChange(sp500, 21);

  const dxyLag5 = lag(dxy, 5);
  const dxyLag21 = lag(dxy, 21);
  const oilLag5 = lag(oil, 5);
  const oilLag21 = lag(oil, 21);
  const vixLag5 = lag(vix, 5);
  const soybeanRet21 = pctChange(soybean, 21);
  const cornRet21 = pctChange(corn, 21);
  const fertilizerRet21 = pctChange(fertilizer, 21);
  const dieselRet21 = pctChange(diesel, 21);
  const containerFreightRet21 = pctChange(containerFreight, 21);
  const inrRet21 = pctChange(inrUsd, 21);
  const bdtRet21 = pctChange(bdtUsd, 21);

  // Forward PRICE targets for supervised learning.
  // We predict the actual future price level, not returns.
  // Returns are tiny (~±2%) and indistinguishable from noise.
  // Price levels give the model a meaningful target to predict
  // and produce a usable price curve for the chart.
  const fwdRet5 = dates.map((_, i) => {
    if (i + 5 >= dates.length || cotton[i + 5] == null) return null;
    return cotton[i + 5]!; // Future PRICE, not return
  });
  const fwdRet21 = dates.map((_, i) => {
    if (i + 21 >= dates.length || cotton[i + 21] == null) return null;
    return cotton[i + 21]!;
  });
  const fwdRet63 = dates.map((_, i) => {
    if (i + 63 >= dates.length || cotton[i + 63] == null) return null;
    return cotton[i + 63]!;
  });

  const rows: FeatureRow[] = [];

  for (let i = 0; i < dates.length; i++) {
    if (cotton[i] == null) continue;

    const d = new Date(dates[i]);
    const monthNum = d.getUTCMonth() + 1;
    const dayOfWeek = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1; // Mon=0

    // Volatility regime
    const v21 = vol21[i] != null ? vol21[i]! * sqrt252 * 100 : null;
    let volRegime: number | null = null;
    if (v21 != null) {
      volRegime = v21 < 20 ? 0 : v21 < 35 ? 1 : 2;
    }

    // Trend regime (50d vs 200d MA)
    let trendRegime: number | null = null;
    if (ma50[i] != null && ma200[i] != null) {
      const diff = ma50[i]! - ma200[i]!;
      trendRegime = diff > 0.005 ? 1 : diff < -0.005 ? -1 : 0;
    }

    // Percentile ranks
    let pctRank63: number | null = null;
    if (i >= 63) {
      const window = cotton.slice(i - 63, i + 1).filter((v): v is number => v != null);
      pctRank63 = window.filter((v) => v < cotton[i]!).length / window.length;
    }
    let pctRank252: number | null = null;
    if (i >= 252) {
      const window = cotton.slice(i - 252, i + 1).filter((v): v is number => v != null);
      pctRank252 = window.filter((v) => v < cotton[i]!).length / window.length;
    }

    const features: Record<string, number | null> = {
      // Lags
      cotton_lag_5d: cottonLag5[i],
      cotton_lag_21d: cottonLag21[i],
      cotton_lag_63d: cottonLag63[i],

      // Momentum
      cotton_ret_5d: cottonRet5[i],
      cotton_ret_21d: cottonRet21[i],
      cotton_ret_63d: cottonRet63[i],
      cotton_ret_126d: cottonRet126[i],

      // Volatility
      cotton_vol_10d: vol10[i] != null ? Math.round(vol10[i]! * sqrt252 * 100 * 100) / 100 : null,
      cotton_vol_21d: v21 != null ? Math.round(v21 * 100) / 100 : null,
      cotton_vol_63d: vol63[i] != null ? Math.round(vol63[i]! * sqrt252 * 100 * 100) / 100 : null,

      // Regime
      vol_regime: volRegime,
      trend_regime: trendRegime,
      pct_rank_63d: pctRank63 != null ? Math.round(pctRank63 * 10000) / 10000 : null,
      pct_rank_252d: pctRank252 != null ? Math.round(pctRank252 * 10000) / 10000 : null,

      // Technical
      rsi_14: rsi14[i] != null ? Math.round(rsi14[i]! * 100) / 100 : null,
      ma_cross_50_200: ma50[i] != null && ma200[i] != null
        ? Math.round((ma50[i]! - ma200[i]!) * 10000) / 10000
        : null,
      dist_from_52w_high: high252[i] != null && cotton[i] != null && high252[i]! > 0
        ? Math.round(((cotton[i]! - high252[i]!) / high252[i]!) * 10000) / 10000
        : null,
      dist_from_52w_low: low252[i] != null && cotton[i] != null && low252[i]! > 0
        ? Math.round(((cotton[i]! - low252[i]!) / low252[i]!) * 10000) / 10000
        : null,

      // Cross-market
      cotton_dxy_ratio: cotton[i] != null && dxy[i] != null && dxy[i]! > 0
        ? Math.round((cotton[i]! / dxy[i]!) * 100000) / 100000
        : null,
      cotton_oil_ratio: cotton[i] != null && oil[i] != null && oil[i]! > 0
        ? Math.round((cotton[i]! / oil[i]!) * 100000) / 100000
        : null,
      dxy_ret_21d: dxyRet21[i],
      vix_level: vix[i],
      oil_ret_21d: oilRet21[i],
      sp500_ret_21d: sp500Ret21[i],

      // Lagged cross-market
      dxy_lag_5d: dxyLag5[i],
      dxy_lag_21d: dxyLag21[i],
      oil_lag_5d: oilLag5[i],
      oil_lag_21d: oilLag21[i],
      vix_lag_5d: vixLag5[i],
      cotton_soybean_ratio: cotton[i] != null && soybean[i] != null && soybean[i]! > 0
        ? Math.round((cotton[i]! / soybean[i]!) * 100000) / 100000 : null,
      cotton_wheat_ratio: cotton[i] != null && wheat[i] != null && wheat[i]! > 0
        ? Math.round((cotton[i]! / wheat[i]!) * 100000) / 100000 : null,
      soybean_ret_21d: soybeanRet21[i],
      cotton_corn_ratio: cotton[i] != null && corn[i] != null && corn[i]! > 0
        ? Math.round((cotton[i]! / corn[i]!) * 100000) / 100000 : null,
      corn_ret_21d: cornRet21[i],

      // Input costs & supply chain
      fertilizer_ret_21d: fertilizerRet21[i],
      diesel_ret_21d: dieselRet21[i],
      container_freight_ret_21d: containerFreightRet21[i],
      cotton_fertilizer_ratio: cotton[i] != null && fertilizer[i] != null && fertilizer[i]! > 0
        ? Math.round((cotton[i]! / fertilizer[i]!) * 100000) / 100000 : null,
      cotton_diesel_ratio: cotton[i] != null && diesel[i] != null && diesel[i]! > 0
        ? Math.round((cotton[i]! / diesel[i]!) * 100000) / 100000 : null,
      // FX
      inr_usd_ret_21d: inrRet21[i],
      bdt_usd_ret_21d: bdtRet21[i],
      // Polyester spread: cotton $/lb vs polyester cost proxy (oil * 0.012 conversion)
      cotton_polyester_spread: cotton[i] != null && oil[i] != null
        ? Math.round((cotton[i]! - oil[i]! * 0.012) * 10000) / 10000 : null,

      sentiment_score: 0, // default; overridden at prediction time when HF sentiment available

      // Calendar
      month: monthNum,
      quarter: Math.ceil(monthNum / 3),
      day_of_week: dayOfWeek,
      is_harvest_season: monthNum >= 10 && monthNum <= 12 ? 1 : 0,
      is_planting_season: monthNum >= 3 && monthNum <= 5 ? 1 : 0,
    };

    rows.push({
      date: dates[i],
      target: cotton[i]!,
      fwd_return_5d: fwdRet5[i],
      fwd_return_21d: fwdRet21[i],
      fwd_return_63d: fwdRet63[i],
      features,
    });
  }

  return rows;
}
