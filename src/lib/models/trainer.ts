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
import { boostedTreesModel } from "./boosted-trees";
import { elasticNetModel } from "./elastic-net";

/* ------------------------------------------------------------------ */
/*  Model registry                                                     */
/*                                                                      */
/*  Order: baselines first (honest null hypothesis), then increasing   */
/*  complexity. This is the standard at systematic commodity funds —   */
/*  you must prove each step of complexity adds value.                 */
/* ------------------------------------------------------------------ */

export const MODEL_REGISTRY: ForecastModel[] = [
  naiveModel,
  historicalMeanModel,
  movingAverageModel,
  seasonalNaiveModel,
  linearModel,
  elasticNetModel,
  boostedStumpsModel,
  boostedTreesModel,
];

/* ------------------------------------------------------------------ */
/*  Feature extraction from FeatureRow                                 */
/* ------------------------------------------------------------------ */

const TARGET_FIELD: Record<Horizon, keyof FeatureRow> = {
  "5d": "fwd_return_5d",
  "21d": "fwd_return_21d",
  "63d": "fwd_return_63d",
};

/** Trading-day horizon length — used for the purge gap (no look-ahead). */
const HORIZON_DAYS: Record<Horizon, number> = {
  "5d": 5,
  "21d": 21,
  "63d": 63,
};

/**
 * A row that passed the target + coverage filters, kept RAW (nulls preserved)
 * so imputation statistics can be derived from the train split only.
 */
interface ValidSample {
  /** Raw feature values in featureNames order; null where missing/non-finite. */
  raw: (number | null)[];
  /** Forward PRICE target for the horizon. */
  target: number;
  /** Current cotton price at this row (for random-walk baselines + direction). */
  current: number;
  row: FeatureRow;
}

/** Collect valid rows without imputing — imputation happens after the split. */
function extractValidSamples(
  rows: FeatureRow[],
  horizon: Horizon
): { featureNames: string[]; samples: ValidSample[] } {
  const targetField = TARGET_FIELD[horizon];
  // Exclude sentiment_score from training features — it's always 0 in
  // historical data (only filled at prediction time). Including it adds
  // noise that makes models worse than naive.
  const featureNames = Object.keys(rows[0]?.features ?? {}).filter(
    (name) => name !== "sentiment_score"
  );

  // Minimum feature coverage: skip rows where >40% of features are null.
  // First 252 rows typically have 50%+ nulls (MAs, RSI, percentile ranks
  // need lookback history). Training on these rows teaches the model
  // "predict 0 when inputs are sparse" — worse than useless.
  const MIN_COVERAGE = 0.6;

  const samples: ValidSample[] = [];
  for (const row of rows) {
    const target = row[targetField] as number | null;
    if (target == null) continue;

    let validCount = 0;
    const raw = featureNames.map((name) => {
      const val = row.features[name];
      if (val != null && Number.isFinite(val)) {
        validCount++;
        return val;
      }
      return null;
    });

    if (validCount / featureNames.length < MIN_COVERAGE) continue;

    samples.push({ raw, target, current: row.target, row });
  }

  return { featureNames, samples };
}

/**
 * Per-column mean of the provided samples (mean-imputation values). A null DXY
 * doesn't mean DXY=0, so we impute with the mean, not zero.
 */
function computeImputation(samples: ValidSample[], p: number): number[] {
  const sums = new Array(p).fill(0);
  const counts = new Array(p).fill(0);
  for (const s of samples) {
    for (let j = 0; j < p; j++) {
      const v = s.raw[j];
      if (v != null && Number.isFinite(v)) {
        sums[j] += v;
        counts[j]++;
      }
    }
  }
  return sums.map((sum, j) => (counts[j] > 0 ? sum / counts[j] : 0));
}

