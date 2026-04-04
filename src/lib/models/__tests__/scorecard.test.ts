/**
 * Accuracy scorecard tests (#31).
 */

import { describe, it, expect } from "vitest";
import { generateScorecard } from "../scorecard";
import type { WalkForwardResult, WalkForwardMetrics } from "../walk-forward";
import type { Horizon } from "../types";

function makeResult(
  modelId: string,
  modelName: string,
  horizon: Horizon,
  overrides: Partial<WalkForwardMetrics> = {}
): WalkForwardResult {
  return {
    model_id: modelId,
    model_name: modelName,
    horizon,
    config: { min_train_size: 200, step_size: 21, horizon },
    steps: [],
    metrics: {
      n_steps: 30,
      mae: 0.02,
      rmse: 0.03,
      mape: 50,
      smape: 45,
      direction_accuracy: 0.55,
      mean_error: 0.001,
      p95_abs_error: 0.06,
      information_ratio: 0.1,
      ...overrides,
    },
    regime_metrics: [],
  };
}

describe("generateScorecard", () => {
  it("rates green when champion beats naive", () => {
    const results: Record<Horizon, WalkForwardResult[]> = {
      "5d": [
        makeResult("naive", "Naive", "5d", { rmse: 0.05 }),
        makeResult("ridge", "Ridge", "5d", { rmse: 0.04, direction_accuracy: 0.55 }),
      ],
      "21d": [
        makeResult("naive", "Naive", "21d", { rmse: 0.08 }),
        makeResult("ridge", "Ridge", "21d", { rmse: 0.06, direction_accuracy: 0.55 }),
      ],
      "63d": [
        makeResult("naive", "Naive", "63d", { rmse: 0.12 }),
        makeResult("ridge", "Ridge", "63d", { rmse: 0.09, direction_accuracy: 0.58 }),
      ],
    };

    const sc = generateScorecard(results);
    expect(sc.overall_rating).toBe("green");
    expect(sc.production_ready).toBe(true);
    expect(sc.champion_model).toBe("ridge");
  });

  it("rates red when champion loses to naive", () => {
    const results: Record<Horizon, WalkForwardResult[]> = {
      "5d": [
        makeResult("naive", "Naive", "5d", { rmse: 0.03 }),
        makeResult("ridge", "Ridge", "5d", { rmse: 0.05 }), // worse
      ],
      "21d": [
        makeResult("naive", "Naive", "21d", { rmse: 0.05 }),
        makeResult("ridge", "Ridge", "21d", { rmse: 0.06 }),
      ],
      "63d": [
        makeResult("naive", "Naive", "63d", { rmse: 0.08 }),
        makeResult("ridge", "Ridge", "63d", { rmse: 0.09 }),
      ],
    };

    const sc = generateScorecard(results);
    expect(sc.overall_rating).toBe("red");
    expect(sc.production_ready).toBe(false);
  });

  it("rates yellow when improvement is marginal", () => {
    const results: Record<Horizon, WalkForwardResult[]> = {
      "5d": [
        makeResult("naive", "Naive", "5d", { rmse: 0.05 }),
        makeResult("ridge", "Ridge", "5d", { rmse: 0.049, direction_accuracy: 0.51 }), // barely beats
      ],
      "21d": [
        makeResult("naive", "Naive", "21d", { rmse: 0.08 }),
        makeResult("ridge", "Ridge", "21d", { rmse: 0.079, direction_accuracy: 0.51 }),
      ],
      "63d": [
        makeResult("naive", "Naive", "63d", { rmse: 0.12 }),
        makeResult("ridge", "Ridge", "63d", { rmse: 0.119, direction_accuracy: 0.51 }),
      ],
    };

    const sc = generateScorecard(results);
    expect(sc.overall_rating).toBe("yellow");
  });

  it("includes go/no-go criteria", () => {
    const results: Record<Horizon, WalkForwardResult[]> = {
      "5d": [makeResult("naive", "Naive", "5d")],
      "21d": [makeResult("naive", "Naive", "21d")],
      "63d": [makeResult("naive", "Naive", "63d")],
    };

    const sc = generateScorecard(results);
    expect(sc.go_nogo_criteria.length).toBeGreaterThan(0);
    for (const c of sc.go_nogo_criteria) {
      expect(c.criterion).toBeTruthy();
      expect(typeof c.passed).toBe("boolean");
    }
  });

  it("handles empty horizons gracefully", () => {
    const sc = generateScorecard({ "5d": [], "21d": [], "63d": [] });
    expect(sc.horizons).toHaveLength(0);
    expect(sc.overall_rating).toBe("green"); // no failing horizons
  });
});
