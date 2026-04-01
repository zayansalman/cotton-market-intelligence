import { describe, it, expect } from "vitest";
import {
  purchaserInputSchema,
  PRESET_BANGLADESH_SPINNER,
  PRESET_FAST_REPLENISHMENT,
  PRESET_QUALITY_CRITICAL,
  PRESETS,
} from "../purchaser-input";
import {
  isLegacyInput,
  legacyToPurchaserInput,
} from "../legacy-adapter";

/* ------------------------------------------------------------------ */
/*  Schema validation                                                 */
/* ------------------------------------------------------------------ */

describe("purchaserInputSchema", () => {
  it("accepts minimal valid input (only required fields)", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000, planning_horizon_months: 6 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required_tonnes", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { planning_horizon_months: 6 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing planning_horizon_months", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero tonnes", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 0, planning_horizon_months: 6 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects horizon > 24 months", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000, planning_horizon_months: 25 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts full Bangladesh spinner preset", () => {
    const result = purchaserInputSchema.safeParse(PRESET_BANGLADESH_SPINNER);
    expect(result.success).toBe(true);
  });

  it("accepts fast replenishment preset", () => {
    const result = purchaserInputSchema.safeParse(PRESET_FAST_REPLENISHMENT);
    expect(result.success).toBe(true);
  });

  it("accepts quality-critical preset", () => {
    const result = purchaserInputSchema.safeParse(PRESET_QUALITY_CRITICAL);
    expect(result.success).toBe(true);
  });

  it("rejects inverted numeric range (min > max)", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000, planning_horizon_months: 6 },
      quality: { staple_length_range: { min: 35, max: 28 } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects inverted date window (first_arrival > latest_arrival)", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000, planning_horizon_months: 6 },
      timeline: {
        first_arrival_earliest: "2026-12-01",
        latest_arrival_date: "2026-06-01",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid date window", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000, planning_horizon_months: 6 },
      timeline: {
        first_arrival_earliest: "2026-06-01",
        latest_arrival_date: "2026-12-01",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = purchaserInputSchema.safeParse({
      demand: {
        required_tonnes: 1000,
        planning_horizon_months: 6,
        required_by_date: "June 2026",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid pricing_mode", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000, planning_horizon_months: 6 },
      commercial: { pricing_mode: "magic" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid incoterm", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000, planning_horizon_months: 6 },
      logistics: { incoterm: "MAGIC" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects leaf_trash_max out of range", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000, planning_horizon_months: 6 },
      quality: { leaf_trash_max: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_supplier_concentration_pct > 100", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 1000, planning_horizon_months: 6 },
      finance: { max_supplier_concentration_pct: 150 },
    });
    expect(result.success).toBe(false);
  });

  it("provides user-readable error messages", () => {
    const result = purchaserInputSchema.safeParse({
      demand: { required_tonnes: 0, planning_horizon_months: 6 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("Minimum 1 tonne"))).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Presets completeness                                              */
/* ------------------------------------------------------------------ */

describe("presets", () => {
  it("all presets are registered in PRESETS map", () => {
    expect(Object.keys(PRESETS)).toEqual([
      "bangladesh_spinner",
      "fast_replenishment",
      "quality_critical",
    ]);
  });

  it("all presets pass schema validation", () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const result = purchaserInputSchema.safeParse(preset);
      expect(result.success, `Preset '${name}' failed validation`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Legacy adapter                                                    */
/* ------------------------------------------------------------------ */

describe("legacy adapter", () => {
  it("detects legacy input correctly", () => {
    expect(isLegacyInput({ tonnage: 2000, months: 6 })).toBe(true);
  });

  it("rejects V2 input as legacy", () => {
    expect(
      isLegacyInput({
        strategy_input_version: 2,
        demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      })
    ).toBe(false);
  });

  it("rejects input with demand key as legacy", () => {
    expect(
      isLegacyInput({
        tonnage: 2000,
        months: 6,
        demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      })
    ).toBe(false);
  });

  it("converts legacy to valid PurchaserInput", () => {
    const converted = legacyToPurchaserInput({ tonnage: 2000, months: 6 });
    const result = purchaserInputSchema.safeParse(converted);
    expect(result.success).toBe(true);
    expect(converted.demand.required_tonnes).toBe(2000);
    expect(converted.demand.planning_horizon_months).toBe(6);
  });
});
