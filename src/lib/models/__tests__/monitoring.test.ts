/**
 * Monitoring and drift detection tests (#32).
 */

import { describe, it, expect } from "vitest";
import {
  detectFeatureDrift,
  detectConceptDrift,
  evaluateRetrainingNeed,
  defineSLOs,
} from "../monitoring";

describe("detectFeatureDrift", () => {
  it("detects significant mean shift", () => {
    const baseline = { vix: Array(100).fill(18) };
    const recent = { vix: Array(20).fill(30) }; // big shift

    const results = detectFeatureDrift(baseline, recent, 20);
    expect(results).toHaveLength(1);
    expect(results[0].is_drifted).toBe(true);
    expect(results[0].drift_pct).toBeGreaterThan(20);
  });

  it("passes stable features", () => {
    const baseline = { vix: Array(100).fill(18) };
    const recent = { vix: Array(20).fill(19) }; // small shift

    const results = detectFeatureDrift(baseline, recent, 20);
    expect(results[0].is_drifted).toBe(false);
  });

  it("handles multiple features", () => {
    const baseline = {
      vix: Array(100).fill(18),
      dxy: Array(100).fill(103),
    };
    const recent = {
      vix: Array(20).fill(35), // drifted
      dxy: Array(20).fill(104), // stable
    };

    const results = detectFeatureDrift(baseline, recent, 20);
    expect(results).toHaveLength(2);
    const drifted = results.filter((r) => r.is_drifted);
    expect(drifted).toHaveLength(1);
    expect(drifted[0].metric).toBe("vix");
  });
});

describe("detectConceptDrift", () => {
  it("detects error increase", () => {
    const historical = Array(50).fill(0.01);
    const recent = Array(10).fill(0.05); // 5x increase

    const result = detectConceptDrift(historical, recent, 30);
    expect(result.is_drifted).toBe(true);
    expect(result.drift_pct).toBeGreaterThan(100);
  });

  it("passes stable errors", () => {
    const historical = Array(50).fill(0.02);
    const recent = Array(10).fill(0.022);

    const result = detectConceptDrift(historical, recent, 30);
    expect(result.is_drifted).toBe(false);
  });

  it("handles empty arrays", () => {
    const result = detectConceptDrift([], [], 30);
    expect(result.is_drifted).toBe(false);
  });
});

describe("evaluateRetrainingNeed", () => {
  const noDrift = {
    metric: "prediction_error",
    current_value: 0.02,
    baseline_value: 0.02,
    drift_pct: 0,
    is_drifted: false,
    threshold_pct: 30,
  };

  it("triggers on stale model", () => {
    const signal = evaluateRetrainingNeed({
      daysSinceRetrain: 45,
      conceptDrift: noDrift,
      featureDrifts: [],
      rollingMae: 0.02,
      maeThreshold: 0.05,
    });
    expect(signal.should_retrain).toBe(true);
    expect(signal.reasons[0]).toContain("45 days");
  });

  it("triggers on concept drift", () => {
    const signal = evaluateRetrainingNeed({
      daysSinceRetrain: 5,
      conceptDrift: { ...noDrift, is_drifted: true, drift_pct: 50 },
      featureDrifts: [],
      rollingMae: 0.02,
      maeThreshold: 0.05,
    });
    expect(signal.should_retrain).toBe(true);
    expect(signal.urgency).toBe("high");
  });

  it("triggers on multiple feature drifts", () => {
    const driftedFeature = {
      metric: "f1", current_value: 1, baseline_value: 0.5,
      drift_pct: 100, is_drifted: true, threshold_pct: 20,
    };
    const signal = evaluateRetrainingNeed({
      daysSinceRetrain: 5,
      conceptDrift: noDrift,
      featureDrifts: [driftedFeature, driftedFeature, driftedFeature],
      rollingMae: 0.02,
      maeThreshold: 0.05,
    });
    expect(signal.should_retrain).toBe(true);
    expect(signal.reasons.some((r) => r.includes("features drifted"))).toBe(true);
  });

  it("does not trigger when everything is healthy", () => {
    const signal = evaluateRetrainingNeed({
      daysSinceRetrain: 5,
      conceptDrift: noDrift,
      featureDrifts: [],
      rollingMae: 0.02,
      maeThreshold: 0.05,
    });
    expect(signal.should_retrain).toBe(false);
    expect(signal.urgency).toBe("low");
  });
});

describe("defineSLOs", () => {
  it("returns SLOs for a horizon", () => {
    const slos = defineSLOs(0.02, 0.55, 0, "21d");
    expect(slos.length).toBe(3);
    expect(slos.every((s) => s.met)).toBe(true);
  });

  it("marks stale predictions as failing", () => {
    const slos = defineSLOs(0.02, 0.55, 3, "21d");
    const freshness = slos.find((s) => s.metric === "Prediction freshness");
    expect(freshness?.met).toBe(false);
  });

  it("marks poor direction accuracy as failing", () => {
    const slos = defineSLOs(0.02, 0.45, 0, "21d");
    const dirAcc = slos.find((s) => s.metric === "Direction accuracy");
    expect(dirAcc?.met).toBe(false);
  });
});
