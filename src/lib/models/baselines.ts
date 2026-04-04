/**
 * Baseline forecast models (#25).
 *
 * These establish the minimum bar any advanced model must beat.
 */

import type { ForecastModel, ModelState, Prediction } from "./types";

/* ------------------------------------------------------------------ */
/*  Naive: predict zero return (random walk)                           */
/* ------------------------------------------------------------------ */

export const naiveModel: ForecastModel = {
  meta: {
    id: "naive",
    name: "Naive (Random Walk)",
    type: "baseline",
    description: "Predicts zero return — price stays flat",
  },
  fit: () => ({}),
  predict: () => ({ value: 0 }),
};

/* ------------------------------------------------------------------ */
/*  Historical Mean: predict average historical return                  */
/* ------------------------------------------------------------------ */

export const historicalMeanModel: ForecastModel = {
  meta: {
    id: "hist_mean",
    name: "Historical Mean Return",
    type: "baseline",
    description: "Predicts the average return observed in training data",
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
    description: "Predicts the average of the last 21 training returns",
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
    description: "Predicts using the average return from the same calendar month in training data",
  },
  fit: (features, targets, featureNames) => {
    const monthIdx = featureNames.indexOf("month");
    if (monthIdx === -1) return { monthMeans: {} };

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
    return { monthMeans };
  },
  predict: (state, features) => {
    const monthMeans = state.monthMeans as Record<number, number>;
    // Month feature is at a known position — caller must ensure consistency
    // We look for a value 1-12 in features
    const month = features.find((v) => v >= 1 && v <= 12 && Number.isInteger(v));
    return { value: (month != null ? monthMeans[month] : 0) ?? 0 };
  },
};
