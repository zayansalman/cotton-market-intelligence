/**
 * Decision stump ensemble (gradient boosting lite) (#25).
 *
 * A simple boosted tree model using single-split decision stumps.
 * Each round fits a stump to residuals. This captures non-linear
 * relationships and feature interactions that linear models miss.
 *
 * Pure TypeScript — no external deps.
 */

import type { ForecastModel, ModelState, Prediction } from "./types";

/* ------------------------------------------------------------------ */
/*  Decision stump                                                     */
/* ------------------------------------------------------------------ */

interface Stump {
  feature_idx: number;
  threshold: number;
  left_value: number;  // prediction if feature <= threshold
  right_value: number; // prediction if feature > threshold
}

function findBestStump(
  X: number[][],
  residuals: number[],
  sampleWeight: number[]
): Stump {
  const n = X.length;
  const p = X[0].length;

  let bestLoss = Infinity;
  let bestStump: Stump = {
    feature_idx: 0,
    threshold: 0,
    left_value: 0,
    right_value: 0,
  };

  for (let j = 0; j < p; j++) {
    // Get unique sorted thresholds (sample up to 20 quantiles for speed)
    const vals = X.map((row) => row[j]).filter(Number.isFinite);
    vals.sort((a, b) => a - b);
    const step = Math.max(1, Math.floor(vals.length / 20));
    const thresholds: number[] = [];
    for (let i = step; i < vals.length; i += step) {
      thresholds.push((vals[i - 1] + vals[i]) / 2);
    }

    for (const threshold of thresholds) {
      let leftSum = 0, leftWeight = 0;
      let rightSum = 0, rightWeight = 0;

      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(X[i][j])) continue;
        const w = sampleWeight[i];
        if (X[i][j] <= threshold) {
          leftSum += residuals[i] * w;
          leftWeight += w;
        } else {
          rightSum += residuals[i] * w;
          rightWeight += w;
        }
      }

      const leftVal = leftWeight > 0 ? leftSum / leftWeight : 0;
      const rightVal = rightWeight > 0 ? rightSum / rightWeight : 0;

      // Weighted MSE loss
      let loss = 0;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(X[i][j])) continue;
        const pred = X[i][j] <= threshold ? leftVal : rightVal;
        loss += sampleWeight[i] * (residuals[i] - pred) ** 2;
      }

      if (loss < bestLoss) {
        bestLoss = loss;
        bestStump = {
          feature_idx: j,
          threshold,
          left_value: leftVal,
          right_value: rightVal,
        };
      }
    }
  }

  return bestStump;
}

/* ------------------------------------------------------------------ */
/*  Boosted ensemble                                                   */
/* ------------------------------------------------------------------ */

function fitBoostedStumps(
  X: number[][],
  y: number[],
  nRounds: number = 50,
  learningRate: number = 0.1
): { stumps: Stump[]; intercept: number; learning_rate: number } {
  const n = X.length;
  const intercept = y.reduce((s, v) => s + v, 0) / n;
  const residuals = y.map((v) => v - intercept);
  const weights = new Array(n).fill(1 / n);
  const stumps: Stump[] = [];

  for (let round = 0; round < nRounds; round++) {
    const stump = findBestStump(X, residuals, weights);
    stumps.push(stump);

    // Update residuals
    for (let i = 0; i < n; i++) {
      const pred =
        X[i][stump.feature_idx] <= stump.threshold
          ? stump.left_value
          : stump.right_value;
      residuals[i] -= learningRate * pred;
    }
  }

  return { stumps, intercept, learning_rate: learningRate };
}

function predictBoosted(
  state: { stumps: Stump[]; intercept: number; learning_rate: number },
  features: number[]
): number {
  let pred = state.intercept;
  for (const stump of state.stumps) {
    const fVal = features[stump.feature_idx];
    if (!Number.isFinite(fVal)) continue;
    const stumpPred =
      fVal <= stump.threshold ? stump.left_value : stump.right_value;
    pred += state.learning_rate * stumpPred;
  }
  return pred;
}

/* ------------------------------------------------------------------ */
/*  Model                                                              */
/* ------------------------------------------------------------------ */

export const boostedStumpsModel: ForecastModel = {
  meta: {
    id: "boosted_stumps",
    name: "Gradient Boosted Stumps",
    type: "ml",
    description: "Ensemble of 50 decision stumps fit via gradient boosting (lr=0.1)",
  },

  fit: (features, targets) => {
    // Filter valid rows
    const validIdx: number[] = [];
    for (let i = 0; i < features.length; i++) {
      if (features[i].every(Number.isFinite) && Number.isFinite(targets[i])) {
        validIdx.push(i);
      }
    }

    if (validIdx.length < 30) {
      return { stumps: [], intercept: 0, learning_rate: 0.1 };
    }

    const X = validIdx.map((i) => features[i]);
    const y = validIdx.map((i) => targets[i]);

    return fitBoostedStumps(X, y, 50, 0.1);
  },

  predict: (state, features) => {
    const stumps = state.stumps as Stump[];
    if (!stumps || stumps.length === 0) return { value: 0 };

    const value = predictBoosted(
      state as { stumps: Stump[]; intercept: number; learning_rate: number },
      features
    );
    return { value };
  },
};
