/**
 * Model training and evaluation pipeline (#25).
 *
 * Trains all models on the feature matrix, evaluates with
 * train/test split, and selects the champion model.
 */

import type { ForecastModel, Horizon, ModelResult, ModelState } from "./types";
import type { FeatureRow } from "@/lib/pipeline/features";
import { naiveModel, historicalMeanModel, movingAverageModel, seasonalNaiveModel } from "./baselines";
import { linearModel } from "./linear";
import { boostedStumpsModel } from "./tree";

/* ------------------------------------------------------------------ */
/*  Model registry                                                     */
/* ------------------------------------------------------------------ */

export const MODEL_REGISTRY: ForecastModel[] = [
  naiveModel,
  historicalMeanModel,
  movingAverageModel,
  seasonalNaiveModel,
  linearModel,
  boostedStumpsModel,
];

/* ------------------------------------------------------------------ */
/*  Feature extraction from FeatureRow                                 */
/* ------------------------------------------------------------------ */

const TARGET_FIELD: Record<Horizon, keyof FeatureRow> = {
  "5d": "fwd_return_5d",
  "21d": "fwd_return_21d",
  "63d": "fwd_return_63d",
};

function extractMatrix(
  rows: FeatureRow[],
  horizon: Horizon
): {
  features: number[][];
  targets: number[];
  featureNames: string[];
  validRows: FeatureRow[];
} {
  const targetField = TARGET_FIELD[horizon];
  const featureNames = Object.keys(rows[0]?.features ?? {});

  const features: number[][] = [];
  const targets: number[] = [];
  const validRows: FeatureRow[] = [];

  for (const row of rows) {
    const target = row[targetField] as number | null;
    if (target == null) continue;

    const fVec = featureNames.map((name) => {
      const val = row.features[name];
      return val != null && Number.isFinite(val) ? val : 0; // Impute missing as 0
    });

    features.push(fVec);
    targets.push(target);
    validRows.push(row);
  }

  return { features, targets, featureNames, validRows };
}

/* ------------------------------------------------------------------ */
/*  Evaluation metrics                                                 */
/* ------------------------------------------------------------------ */

function mae(actual: number[], predicted: number[]): number {
  let sum = 0;
  for (let i = 0; i < actual.length; i++) {
    sum += Math.abs(actual[i] - predicted[i]);
  }
  return sum / actual.length;
}

function rmse(actual: number[], predicted: number[]): number {
  let sum = 0;
  for (let i = 0; i < actual.length; i++) {
    sum += (actual[i] - predicted[i]) ** 2;
  }
  return Math.sqrt(sum / actual.length);
}

function directionAccuracy(actual: number[], predicted: number[]): number {
  let correct = 0;
  for (let i = 0; i < actual.length; i++) {
    if ((actual[i] >= 0 && predicted[i] >= 0) || (actual[i] < 0 && predicted[i] < 0)) {
      correct++;
    }
  }
  return correct / actual.length;
}

/* ------------------------------------------------------------------ */
/*  Train and evaluate all models for a given horizon                  */
/* ------------------------------------------------------------------ */

export interface TrainResult {
  horizon: Horizon;
  results: ModelResult[];
  champion: ModelResult;
}

/**
 * Train all models and evaluate on held-out test set.
 *
 * @param rows - Feature rows from buildFeatures()
 * @param horizon - Forecast horizon
 * @param trainPct - Fraction of data for training (default 0.8)
 */
export function trainAndEvaluate(
  rows: FeatureRow[],
  horizon: Horizon,
  trainPct: number = 0.8
): TrainResult {
  const { features, targets, featureNames } = extractMatrix(rows, horizon);

  const splitIdx = Math.floor(features.length * trainPct);
  const trainX = features.slice(0, splitIdx);
  const trainY = targets.slice(0, splitIdx);
  const testX = features.slice(splitIdx);
  const testY = targets.slice(splitIdx);

  const results: ModelResult[] = [];

  for (const model of MODEL_REGISTRY) {
    const state = model.fit(trainX, trainY, featureNames);

    const predictions = testX.map((x) => model.predict(state, x).value);

    const result: ModelResult = {
      model_id: model.meta.id,
      model_name: model.meta.name,
      horizon,
      n_train: trainX.length,
      n_test: testX.length,
      mae: Math.round(mae(testY, predictions) * 100000) / 100000,
      rmse: Math.round(rmse(testY, predictions) * 100000) / 100000,
      direction_accuracy:
        Math.round(directionAccuracy(testY, predictions) * 10000) / 10000,
      mean_pred: Math.round((predictions.reduce((s, v) => s + v, 0) / predictions.length) * 100000) / 100000,
      mean_actual: Math.round((testY.reduce((s, v) => s + v, 0) / testY.length) * 100000) / 100000,
      state,
    };

    results.push(result);
  }

  // Champion selection: composite score balancing RMSE and direction accuracy.
  // A model with 66% directional accuracy and slightly higher RMSE is more
  // useful for procurement than naive (0% signal). We use:
  //   score = -RMSE + 0.5 * direction_accuracy
  // This penalizes large errors but rewards directional correctness.
  // Champion must still beat naive on at least one metric to qualify.
  const naiveResult = results.find((r) => r.model_id === "naive");
  const candidates = results.filter((r) => r.model_id !== "naive");

  const score = (r: ModelResult) =>
    -r.rmse + 0.5 * r.direction_accuracy;

  const sorted = [...candidates].sort((a, b) => score(b) - score(a));

  // Champion: best scoring model that improves over naive on RMSE or direction
  const champion =
    sorted.length > 0 &&
    naiveResult &&
    (sorted[0].rmse < naiveResult.rmse ||
     sorted[0].direction_accuracy > naiveResult.direction_accuracy + 0.05)
      ? sorted[0]
      : naiveResult ?? results[0];

  return { horizon, results, champion };
}

/**
 * Train across all horizons and return full comparison.
 */
export function trainAllHorizons(
  rows: FeatureRow[],
  trainPct: number = 0.8
): TrainResult[] {
  const horizons: Horizon[] = ["5d", "21d", "63d"];
  return horizons.map((h) => trainAndEvaluate(rows, h, trainPct));
}
