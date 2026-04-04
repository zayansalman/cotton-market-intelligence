import { describe, it, expect } from "vitest";
import { evaluateConstraints } from "../constraints";
import { scoreFeasibility } from "../feasibility";
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

describe("evaluateConstraints", () => {
  it("returns neutral multipliers for minimal input", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
    };
    const result = evaluateConstraints(input, MOCK_BM, 6);
    expect(result.pacing_multipliers).toEqual([1, 1, 1, 1, 1, 1]);
    expect(result.binding_constraints).toEqual([]);
  });

  it("front-loads for urgent timeline", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      timeline: { urgency_level: "urgent" },
    };
    const result = evaluateConstraints(input, MOCK_BM, 6);
    expect(result.pacing_multipliers[0]).toBeGreaterThan(1);
    expect(result.binding_constraints).toContain("Urgency: urgent");
  });

  it("front-loads more aggressively for emergency", () => {
    const urgent: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      timeline: { urgency_level: "urgent" },
    };
    const emergency: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      timeline: { urgency_level: "emergency" },
    };
    const urgResult = evaluateConstraints(urgent, MOCK_BM, 6);
    const emResult = evaluateConstraints(emergency, MOCK_BM, 6);
    expect(emResult.pacing_multipliers[0]).toBeGreaterThan(
      urgResult.pacing_multipliers[0]
    );
  });

  it("caps multipliers when receipt capacity is limited", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 3000, planning_horizon_months: 6 },
      timeline: {
        urgency_level: "urgent",
        max_monthly_receipt_capacity_tonnes: 300,
      },
    };
    const result = evaluateConstraints(input, MOCK_BM, 6);
    expect(result.binding_constraints.some((c) => c.includes("Receipt capacity"))).toBe(true);
    expect(result.constraint_risks.length).toBeGreaterThan(0);
  });

  it("flags single-origin risk", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      quality: { preferred_origins: ["India"] },
    };
    const result = evaluateConstraints(input, MOCK_BM, 6);
    expect(result.binding_constraints.some((c) => c.includes("Single origin"))).toBe(true);
    expect(result.constraint_risks.some((r) => r.includes("concentration"))).toBe(true);
  });

  it("smooths allocation for strict quality specs", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      quality: {
        strength_min_gpt: 31,
        staple_length_range: { min: 30, max: 34 },
        micronaire_range: { min: 4.0, max: 4.5 },
        leaf_trash_max: 2,
      },
    };
    const result = evaluateConstraints(input, MOCK_BM, 6);
    expect(
      result.binding_constraints.some((c) => c.includes("Tight quality"))
    ).toBe(true);
    // Smoothing should make multipliers closer to 1
    for (const m of result.pacing_multipliers) {
      expect(m).toBeGreaterThan(0);
      expect(m).toBeLessThanOrEqual(1.01);
    }
  });

  it("records credit constraint", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      finance: { max_credit_days: 60 },
    };
    const result = evaluateConstraints(input, MOCK_BM, 6);
    expect(result.binding_constraints.some((c) => c.includes("Credit"))).toBe(true);
    // Should dampen early months
    expect(result.pacing_multipliers[0]).toBeLessThan(1);
  });

  it("records logistics assumptions", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      logistics: {
        incoterm: "CIF",
        discharge_port: "Chattogram",
        inland_delivery: { required: true, mill_location: "Gazipur" },
      },
    };
    const result = evaluateConstraints(input, MOCK_BM, 6);
    expect(result.assumption_set.incoterm).toBe("CIF");
    expect(result.assumption_set.discharge_port).toBe("Chattogram");
    expect(result.binding_constraints.some((c) => c.includes("Inland"))).toBe(true);
  });
});

describe("scoreFeasibility", () => {
  it("returns 100 for unconstrained input", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
    };
    const constraints = evaluateConstraints(input, MOCK_BM, 6);
    expect(scoreFeasibility(input, constraints)).toBe(100);
  });

  it("deducts for emergency + single origin + tight credit", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      timeline: { urgency_level: "emergency" },
      quality: { preferred_origins: ["US"] },
      finance: { max_credit_days: 30 },
    };
    const constraints = evaluateConstraints(input, MOCK_BM, 6);
    const score = scoreFeasibility(input, constraints);
    expect(score).toBeLessThan(60);
    expect(score).toBeGreaterThan(0);
  });

  it("never goes below 0", () => {
    const input: PurchaserInput = {
      demand: { required_tonnes: 10000, planning_horizon_months: 2 },
      timeline: {
        urgency_level: "emergency",
        max_monthly_receipt_capacity_tonnes: 100,
      },
      quality: {
        preferred_origins: ["Australia"],
        strength_min_gpt: 33,
        staple_length_range: { min: 32, max: 34 },
        micronaire_range: { min: 4.0, max: 4.3 },
        leaf_trash_max: 1,
      },
      finance: { max_credit_days: 30, max_supplier_concentration_pct: 20 },
    };
    const constraints = evaluateConstraints(input, MOCK_BM, 2);
    expect(scoreFeasibility(input, constraints)).toBeGreaterThanOrEqual(0);
  });
});
