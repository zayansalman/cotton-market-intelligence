/**
 * Model stack tests (#25).
 */

import { describe, it, expect } from "vitest";
import { naiveModel, historicalMeanModel, seasonalNaiveModel } from "../baselines";
import { linearModel } from "../linear";
import { boostedStumpsModel } from "../tree";
import { trainAndEvaluate, MODEL_REGISTRY } from "../trainer";
import { buildFeatures } from "../../pipeline/features";

/* ------------------------------------------------------------------ */
/*  Synthetic data helper                                              */
/* ------------------------------------------------------------------ */

function syntheticFeatureRows(days: number = 400) {
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

/* ------------------------------------------------------------------ */
/*  Individual model tests                                             */
/* ------------------------------------------------------------------ */

describe("naive model", () => {
  it("predicts zero", () => {
    const state = naiveModel.fit([], []);
    expect(naiveModel.predict(state, []).value).toBe(0);
  });
});

describe("historical mean model", () => {
  it("predicts training mean", () => {
    const targets = [0.01, 0.02, 0.03];
    const state = historicalMeanModel.fit([[1], [2], [3]], targets, []);
    expect(historicalMeanModel.predict(state, []).value).toBeCloseTo(0.02, 5);
  });
});

describe("linear model", () => {
  it("fits a simple linear relationship", () => {
    // y = 0.5 * x
    const X = Array.from({ length: 100 }, (_, i) => [i / 100]);
    const y = X.map((row) => row[0] * 0.5 + (Math.random() - 0.5) * 0.01);

    const state = linearModel.fit(X, y, ["x"]);
    const pred = linearModel.predict(state, [0.5]);
    expect(pred.value).toBeCloseTo(0.25, 1);
  });

  it("returns zero for insufficient data", () => {
    const state = linearModel.fit([[1]], [1], ["x"]);
    expect(linearModel.predict(state, [1]).value).toBe(0);
  });
});

describe("boosted stumps model", () => {
  it("fits non-linear patterns", () => {
    // y = sign(x1 - 0.5) * 0.1
    const X = Array.from({ length: 200 }, (_, i) => [i / 200]);
    const y = X.map((row) => (row[0] > 0.5 ? 0.1 : -0.1));

    const state = boostedStumpsModel.fit(X, y, ["x"]);
    const predLow = boostedStumpsModel.predict(state, [0.2]);
    const predHigh = boostedStumpsModel.predict(state, [0.8]);

    expect(predLow.value).toBeLessThan(0);
    expect(predHigh.value).toBeGreaterThan(0);
  });

  it("returns zero for insufficient data", () => {
    const state = boostedStumpsModel.fit([[1]], [1], ["x"]);
    expect(boostedStumpsModel.predict(state, [1]).value).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Trainer integration test                                           */
/* ------------------------------------------------------------------ */

describe("trainAndEvaluate", () => {
  it("trains all models and selects champion", () => {
    const rows = syntheticFeatureRows(500);
    const result = trainAndEvaluate(rows, "21d");

    expect(result.results.length).toBe(MODEL_REGISTRY.length);
    expect(result.champion).toBeDefined();
    expect(result.champion.model_id).toBeDefined();
    expect(result.champion.rmse).toBeGreaterThan(0);
  });

  it("all models have valid metrics", () => {
    const rows = syntheticFeatureRows(500);
    const result = trainAndEvaluate(rows, "5d");

    for (const r of result.results) {
      expect(r.mae).toBeGreaterThanOrEqual(0);
      expect(r.rmse).toBeGreaterThanOrEqual(0);
      expect(r.direction_accuracy).toBeGreaterThanOrEqual(0);
      expect(r.direction_accuracy).toBeLessThanOrEqual(1);
      expect(r.n_train).toBeGreaterThan(0);
      expect(r.n_test).toBeGreaterThan(0);
    }
  });

  it("champion beats naive baseline or is naive", () => {
    const rows = syntheticFeatureRows(500);
    const result = trainAndEvaluate(rows, "21d");

    const naive = result.results.find((r) => r.model_id === "naive");
    // Champion is either naive itself or has lower RMSE
    expect(
      result.champion.model_id === "naive" ||
      result.champion.rmse <= naive!.rmse
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

describe("MODEL_REGISTRY", () => {
  it("has unique model IDs", () => {
    const ids = MODEL_REGISTRY.map((m) => m.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes baselines and advanced models", () => {
    const types = new Set(MODEL_REGISTRY.map((m) => m.meta.type));
    expect(types.has("baseline")).toBe(true);
    expect(types.has("statistical")).toBe(true);
    expect(types.has("ml")).toBe(true);
  });
});
