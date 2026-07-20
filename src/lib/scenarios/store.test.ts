import { describe, it, expect } from "vitest";
import { importScenario } from "./store";
import { PRESET_BANGLADESH_SPINNER } from "../schemas/purchaser-input";
import type { Scenario } from "./types";

/**
 * These tests focus on importScenario's parse + structural validation.
 * The suite runs in the default node environment where `window` is undefined,
 * so saveScenario is a no-op — importScenario returns the normalized scenario
 * without persisting, and invalid input throws before any persistence attempt.
 */

const validScenario: Scenario = {
  id: "original-id",
  name: "Baseline",
  created_at: "2020-01-01T00:00:00.000Z",
  inputs: PRESET_BANGLADESH_SPINNER,
  market_snapshot: {
    benchmarks: { current_price: 0.72 } as Scenario["market_snapshot"]["benchmarks"],
    headlines_count: 3,
    price_date: "2026-07-18",
  },
  strategy: {
    signal: "BUY",
    confidence: 70,
    executive_summary: "summary",
    market_analysis: "analysis",
    monthly_plan: [],
    risk_factors: [],
    next_actions: [],
    source: "heuristic",
  },
  version: 1,
};

describe("importScenario", () => {
  it("throws a clean error on malformed JSON (never uncaught SyntaxError)", () => {
    expect(() => importScenario("{ not valid json ")).toThrow(/not valid JSON/i);
  });

  it("throws on a structurally-invalid object and does not persist it", () => {
    // Valid JSON, wrong shape (missing strategy / bad version / bad inputs).
    expect(() => importScenario(JSON.stringify({ foo: "bar" }))).toThrow(
      /does not match the scenario schema/i
    );
    expect(() =>
      importScenario(JSON.stringify({ ...validScenario, version: 2 }))
    ).toThrow();
    expect(() =>
      importScenario(JSON.stringify({ ...validScenario, strategy: null }))
    ).toThrow();
    expect(() =>
      importScenario(JSON.stringify({ ...validScenario, inputs: {} }))
    ).toThrow();
  });

  it("accepts a valid scenario and assigns a fresh id + created_at", () => {
    const result = importScenario(JSON.stringify(validScenario));
    expect(result.name).toBe("Baseline");
    expect(result.version).toBe(1);
    // id and created_at are reassigned to avoid collisions.
    expect(result.id).not.toBe("original-id");
    expect(result.created_at).not.toBe("2020-01-01T00:00:00.000Z");
    expect(result.strategy.signal).toBe("BUY");
  });
});
