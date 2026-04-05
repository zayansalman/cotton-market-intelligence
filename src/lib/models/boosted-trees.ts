/**
 * Gradient Boosted Trees with configurable depth (#53).
 *
 * WHY DEPTH 3 (not stumps, not deep forests):
 * - Depth 1 (stumps): Can only model single-feature thresholds. Misses
 *   "DXY falling AND vol low → cotton rallies" interactions.
 * - Depth 3: Captures up to 3rd-order interactions. This is the sweet
 *   spot for ~50 features and ~1000 samples. Citadel, Two Sigma, and
 *   Man AHL commodity models typically use depth 3-5.
 * - Depth 5+: Overfits at our sample size. Needs >10K samples.
 *
 * WHY 100 ROUNDS (not 50):
 * - More rounds + lower learning rate = smoother fit.
 * - lr=0.05 * 100 rounds is more stable than lr=0.1 * 50 rounds.
 * - Each round corrects a smaller fraction of residual error.
 *
 * Pure TypeScript — no Python/XGBoost dependency.
 */

import type { ForecastModel, ModelState, Prediction } from "./types";

/* ------------------------------------------------------------------ */
/*  Decision tree node                                                 */
/* ------------------------------------------------------------------ */

interface TreeNode {
  feature_idx: number;
  threshold: number;
  left: TreeNode | number; // subtree or leaf value
  right: TreeNode | number;
}

function buildTree(
  X: number[][],
  residuals: number[],
  depth: number,
  maxDepth: number
): TreeNode | number {
  const n = X.length;
  if (n < 10 || depth >= maxDepth) {
    // Leaf: average of residuals
    return residuals.reduce((s, v) => s + v, 0) / n;
  }

  const p = X[0].length;
  let bestLoss = Infinity;
  let bestFeature = 0;
  let bestThreshold = 0;
  let bestLeftIdx: number[] = [];
  let bestRightIdx: number[] = [];

  for (let j = 0; j < p; j++) {
    // Sample thresholds (up to 15 quantiles for speed)
    const vals = X.map((row) => row[j]).filter(Number.isFinite);
    if (vals.length < 5) continue;
    vals.sort((a, b) => a - b);
    const step = Math.max(1, Math.floor(vals.length / 15));

    for (let q = step; q < vals.length; q += step) {
      const threshold = (vals[q - 1] + vals[q]) / 2;
      const leftIdx: number[] = [];
      const rightIdx: number[] = [];

      for (let i = 0; i < n; i++) {
        if (Number.isFinite(X[i][j]) && X[i][j] <= threshold) {
          leftIdx.push(i);
        } else {
          rightIdx.push(i);
        }
      }

      if (leftIdx.length < 5 || rightIdx.length < 5) continue;

      // Weighted MSE reduction
      const leftMean = leftIdx.reduce((s, i) => s + residuals[i], 0) / leftIdx.length;
      const rightMean = rightIdx.reduce((s, i) => s + residuals[i], 0) / rightIdx.length;

      let loss = 0;
      for (const i of leftIdx) loss += (residuals[i] - leftMean) ** 2;
      for (const i of rightIdx) loss += (residuals[i] - rightMean) ** 2;

      if (loss < bestLoss) {
        bestLoss = loss;
        bestFeature = j;
        bestThreshold = threshold;
        bestLeftIdx = leftIdx;
        bestRightIdx = rightIdx;
      }
    }
  }

  if (bestLeftIdx.length < 5 || bestRightIdx.length < 5) {
    return residuals.reduce((s, v) => s + v, 0) / n;
  }

  return {
    feature_idx: bestFeature,
    threshold: bestThreshold,
    left: buildTree(
      bestLeftIdx.map((i) => X[i]),
      bestLeftIdx.map((i) => residuals[i]),
      depth + 1,
      maxDepth
    ),
    right: buildTree(
      bestRightIdx.map((i) => X[i]),
      bestRightIdx.map((i) => residuals[i]),
      depth + 1,
      maxDepth
    ),
  };
}

function predictTree(node: TreeNode | number, features: number[]): number {
  if (typeof node === "number") return node;
  const val = features[node.feature_idx];
  if (!Number.isFinite(val) || val <= node.threshold) {
    return predictTree(node.left, features);
  }
  return predictTree(node.right, features);
}

/* ------------------------------------------------------------------ */
/*  Gradient boosting                                                  */
/* ------------------------------------------------------------------ */

function fitGBT(
  X: number[][],
  y: number[],
  nRounds: number,
  lr: number,
  maxDepth: number
): { trees: (TreeNode | number)[]; intercept: number; learning_rate: number } {
  const n = X.length;
  const intercept = y.reduce((s, v) => s + v, 0) / n;
  const residuals = y.map((v) => v - intercept);
  const trees: (TreeNode | number)[] = [];

  for (let round = 0; round < nRounds; round++) {
    const tree = buildTree(X, residuals, 0, maxDepth);
    trees.push(tree);

    for (let i = 0; i < n; i++) {
      residuals[i] -= lr * predictTree(tree, X[i]);
    }
  }

  return { trees, intercept, learning_rate: lr };
}

/* ------------------------------------------------------------------ */
/*  Model                                                              */
/* ------------------------------------------------------------------ */

export const boostedTreesModel: ForecastModel = {
  meta: {
    id: "gbt_depth3",
    name: "Gradient Boosted Trees (depth 3)",
    type: "ml",
    description:
      "100-round gradient boosted trees with depth 3. Captures 2nd/3rd order " +
      "feature interactions (e.g., DXY falling + vol low + soybeans expensive → cotton up). " +
      "Standard model at institutional commodity desks (Citadel, Two Sigma, Man AHL).",
  },

  fit: (features, targets) => {
    const validIdx: number[] = [];
    for (let i = 0; i < features.length; i++) {
      if (features[i].every(Number.isFinite) && Number.isFinite(targets[i])) {
        validIdx.push(i);
      }
    }
    if (validIdx.length < 50) return { trees: [], intercept: 0, learning_rate: 0.05 };

    const X = validIdx.map((i) => features[i]);
    const y = validIdx.map((i) => targets[i]);

    return fitGBT(X, y, 100, 0.05, 3);
  },

  predict: (state, features) => {
    const trees = state.trees as (TreeNode | number)[];
    if (!trees || trees.length === 0) return { value: 0 };

    const lr = (state.learning_rate as number) ?? 0.05;
    const intercept = (state.intercept as number) ?? 0;

    let pred = intercept;
    for (const tree of trees) {
      pred += lr * predictTree(tree, features);
    }
    return { value: Math.max(-0.5, Math.min(0.5, pred)) };
  },
};
