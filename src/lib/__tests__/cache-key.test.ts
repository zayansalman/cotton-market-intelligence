import { describe, expect, it } from "vitest";
import { cacheKey, stableJson } from "../cache-key";

describe("cache-key", () => {
  it("creates the same hash for objects with different key order", () => {
    const a = {
      purchaser_input: { demand: { required_tonnes: 1200, planning_horizon_months: 3 } },
      provider: "huggingface",
      headlines: [{ title: "A", summary: "B" }],
    };
    const b = {
      headlines: [{ summary: "B", title: "A" }],
      provider: "huggingface",
      purchaser_input: { demand: { planning_horizon_months: 3, required_tonnes: 1200 } },
    };

    expect(stableJson(a)).toBe(stableJson(b));
    expect(cacheKey(a)).toBe(cacheKey(b));
  });

  it("changes the hash when an exact strategy parameter changes", () => {
    const base = {
      purchaser_input: { demand: { required_tonnes: 1200, planning_horizon_months: 3 } },
    };
    const changed = {
      purchaser_input: { demand: { required_tonnes: 1800, planning_horizon_months: 3 } },
    };

    expect(cacheKey(base)).not.toBe(cacheKey(changed));
  });
});
