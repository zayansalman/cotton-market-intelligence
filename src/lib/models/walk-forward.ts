/**
 * Walk-forward backtesting framework (#28).
 *
 * At each step:
 * 1. Train on all data up to step (expanding window)
 * 2. Predict forward return at the horizon
 * 3. Record actual vs predicted
 * 4. Advance by step_size trading days
 *
 * No look-ahead bias — model only sees past data at each decision point.
 */

import type { ForecastModel, Horizon, ModelState } from "./types";
import type { FeatureRow } from "@/lib/pipeline/features";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface WalkForwardConfig {
  /** Minimum training window size (trading days). */
  min_train_size: number;
  /** Step size between re-trainings (trading days). */
  step_size: number;
  /** Forecast horizon. */
  horizon: Horizon;
}

export interface WalkForwardStep {
  date: string;
  actual: number;
  predicted: number;
  error: number;
  abs_error: number;
  direction_correct: boolean;
  /** Regime at this step (for slicing). */
  vol_regime: number | null;
  trend_regime: number | null;
}

export interface WalkForwardResult {
  model_id: string;
  model_name: string;
  horizon: Horizon;
  config: WalkForwardConfig;
  steps: WalkForwardStep[];
  metrics: WalkForwardMetrics;
  regime_metrics: RegimeSlice[];
}

export interface WalkForwardMetrics {
  n_steps: number;
  mae: number;
  rmse: number;
  mape: number;
  smape: number;
  direction_accuracy: number;
  mean_error: number;
  /** 95th percentile absolute error. */
  p95_abs_error: number;
  /** Information ratio: mean_error / std_error. */
  information_ratio: number;
}

export interface RegimeSlice {
  regime_name: string;
  regime_value: number;
  n_steps: number;
  mae: number;
  rmse: number;
  direction_accuracy: number;
}

/* ------------------------------------------------------------------ */
/*  Target field mapping                                               */
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

/* ------------------------------------------------------------------ */
/*  Walk-forward runner                                                */
/* ------------------------------------------------------------------ */

export function runWalkForward(
  model: ForecastModel,
  rows: FeatureRow[],
  config: WalkForwardConfig
): WalkForwardResult {
  const { min_train_size, step_size, horizon } = config;
  const targetField = TARGET_FIELD[horizon];
  const horizonDays = HORIZON_DAYS[horizon];
  // Exclude sentiment_score — it is always 0 in history (only filled at
  // inference), matching the trainer's feature set for a fair comparison.
  const featureNames = Object.keys(rows[0]?.features ?? {}).filter(
    (name) => name !== "sentiment_score"
  );

  const steps: WalkForwardStep[] = [];

  for (let i = min_train_size; i < rows.length; i += step_size) {
    const target = rows[i][targetField] as number | null;
    if (target == null) continue;

    // Purge gap: rows in [i - horizonDays, i) have forward targets that
    // realize on/after decision date i, so training on them leaks the future.
    // Cut them from the training window before filtering for valid targets.
    const trainRows = rows
      .slice(0, Math.max(0, i - horizonDays))
      .filter((r) => r[targetField] != null);
    if (trainRows.length < 30) continue;

    // Mean-impute missing features using TRAIN rows only (consistent with the
    // trainer). Zero-imputation invents fake signal — a missing DXY is not
    // DXY = 0. Fall back to 0 only when a column has no valid values at all.
    const imputation = featureNames.map((name) => {
      let sum = 0;
      let count = 0;
      for (const r of trainRows) {
        const v = r.features[name];
        if (v != null && Number.isFinite(v)) {
          sum += v;
          count++;
        }
      }
      return count > 0 ? sum / count : 0;
    });

    const trainX = trainRows.map((r) =>
      featureNames.map((name, j) => {
        const v = r.features[name];
        return v != null && Number.isFinite(v) ? v : imputation[j];
      })
    );
    const trainY = trainRows.map((r) => r[targetField] as number);

    // Fit model on training window
    const state = model.fit(trainX, trainY, featureNames);

    // Predict at current point (same train-derived imputation values)
    const testFeatures = featureNames.map((name, j) => {
      const v = rows[i].features[name];
      return v != null && Number.isFinite(v) ? v : imputation[j];
    });
    const current = rows[i].target;
    const prediction = model.predict(state, testFeatures, current);
    const predicted = prediction.value;
    const actual = target;

    const error = predicted - actual;
    const absError = Math.abs(error);
    // Current-relative direction: targets are forward PRICE levels (always > 0),
    // so compare each to the current price to score the up/down call. The old
    // "actual >= 0" check was always true and made accuracy a degenerate 1.0.
    const directionCorrect =
      (actual - current >= 0) === (predicted - current >= 0);

    steps.push({
      date: rows[i].date,
      actual: Math.round(actual * 100000) / 100000,
      predicted: Math.round(predicted * 100000) / 100000,
      error: Math.round(error * 100000) / 100000,
      abs_error: Math.round(absError * 100000) / 100000,
      direction_correct: directionCorrect,
      vol_regime: rows[i].features.vol_regime ?? null,
      trend_regime: rows[i].features.trend_regime ?? null,
    });
  }

  const metrics = computeMetrics(steps);
  const regimeMetrics = computeRegimeSlices(steps);

  return {
    model_id: model.meta.id,
    model_name: model.meta.name,
    horizon,
    config,
    steps,
    metrics,
    regime_metrics: regimeMetrics,
  };
}

