import { describe, it, expect } from "vitest";
import { parseStrategyRequest } from "../strategy-request";
import { PRESET_BANGLADESH_SPINNER } from "../purchaser-input";

const MOCK_BENCHMARKS = {
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

const MOCK_HEADLINES = [
  {
    title: "USDA raises cotton export forecast",
    summary: "...",
    link: "https://example.com",
    published: "2026-03-28",
  },
];

describe("parseStrategyRequest", () => {
  describe("legacy payload", () => {
    it("accepts valid legacy input", () => {
      const result = parseStrategyRequest({
        tonnage: 2000,
        months: 6,
        benchmarks: MOCK_BENCHMARKS,
        headlines: MOCK_HEADLINES,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.purchaserInput.demand.required_tonnes).toBe(2000);
        expect(result.data.purchaserInput.demand.planning_horizon_months).toBe(6);
      }
    });

    it("legacy input has no advanced sections", () => {
      const result = parseStrategyRequest({
        tonnage: 1000,
        months: 3,
        benchmarks: MOCK_BENCHMARKS,
        headlines: [],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.purchaserInput.timeline).toBeUndefined();
        expect(result.data.purchaserInput.quality).toBeUndefined();
      }
    });
  });

  describe("V2 payload", () => {
    it("accepts valid V2 input with preset", () => {
      const result = parseStrategyRequest({
        strategy_input_version: 2,
        purchaser_input: PRESET_BANGLADESH_SPINNER,
        benchmarks: MOCK_BENCHMARKS,
        headlines: MOCK_HEADLINES,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.purchaserInput.demand.required_tonnes).toBe(2000);
        expect(result.data.purchaserInput.quality?.preferred_origins).toContain("US");
      }
    });

    it("accepts minimal V2 input", () => {
      const result = parseStrategyRequest({
        strategy_input_version: 2,
        purchaser_input: {
          demand: { required_tonnes: 500, planning_horizon_months: 3 },
        },
        benchmarks: MOCK_BENCHMARKS,
        headlines: [],
      });
      expect(result.ok).toBe(true);
    });

    it("passes advanced purchaser fields through unchanged", () => {
      const purchaserInput = {
        demand: { required_tonnes: 1800, planning_horizon_months: 4 },
        timeline: {
          urgency_level: "urgent" as const,
          max_monthly_receipt_capacity_tonnes: 300,
        },
        quality: {
          preferred_origins: ["India"],
          hvi_required: true,
        },
        logistics: {
          incoterm: "CFR" as const,
          discharge_port: "Chattogram",
        },
        finance: {
          max_credit_days: 45,
          fx_assumption: 118,
        },
      };

      const result = parseStrategyRequest({
        strategy_input_version: 2,
        purchaser_input: purchaserInput,
        benchmarks: MOCK_BENCHMARKS,
        headlines: [],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.purchaserInput).toEqual(purchaserInput);
      }
    });

    it("accepts V2 with an analyst market forecast", () => {
      const result = parseStrategyRequest({
        strategy_input_version: 2,
        purchaser_input: {
          demand: { required_tonnes: 500, planning_horizon_months: 3 },
        },
        benchmarks: MOCK_BENCHMARKS,
        headlines: [],
        marketForecast: {
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
          confidence: 72,
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.marketForecast?.model.kind).toBe("llm_synthesis");
      }
    });

    it("rejects V2 with invalid purchaser_input", () => {
      const result = parseStrategyRequest({
        strategy_input_version: 2,
        purchaser_input: {
          demand: { required_tonnes: 0, planning_horizon_months: 6 },
        },
        benchmarks: MOCK_BENCHMARKS,
        headlines: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].field).toContain("required_tonnes");
      }
    });

    it("accepts V2 with missing benchmarks (runtime validated downstream)", () => {
      const result = parseStrategyRequest({
        strategy_input_version: 2,
        purchaser_input: {
          demand: { required_tonnes: 1000, planning_horizon_months: 6 },
        },
        benchmarks: MOCK_BENCHMARKS,
        headlines: [],
      });
      expect(result.ok).toBe(true);
    });

    it("returns structured errors with suggested_fix", () => {
      const result = parseStrategyRequest({
        strategy_input_version: 2,
        purchaser_input: {
          demand: { required_tonnes: "not a number", planning_horizon_months: 6 },
        },
        benchmarks: MOCK_BENCHMARKS,
        headlines: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.errors[0];
        expect(err.field).toBeDefined();
        expect(err.reason).toBeDefined();
      }
    });
  });

  describe("unrecognized payload", () => {
    it("rejects completely empty body", () => {
      const result = parseStrategyRequest({});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].reason).toContain("Unrecognized");
      }
    });

    it("rejects payload with random keys", () => {
      const result = parseStrategyRequest({ foo: "bar", baz: 123 });
      expect(result.ok).toBe(false);
    });
  });
});
