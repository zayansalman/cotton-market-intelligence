import { describe, it, expect } from "vitest";
import {
  toBarData,
  paddedDomain,
  type PredictionHistoryEntry,
} from "../PredictedVsActualChart";

function entry(over: Partial<PredictionHistoryEntry>): PredictionHistoryEntry {
  return {
    target_date: "2026-06-01",
    prediction_date: "2026-05-04",
    predicted_price: 0.68,
    actual_price: 0.67,
    direction_correct: true,
    error_pct: 1.5,
    model_id: "model_stack_v2",
    model_name: "Model stack",
    ...over,
  };
}

describe("toBarData", () => {
  it("keeps only resolved predictions (actual_price present)", () => {
    const out = toBarData(
      [
        entry({ target_date: "2026-06-01", actual_price: 0.67 }),
        entry({ target_date: "2026-06-02", actual_price: null }),
      ],
      10
    );
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("06-01");
  });

  it("drops rows with a non-finite predicted price", () => {
    const out = toBarData(
      [entry({ predicted_price: Number.NaN, actual_price: 0.67 })],
      10
    );
    expect(out).toHaveLength(0);
  });

  it("sorts oldest→newest and keeps the most recent maxBars", () => {
    const out = toBarData(
      [
        entry({ target_date: "2026-06-03" }),
        entry({ target_date: "2026-06-01" }),
        entry({ target_date: "2026-06-02" }),
      ],
      2
    );
    // Most recent two, in ascending order.
    expect(out.map((d) => d.label)).toEqual(["06-02", "06-03"]);
  });

  it("flags reconstructed 'would have generated' rows", () => {
    const out = toBarData(
      [
        entry({ model_id: "historical_heuristic" }),
        entry({ target_date: "2026-06-02", model_id: "model_stack_v2" }),
      ],
      10
    );
    expect(out.find((d) => d.label === "06-01")?.reconstructed).toBe(true);
    expect(out.find((d) => d.label === "06-02")?.reconstructed).toBe(false);
  });

  it("carries direction correctness and error through", () => {
    const [d] = toBarData(
      [entry({ direction_correct: false, error_pct: -3.2 })],
      10
    );
    expect(d.directionCorrect).toBe(false);
    expect(d.errorPct).toBe(-3.2);
  });
});

describe("paddedDomain", () => {
  it("never anchors at zero for a narrow band, so bars stay distinguishable", () => {
    const data = toBarData(
      [
        entry({ target_date: "2026-06-01", predicted_price: 0.684, actual_price: 0.672 }),
        entry({ target_date: "2026-06-02", predicted_price: 0.701, actual_price: 0.711 }),
      ],
      10
    );
    const [min, max] = paddedDomain(data);
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThan(0.672);
    expect(max).toBeGreaterThan(0.711);
  });

  it("falls back to a safe default for an empty set", () => {
    expect(paddedDomain([])).toEqual([0, 1]);
  });
});