/* ------------------------------------------------------------------ */
/*  Metrics                                                            */
/* ------------------------------------------------------------------ */

function computeMetrics(steps: WalkForwardStep[]): WalkForwardMetrics {
  const n = steps.length;
  if (n === 0) {
    return {
      n_steps: 0, mae: 0, rmse: 0, mape: 0, smape: 0,
      direction_accuracy: 0, mean_error: 0, p95_abs_error: 0,
      information_ratio: 0,
    };
  }

  const errors = steps.map((s) => s.error);
  const absErrors = steps.map((s) => s.abs_error);

  const mae = absErrors.reduce((s, v) => s + v, 0) / n;
  const rmse = Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / n);
  const meanError = errors.reduce((s, v) => s + v, 0) / n;

  // MAPE (skip zeros in actual)
  let mapeSum = 0;
  let mapeCount = 0;
  for (const s of steps) {
    if (Math.abs(s.actual) > 1e-10) {
      mapeSum += Math.abs(s.error / s.actual);
      mapeCount++;
    }
  }
  const mape = mapeCount > 0 ? (mapeSum / mapeCount) * 100 : 0;

  // sMAPE
  let smapeSum = 0;
  for (const s of steps) {
    const denom = (Math.abs(s.actual) + Math.abs(s.predicted)) / 2;
    if (denom > 1e-10) {
      smapeSum += Math.abs(s.error) / denom;
    }
  }
  const smape = (smapeSum / n) * 100;

  const directionAccuracy = steps.filter((s) => s.direction_correct).length / n;

  // P95 absolute error
  const sortedAbs = [...absErrors].sort((a, b) => a - b);
  const p95Idx = Math.min(Math.floor(n * 0.95), n - 1);
  const p95AbsError = sortedAbs[p95Idx];

  // Information ratio
  const stdError = Math.sqrt(
    errors.reduce((s, v) => s + (v - meanError) ** 2, 0) / n
  );
  const informationRatio = stdError > 0 ? meanError / stdError : 0;

  return {
    n_steps: n,
    mae: Math.round(mae * 100000) / 100000,
    rmse: Math.round(rmse * 100000) / 100000,
    mape: Math.round(mape * 100) / 100,
    smape: Math.round(smape * 100) / 100,
    direction_accuracy: Math.round(directionAccuracy * 10000) / 10000,
    mean_error: Math.round(meanError * 100000) / 100000,
    p95_abs_error: Math.round(p95AbsError * 100000) / 100000,
    information_ratio: Math.round(informationRatio * 1000) / 1000,
  };
}

/* ------------------------------------------------------------------ */
/*  Regime slicing                                                     */
/* ------------------------------------------------------------------ */

function computeRegimeSlices(steps: WalkForwardStep[]): RegimeSlice[] {
  const slices: RegimeSlice[] = [];

  // Volatility regime slices
  const volNames: Record<number, string> = { 0: "Low Vol", 1: "Normal Vol", 2: "High Vol" };
  for (const [val, name] of Object.entries(volNames)) {
    const subset = steps.filter((s) => s.vol_regime === Number(val));
    if (subset.length < 5) continue;
    slices.push({
      regime_name: name,
      regime_value: Number(val),
      ...sliceMetrics(subset),
    });
  }

  // Trend regime slices
  const trendNames: Record<number, string> = { "-1": "Downtrend", 0: "Range", 1: "Uptrend" };
  for (const [val, name] of Object.entries(trendNames)) {
    const subset = steps.filter((s) => s.trend_regime === Number(val));
    if (subset.length < 5) continue;
    slices.push({
      regime_name: name,
      regime_value: Number(val),
      ...sliceMetrics(subset),
    });
  }

  return slices;
}

function sliceMetrics(steps: WalkForwardStep[]): {
  n_steps: number;
  mae: number;
  rmse: number;
  direction_accuracy: number;
} {
  const n = steps.length;
  const absErrors = steps.map((s) => s.abs_error);
  const errors = steps.map((s) => s.error);

  return {
    n_steps: n,
    mae: Math.round((absErrors.reduce((s, v) => s + v, 0) / n) * 100000) / 100000,
    rmse: Math.round(Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / n) * 100000) / 100000,
    direction_accuracy: Math.round(
      (steps.filter((s) => s.direction_correct).length / n) * 10000
    ) / 10000,
  };
}

/* ------------------------------------------------------------------ */
/*  Run walk-forward for all models and compare                        */
/* ------------------------------------------------------------------ */

export function compareModelsWalkForward(
  models: ForecastModel[],
  rows: FeatureRow[],
  config: WalkForwardConfig
): WalkForwardResult[] {
  return models.map((model) => runWalkForward(model, rows, config));
}
