/**
 * Elastic Net regression (#53).
 *
 * WHY ELASTIC NET (not Ridge, not Lasso):
 * - Ridge (L2 only): Keeps ALL features. With 50 features, many are noise.
 *   Ridge shrinks but never zeros out — model carries dead weight.
 * - Lasso (L1 only): Zeros out features aggressively. Good for feature
 *   selection but unstable when features are correlated (common in finance —
 *   DXY and CNY/USD move together).
 * - Elastic Net (L1 + L2): Gets the best of both. L1 component does feature
 *   selection (zeroes out noise). L2 component handles correlated features
 *   (groups them instead of arbitrarily picking one).
 *
 * ALPHA = 0.5 (equal L1/L2 mix): Standard starting point. At institutional
 * firms, this is tuned via cross-validation, but 0.5 is robust default.
 *
 * LAMBDA = 0.01: Regularization strength. Small enough to not over-penalize
 * but large enough to prevent overfitting on ~1000 samples.
 *
 * Implementation: Coordinate descent (the standard algorithm for elastic net).
 * Pure TypeScript — same algorithm as scikit-learn's ElasticNet.
 */

import type { ForecastModel, ModelState, Prediction } from "./types";

/* ------------------------------------------------------------------ */
/*  Coordinate descent                                                 */
/* ------------------------------------------------------------------ */

function softThreshold(z: number, gamma: number): number {
  if (z > gamma) return z - gamma;
  if (z < -gamma) return z + gamma;
  return 0;
}

function elasticNetFit(
  X: number[][],
  y: number[],
  lambda: number = 0.01,
  alpha: number = 0.5, // 0 = Ridge, 1 = Lasso, 0.5 = Elastic Net
  maxIter: number = 1000,
  tol: number = 1e-6
): { coefficients: number[]; intercept: number; selected_features: number[] } {
  const n = X.length;
  const p = X[0].length;

  // Center features and target
  const xMeans = new Array(p).fill(0);
  let yMean = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) xMeans[j] += X[i][j];
    yMean += y[i];
  }
  for (let j = 0; j < p; j++) xMeans[j] /= n;
  yMean /= n;

  const Xc = X.map((row) => row.map((v, j) => v - xMeans[j]));
  const yc = y.map((v) => v - yMean);

  // Precompute X^T X diagonal (for coordinate descent)
  const xSquaredSum = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) {
      xSquaredSum[j] += Xc[i][j] * Xc[i][j];
    }
  }

  // Initialize coefficients to zero
  const beta = new Array(p).fill(0);
  const residual = [...yc];

  for (let iter = 0; iter < maxIter; iter++) {
    let maxChange = 0;

    for (let j = 0; j < p; j++) {
      if (xSquaredSum[j] < 1e-10) continue;

      // Add back current feature's contribution
      for (let i = 0; i < n; i++) {
        residual[i] += Xc[i][j] * beta[j];
      }

      // Compute partial residual correlation
      let rho = 0;
      for (let i = 0; i < n; i++) {
        rho += Xc[i][j] * residual[i];
      }
      rho /= n;

      // Coordinate descent update with elastic net penalty
      const l1Penalty = lambda * alpha;
      const l2Penalty = lambda * (1 - alpha);
      const newBeta =
        softThreshold(rho, l1Penalty) / (xSquaredSum[j] / n + l2Penalty);

      // Track convergence
      maxChange = Math.max(maxChange, Math.abs(newBeta - beta[j]));
      beta[j] = newBeta;

      // Remove updated feature's contribution from residual
      for (let i = 0; i < n; i++) {
        residual[i] -= Xc[i][j] * beta[j];
      }
    }

    if (maxChange < tol) break;
  }

  // Intercept
  let dotProduct = 0;
  for (let j = 0; j < p; j++) dotProduct += beta[j] * xMeans[j];
  const intercept = yMean - dotProduct;

  // Which features were selected (non-zero coefficients)?
  const selectedFeatures = beta
    .map((b, i) => ({ idx: i, val: Math.abs(b) }))
    .filter((x) => x.val > 1e-8)
    .sort((a, b) => b.val - a.val)
    .map((x) => x.idx);

  return { coefficients: beta, intercept, selected_features: selectedFeatures };
}

/* ------------------------------------------------------------------ */
/*  Model                                                              */
/* ------------------------------------------------------------------ */

export const elasticNetModel: ForecastModel = {
  meta: {
    id: "elastic_net",
    name: "Elastic Net (L1+L2)",
    type: "statistical",
    description:
      "Combined L1/L2 regularization via coordinate descent. L1 component " +
      "automatically zeros out noisy features. L2 component groups correlated " +
      "features (DXY and CNY/USD). Standard at systematic commodity funds.",
  },

  fit: (features, targets, featureNames) => {
    const validIdx: number[] = [];
    for (let i = 0; i < features.length; i++) {
      if (features[i].every(Number.isFinite) && Number.isFinite(targets[i])) {
        validIdx.push(i);
      }
    }
    if (validIdx.length < 20) return { coefficients: [], intercept: 0, selected_features: [] };

    const X = validIdx.map((i) => features[i]);
    const y = validIdx.map((i) => targets[i]);

    const result = elasticNetFit(X, y, 0.01, 0.5);
    return {
      ...result,
      feature_names: featureNames,
    };
  },

  predict: (state, features) => {
    const coef = state.coefficients as number[];
    const intercept = (state.intercept as number) ?? 0;
    if (!coef || coef.length === 0 || features.length !== coef.length) return { value: 0 };

    let value = intercept;
    for (let i = 0; i < coef.length; i++) {
      if (Number.isFinite(features[i]) && coef[i] !== 0) {
        value += coef[i] * features[i];
      }
    }
    return { value: Math.max(-0.5, Math.min(0.5, value)) };
  },
};
