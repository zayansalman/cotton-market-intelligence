/**
 * Linear regression model (#25).
 *
 * OLS with optional L2 regularization (Ridge).
 * Pure TypeScript — no external deps.
 */

import type { ForecastModel, ModelState, Prediction } from "./types";

/* ------------------------------------------------------------------ */
/*  Matrix helpers (small-scale OLS)                                   */
/* ------------------------------------------------------------------ */

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Solve (X^T X + lambda I) beta = X^T y using normal equations.
 * For small feature sets (<50 features) this is fast and stable.
 */
function ridgeRegression(
  X: number[][],
  y: number[],
  lambda: number = 0.01
): { coefficients: number[]; intercept: number } {
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

  const Xc: number[][] = X.map((row) => row.map((v, j) => v - xMeans[j]));
  const yc = y.map((v) => v - yMean);

  // Compute X^T X + lambda I
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < n; k++) {
        XtX[i][j] += Xc[k][i] * Xc[k][j];
      }
    }
    XtX[i][i] += lambda * n; // Regularization
  }

  // Compute X^T y
  const Xty = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) {
      Xty[j] += Xc[i][j] * yc[i];
    }
  }

  // Solve via Gauss elimination (sufficient for p < 50)
  const augmented = XtX.map((row, i) => [...row, Xty[i]]);
  const coefficients = gaussElimination(augmented, p);

  // Intercept: yMean - sum(coef * xMean)
  const intercept = yMean - dotProduct(coefficients, xMeans);

  return { coefficients, intercept };
}

function gaussElimination(augmented: number[][], n: number): number[] {
  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(augmented[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > maxVal) {
        maxVal = Math.abs(augmented[row][col]);
        maxRow = row;
      }
    }
    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

    const pivot = augmented[col][col];
    if (Math.abs(pivot) < 1e-12) continue; // Skip near-singular

    for (let row = col + 1; row < n; row++) {
      const factor = augmented[row][col] / pivot;
      for (let j = col; j <= n; j++) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  // Back substitution
  const result = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= augmented[i][j] * result[j];
    }
    result[i] = Math.abs(augmented[i][i]) > 1e-12 ? sum / augmented[i][i] : 0;
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Model                                                              */
/* ------------------------------------------------------------------ */

export const linearModel: ForecastModel = {
  meta: {
    id: "ridge",
    name: "Ridge Regression",
    type: "statistical",
    description: "L2-regularized linear regression on all features",
  },

  fit: (features, targets) => {
    if (features.length < 10 || features[0].length === 0) {
      return { coefficients: [], intercept: 0 };
    }

    // Filter out rows with any NaN/null (already numbers, check finite)
    const validIdx: number[] = [];
    for (let i = 0; i < features.length; i++) {
      if (features[i].every(Number.isFinite) && Number.isFinite(targets[i])) {
        validIdx.push(i);
      }
    }

    if (validIdx.length < 10) return { coefficients: [], intercept: 0 };

    const X = validIdx.map((i) => features[i]);
    const y = validIdx.map((i) => targets[i]);

    const { coefficients, intercept } = ridgeRegression(X, y, 0.01);
    return { coefficients, intercept };
  },

  predict: (state, features) => {
    const coef = state.coefficients as number[];
    const intercept = (state.intercept as number) ?? 0;

    if (!coef || coef.length === 0) return { value: 0 };
    if (features.length !== coef.length) return { value: 0 };

    const value = intercept + dotProduct(coef, features);
    return { value: Math.max(-0.5, Math.min(0.5, value)) }; // Clamp extreme predictions
  },
};
