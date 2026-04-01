import { describe, it, expect } from "vitest";
import { heuristicStrategyV2 } from "../heuristic-v2";
import type { PurchaserInput } from "@/lib/schemas/purchaser-input";
import type { Benchmarks } from "@/lib/types";

const MOCK_BM: Benchmarks = {
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

describe("heuristicStrategyV2", () => {
  it("produces valid strategy for minimal input", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
    };
    const result = heuristicStrategyV2(input, MOCK_BM);
    expect(result.signal).toBeDefined();
    expect(result.monthly_plan.length).toBe(6);
    expect(result.source).toBe("heuristic");
    expect(result.plan_feasibility_score).toBe(100);
    expect(result.binding_constraints).toEqual([]);
  });

  it("different constraints produce different allocations", () => {
    const basic: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
    };
    const constrained: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      timeline: { urgency_level: "emergency" },
      finance: { max_credit_days: 30 },
    };

    const r1 = heuristicStrategyV2(basic, MOCK_BM);
    const r2 = heuristicStrategyV2(constrained, MOCK_BM);

    // Allocations should differ
    const allocs1 = r1.monthly_plan.map((p) => p.pct);
    const allocs2 = r2.monthly_plan.map((p) => p.pct);
    expect(allocs1).not.toEqual(allocs2);

    // Constrained should have lower feasibility
    expect(r2.plan_feasibility_score).toBeLessThan(r1.plan_feasibility_score);
  });

  it("monthly plan percentages sum to ~100", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 5000, planning_horizon_months: 12 },
      timeline: { urgency_level: "urgent" },
      quality: { preferred_origins: ["US", "Brazil"] },
      finance: { max_credit_days: 90 },
    };
    const result = heuristicStrategyV2(input, MOCK_BM);
    const total = result.monthly_plan.reduce((s, p) => s + p.pct, 0);
    expect(total).toBeGreaterThan(98);
    expect(total).toBeLessThan(102);
  });

  it("includes binding constraints in response", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      timeline: { urgency_level: "urgent" },
      logistics: { incoterm: "CIF" },
      finance: { max_credit_days: 60 },
    };
    const result = heuristicStrategyV2(input, MOCK_BM);
    expect(result.binding_constraints.length).toBeGreaterThan(0);
    expect(result.assumption_set).toBeDefined();
    expect(Object.keys(result.assumption_set).length).toBeGreaterThan(0);
  });

  it("includes constraint info in market_analysis text", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      timeline: { urgency_level: "urgent" },
    };
    const result = heuristicStrategyV2(input, MOCK_BM);
    expect(result.market_analysis).toContain("Binding constraints");
  });
});
