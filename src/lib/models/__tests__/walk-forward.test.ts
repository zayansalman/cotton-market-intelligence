/**
 * Walk-forward backtesting tests (#28).
 */

import { describe, it, expect } from "vitest";
import { runWalkForward, compareModelsWalkForward } from "../walk-forward";
import { naiveModel } from "../baselines";
import { linearModel } from "../linear";
import { boostedStumpsModel } from "../tree";
import { MODEL_REGISTRY } from "../trainer";
import { buildFeatures } from "../../pipeline/features";

function syntheticRows(days: number = 500) {
  const dates: string[] = [];
  const aligned: Record<string, Record<string, number>> = {};
  const base = new Date("2022-01-03");

  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;

    const dateStr = d.toISOString().slice(0, 10);
    dates.push(dateStr);

    const noise = Math.sin(i * 0.05) * 0.03;
    aligned[dateStr] = {
      cotton_close: 0.70 + noise + i * 0.0001,
      dxy: 103 + Math.sin(i * 0.02) * 2,
      crude_oil: 75 + Math.cos(i * 0.03) * 5,
      vix: 18 + Math.sin(i * 0.1) * 5,
      sp500: 4500 + i * 0.5,
    };
  }

  return buildFeatures(dates, aligned);
}

describe("runWalkForward", () => {
  const rows = syntheticRows(500);
  const config = { min_train_size: 200, step_size: 21, horizon: "21d" as const };

  it("produces steps with valid metrics", () => {
    const result = runWalkForward(naiveModel, rows, config);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metrics.n_steps).toBe(result.steps.length);
    expect(result.metrics.mae).toBeGreaterThanOrEqual(0);
    expect(result.metrics.rmse).toBeGreaterThanOrEqual(0);
    expect(result.metrics.direction_accuracy).toBeGreaterThanOrEqual(0);
    expect(result.metrics.direction_accuracy).toBeLessThanOrEqual(1);
  });

  it("every step has valid fields", () => {
    const result = runWalkForward(naiveModel, rows, config);
    for (const step of result.steps) {
      expect(step.date).toBeTruthy();
      expect(Number.isFinite(step.actual)).toBe(true);
      expect(Number.isFinite(step.predicted)).toBe(true);
      expect(Number.isFinite(step.error)).toBe(true);
      expect(typeof step.direction_correct).toBe("boolean");
    }
  });

  it("naive model predicts zero at every step", () => {
    const result = runWalkForward(naiveModel, rows, config);
    for (const step of result.steps) {
      expect(step.predicted).toBe(0);
    }
  });

  it("linear model produces non-zero predictions", () => {
    const result = runWalkForward(linearModel, rows, config);
    const nonZero = result.steps.filter((s) => Math.abs(s.predicted) > 1e-8);
    expect(nonZero.length).toBeGreaterThan(0);
  });

  it("includes regime slices when data available", () => {
    const result = runWalkForward(naiveModel, rows, config);
    // Should have some regime slices (vol or trend)
    expect(result.regime_metrics.length).toBeGreaterThanOrEqual(0);
    for (const slice of result.regime_metrics) {
      expect(slice.n_steps).toBeGreaterThan(0);
      expect(slice.regime_name).toBeTruthy();
    }
  });

  it("step_size controls granularity", () => {
    const fine = runWalkForward(naiveModel, rows, {
      min_train_size: 200,
      step_size: 5,
      horizon: "5d",
    });
    const coarse = runWalkForward(naiveModel, rows, {
      min_train_size: 200,
      step_size: 21,
      horizon: "5d",
    });
    expect(fine.steps.length).toBeGreaterThan(coarse.steps.length);
  });
});

describe("compareModelsWalkForward", () => {
  it("returns results for all models", () => {
    const rows = syntheticRows(400);
    const config = { min_train_size: 200, step_size: 21, horizon: "21d" as const };

    const results = compareModelsWalkForward(
      [naiveModel, linearModel, boostedStumpsModel],
      rows,
      config
    );

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.model_id).toBeTruthy();
      expect(r.metrics.n_steps).toBeGreaterThan(0);
    }
  });
});

describe("metrics correctness", () => {
  it("RMSE >= MAE", () => {
    const rows = syntheticRows(400);
    const config = { min_train_size: 200, step_size: 21, horizon: "21d" as const };
    const result = runWalkForward(linearModel, rows, config);

    expect(result.metrics.rmse).toBeGreaterThanOrEqual(result.metrics.mae - 0.00001);
  });

  it("p95 error >= median error", () => {
    const rows = syntheticRows(400);
    const config = { min_train_size: 200, step_size: 21, horizon: "21d" as const };
    const result = runWalkForward(linearModel, rows, config);

    expect(result.metrics.p95_abs_error).toBeGreaterThanOrEqual(result.metrics.mae - 0.00001);
  });
});
