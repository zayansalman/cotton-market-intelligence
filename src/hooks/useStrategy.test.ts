import { describe, expect, it } from "vitest";
import { buildStrategyRequestBody } from "./useStrategy";
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
});