/** Apply imputation values to a raw feature vector (fill nulls). */
function applyImputation(
  raw: (number | null)[],
  imputation: number[]
): number[] {
  return raw.map((v, j) => (v != null && Number.isFinite(v) ? (v as number) : imputation[j]));
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

function directionAccuracy(
  actual: number[],
  predicted: number[],
  current: number[]
): number {
  let correct = 0;
  for (let i = 0; i < actual.length; i++) {
    const actualMove = actual[i] - current[i];
    const predictedMove = predicted[i] - current[i];
    if (
      (actualMove >= 0 && predictedMove >= 0) ||
      (actualMove < 0 && predictedMove < 0)
    ) {
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
  /** Top 3 model IDs for ensemble prediction. */
  top3Ids: string[];
  featureNames: string[];
  imputationValues: number[];
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
  const { featureNames, samples } = extractValidSamples(rows, horizon);
  const p = featureNames.length;
  const horizonDays = HORIZON_DAYS[horizon];

  // Split by index, then PURGE the last horizonDays train rows: their forward
  // targets overlap the test window (they realize after the split), so keeping
  // them leaks look-ahead into training.
  const splitIdx = Math.floor(samples.length * trainPct);
  const trainEnd = Math.max(0, splitIdx - horizonDays);
  const trainSamples = samples.slice(0, trainEnd);
  const testSamples = samples.slice(splitIdx);

  // Imputation stats from TRAIN rows ONLY — computing over all rows would leak
  // test-set means into the training features.
  const trainImputation = computeImputation(trainSamples, p);

  const trainX = trainSamples.map((s) => applyImputation(s.raw, trainImputation));
  const trainY = trainSamples.map((s) => s.target);
  const testX = testSamples.map((s) => applyImputation(s.raw, trainImputation));
  const testY = testSamples.map((s) => s.target);
  const testCurrent = testSamples.map((s) => s.current);

  // For LIVE inference we deliberately recompute imputation over ALL valid rows
  // (train + test): at prediction time there is no held-out set to protect and
  // we want the fullest possible estimate for each column. Used only by
  // buildInferenceVector below — never for the held-out evaluation.
  const imputationValues = computeImputation(samples, p);

  const results: ModelResult[] = [];

  for (const model of MODEL_REGISTRY) {
    const state = model.fit(trainX, trainY, featureNames);

    // Pass the current price so random-walk baselines predict "price persists".
    const predictions = testX.map(
      (x, k) => model.predict(state, x, testCurrent[k]).value
    );

    const result: ModelResult = {
      model_id: model.meta.id,
      model_name: model.meta.name,
      horizon,
      n_train: trainX.length,
      n_test: testX.length,
      mae: Math.round(mae(testY, predictions) * 100000) / 100000,
      rmse: Math.round(rmse(testY, predictions) * 100000) / 100000,
      direction_accuracy:
        Math.round(directionAccuracy(testY, predictions, testCurrent) * 10000) / 10000,
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

  // Top-3 ensemble: blend predictions from best 3 models weighted by
  // inverse RMSE. This is standard at systematic funds — no single model
  // dominates across all regimes. Ensembling reduces variance.
  const qualifiedModels = sorted.filter(
    (r) =>
      naiveResult &&
      (r.rmse < naiveResult.rmse ||
        r.direction_accuracy > naiveResult.direction_accuracy + 0.05)
  );

  const baseChampion =
    qualifiedModels.length > 0
      ? qualifiedModels[0]
      : naiveResult ?? results[0];

  // Store top-3 model IDs for ensemble prediction at inference time
  const top3Ids = (qualifiedModels.length >= 3
    ? qualifiedModels.slice(0, 3)
    : qualifiedModels.length > 0
      ? qualifiedModels
      : [naiveResult ?? results[0]]
  ).map((r) => r.model_id);

  // Refit the champion on the FULL history (all valid rows, imputation derived
  // over all valid rows) for LIVE inference — the eval state above only saw the
  // first ~80%. We KEEP the held-out mae/rmse/direction_accuracy from the eval
  // (those are the honest out-of-sample numbers); we only swap in the fuller
  // state so predictChampion forecasts from every observation available.
  let champion = baseChampion;
  const championModel = MODEL_REGISTRY.find(
    (m) => m.meta.id === baseChampion.model_id
  );
  if (championModel && samples.length > 0) {
    const fullX = samples.map((s) => applyImputation(s.raw, imputationValues));
    const fullY = samples.map((s) => s.target);
    const fullState = championModel.fit(fullX, fullY, featureNames);
    champion = { ...baseChampion, state: fullState };
  }

  return { horizon, results, champion, top3Ids, featureNames, imputationValues };
}

export function buildInferenceVector(
  row: FeatureRow,
  featureNames: string[],
  imputationValues: number[]
): number[] {
  return featureNames.map((name, idx) => {
    const value = row.features[name];
    return value != null && Number.isFinite(value)
      ? value
      : imputationValues[idx] ?? 0;
  });
}

export function predictChampion(
  result: TrainResult,
  row: FeatureRow
): { value: number; model_id: string; model_name: string } | null {
  const model = MODEL_REGISTRY.find(
    (candidate) => candidate.meta.id === result.champion.model_id
  );
  if (!model) return null;

  const features = buildInferenceVector(
    row,
    result.featureNames,
    result.imputationValues
  );
  // Pass the current price so random-walk baselines forecast "price persists".
  const prediction = model.predict(result.champion.state, features, row.target);
  if (!Number.isFinite(prediction.value)) return null;

  return {
    value: prediction.value,
    model_id: result.champion.model_id,
    model_name: result.champion.model_name,
  };
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
