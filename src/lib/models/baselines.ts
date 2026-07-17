/**
 * Baseline forecast models (#25).
 *
 * These establish the minimum bar any advanced model must beat.
 */

import type { ForecastModel, ModelState, Prediction } from "./types";

/* ------------------------------------------------------------------ */
/*  Naive: true random walk — predict the current price persists        */
/* ------------------------------------------------------------------ */

export const naiveModel: ForecastModel = {
  meta: {
    id: "naive",
    name: "Naive (Random Walk)",
    type: "baseline",
    description: "Random walk — predicts the current price persists",
  },
  // Store a fallback (mean of training price targets) for when no current
  // price is supplied at inference. Targets are forward PRICE levels, so a
  // random walk predicts the current price, not a zero return.
  fit: (_features, targets) => ({
    fallback: targets.length ? targets.reduce((s, v) => s + v, 0) / targets.length : 0,
  }),
  predict: (state, _features, currentPrice) => ({
    value: currentPrice ?? (state.fallback as number) ?? 0,
  }),
};

/* ------------------------------------------------------------------ */
/*  Historical Mean: predict average historical return                  */
/* ------------------------------------------------------------------ */

export const historicalMeanModel: ForecastModel = {
  meta: {
    id: "hist_mean",
    name: "Historical Mean Return",
    type: "baseline",
    description: "Predicts the average price observed in training data",
  },
  fit: (_features, targets) => {
    const mean = targets.reduce((s, v) => s + v, 0) / targets.length;
    return { mean };
  },
  predict: (state) => ({
    value: (state.mean as number) ?? 0,
  }),
};

/* ------------------------------------------------------------------ */
/*  Moving Average: predict mean of last N returns                     */
/* ------------------------------------------------------------------ */

export const movingAverageModel: ForecastModel = {
  meta: {
    id: "ma_return",
    name: "Moving Average Return (21d)",
    type: "baseline",
    description: "Predicts the average of the last 21 training prices",
  },
  fit: (_features, targets) => {
    const window = Math.min(21, targets.length);
    const recent = targets.slice(-window);
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
    return { mean };
  },
  predict: (state) => ({
    value: (state.mean as number) ?? 0,
  }),
};

/* ------------------------------------------------------------------ */
/*  Seasonal Naive: predict return from same month last year           */
/* ------------------------------------------------------------------ */

export const seasonalNaiveModel: ForecastModel = {
  meta: {
    id: "seasonal_naive",
    name: "Seasonal Naive (same month last year)",
    type: "baseline",
    description: "Predicts using the average price from the same calendar month in training data",
  },
  fit: (features, targets, featureNames) => {
    // Store the month column index so predict reads the RIGHT feature. The old
    // predict scanned for any value 1-12, which matched vol_regime/trend_regime
    // before the real month column.
    const monthIdx = featureNames.indexOf("month");
    if (monthIdx === -1) return { monthMeans: {}, monthIdx: -1 };

    const monthSums: Record<number, { sum: number; count: number }> = {};
    for (let i = 0; i < targets.length; i++) {
      const month = features[i][monthIdx];
      if (!monthSums[month]) monthSums[month] = { sum: 0, count: 0 };
      monthSums[month].sum += targets[i];
      monthSums[month].count++;
    }

    const monthMeans: Record<number, number> = {};
    for (const [m, { sum, count }] of Object.entries(monthSums)) {
      monthMeans[Number(m)] = sum / count;
    }
    return { monthMeans, monthIdx };
  },
  predict: (state, features, currentPrice) => {
    const monthMeans = state.monthMeans as Record<number, number>;
    const monthIdx = state.monthIdx as number;
    const month = monthIdx >= 0 ? features[monthIdx] : undefined;
    const lookup = month != null ? monthMeans[month] : undefined;
    if (lookup != null && Number.isFinite(lookup)) return { value: lookup };

    // Fallback: mean of all month means, else the current price, else 0.
    const means = Object.values(monthMeans);
    const fallback = means.length
      ? means.reduce((s, v) => s + v, 0) / means.length
      : currentPrice ?? 0;
    return { value: fallback };
  },
};
