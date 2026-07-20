import { describe, expect, it } from "vitest";
import { buildStrategyRequestBody, largestRemainder } from "./useStrategy";
import type { PurchaserInput, Benchmarks } from "@/lib/types";

const MOCK_BENCHMARKS: Benchmarks = {
  current_price: 0.72,
  price_date: "2026-03-28",
  change_30d_pct: -2.1,
  change_90d_pct: 5.3,
  pct_rank_1y: 0.45,
  pct_rank_5y: 0.38,
  z_score_1y: -0.3,
  vol_30d_ann: 22,
  vol_90d_ann: 25,
  ma_50d: 0.73,
  ma_200d: 0.71,
  above_ma_50d: false,
  above_ma_200d: true,
  high_1y: 0.85,
  low_1y: 0.62,
};

describe("buildStrategyRequestBody", () => {
  it("builds the V2 strategy payload with full purchaser input", () => {
    const purchaserInput: PurchaserInput = {
      demand: {
        required_tonnes: 2400,
        planning_horizon_months: 6,
      },
      timeline: {
        urgency_level: "urgent",
        max_monthly_receipt_capacity_tonnes: 350,
      },
      quality: {
        preferred_origins: ["US", "Brazil"],
        hvi_required: true,
      },
      finance: {
        max_credit_days: 60,
      },
    };

    const result = buildStrategyRequestBody({
      benchmarks: MOCK_BENCHMARKS,
      headlines: [],
      landedCost: null,
      purchaserInput,
    });

    expect(result.strategy_input_version).toBe(2);
    expect(result.purchaser_input).toEqual(purchaserInput);
    expect(result.purchaser_input.timeline?.urgency_level).toBe("urgent");
    expect(result.purchaser_input.quality?.preferred_origins).toEqual([
      "US",
      "Brazil",
    ]);
    expect("landedCost" in result).toBe(false);
  });

  it("includes the analyst market forecast when supplied", () => {
    const purchaserInput: PurchaserInput = {
      demand: {
        required_tonnes: 1200,
        planning_horizon_months: 3,
      },
    };
    const marketForecast = {
      current_price: 0.72,
      current_date: "2026-03-28",
      forecasts: [{
        horizon: "21d",
        predicted_return: 0.012,
        predicted_price: 0.7286,
        direction: "up",
      }],
      model: {
        id: "llm_synthesis",
        name: "LLM analyst synthesis (Qwen 2.5 72B)",
        kind: "llm_synthesis",
      },
    };

    const result = buildStrategyRequestBody({
      benchmarks: MOCK_BENCHMARKS,
      headlines: [],
      landedCost: null,
      marketForecast,
      purchaserInput,
    });

    expect(result.marketForecast).toEqual(marketForecast);
  });
});

describe("largestRemainder", () => {
  it("apportions tonnes so they sum to exactly the total", () => {
    const alloc = largestRemainder([1.5, 1.5, 1, 1, 1, 1], 3000);
    expect(alloc.reduce((s, v) => s + v, 0)).toBe(3000);
    expect(alloc.every((v) => Number.isInteger(v))).toBe(true);
  });

  it("apportions pct-tenths so they sum to exactly 1000 (=100.0%)", () => {
    const weights = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]; // 7 equal months
    const tenths = largestRemainder(weights, 1000);
    expect(tenths.reduce((s, v) => s + v, 0)).toBe(1000);
  });

  it("keeps proportionality — larger weights get more units", () => {
    const alloc = largestRemainder([3, 1], 100);
    expect(alloc[0]).toBeGreaterThan(alloc[1]);
    expect(alloc[0] + alloc[1]).toBe(100);
  });

  it("handles zero/negative weights and totals safely", () => {
    expect(largestRemainder([0, 0], 100)).toEqual([0, 0]);
    expect(largestRemainder([1, 1], 0)).toEqual([0, 0]);
    expect(largestRemainder([-1, 2], 90)).toEqual([0, 90]);
  });
});
