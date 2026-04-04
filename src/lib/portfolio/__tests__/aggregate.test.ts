/**
 * Portfolio aggregation tests (#7).
 */

import { describe, it, expect } from "vitest";
import { computePortfolioSummary, exportPortfolioCsv } from "../aggregate";
import type { Mill } from "../types";
import type { Strategy } from "@/lib/types";

function makeMill(
  id: string,
  name: string,
  tonnes: number,
  months: number,
  signal?: string
): Mill {
  const strategy: Strategy | undefined = signal
    ? {
        signal: signal as Strategy["signal"],
        confidence: 70,
        executive_summary: "Test",
        market_analysis: "Test",
        monthly_plan: Array.from({ length: months }, (_, i) => ({
          month: i + 1,
          pct: Math.round(100 / months),
          tonnes: Math.round(tonnes / months),
          rationale: "Test",
        })),
        risk_factors: [],
        next_actions: [],
        source: "heuristic" as const,
        provider: "heuristic" as const,
      }
    : undefined;

  return {
    id,
    name,
    input: {
      demand: { required_tonnes: tonnes, planning_horizon_months: months },
    } as Mill["input"],
    strategy: strategy ?? null,
  };
}

describe("computePortfolioSummary", () => {
  it("aggregates across multiple mills", () => {
    const mills = [
      makeMill("a", "Mill A", 3000, 6, "BUY"),
      makeMill("b", "Mill B", 2000, 6, "HOLD"),
    ];

    const summary = computePortfolioSummary(mills);
    expect(summary.total_mills).toBe(2);
    expect(summary.total_tonnes).toBe(5000);
    expect(summary.aggregate_plan).toHaveLength(6);
    expect(summary.signal_counts).toEqual({ BUY: 1, HOLD: 1 });

    // Each month should have total from both mills
    for (const row of summary.aggregate_plan) {
      expect(row.by_mill).toHaveLength(2);
      expect(row.total_tonnes).toBe(
        row.by_mill.reduce((s, m) => s + m.tonnes, 0)
      );
    }
  });

  it("handles mills without strategy", () => {
    const mills = [
      makeMill("a", "Mill A", 3000, 6, "BUY"),
      makeMill("b", "Mill B", 2000, 6), // no strategy
    ];

    const summary = computePortfolioSummary(mills);
    expect(summary.total_mills).toBe(2);
    expect(summary.total_tonnes).toBe(5000);
    expect(summary.signal_counts).toEqual({ BUY: 1 });
  });

  it("handles empty portfolio", () => {
    const summary = computePortfolioSummary([]);
    expect(summary.total_mills).toBe(0);
    expect(summary.total_tonnes).toBe(0);
  });

  it("handles mills with different horizons", () => {
    const mills = [
      makeMill("a", "Mill A", 3000, 3, "BUY"),
      makeMill("b", "Mill B", 2000, 6, "HOLD"),
    ];

    const summary = computePortfolioSummary(mills);
    expect(summary.aggregate_plan).toHaveLength(6);
    // Mill A only has 3 months, so months 4-6 should have 0 from Mill A
    const month4 = summary.aggregate_plan[3];
    const millAEntry = month4.by_mill.find((b) => b.mill_id === "a");
    expect(millAEntry?.tonnes).toBe(0);
  });
});

describe("exportPortfolioCsv", () => {
  it("generates valid CSV", () => {
    const mills = [
      makeMill("a", "Mill A", 3000, 3, "BUY"),
      makeMill("b", "Mill B", 2000, 3, "HOLD"),
    ];

    const csv = exportPortfolioCsv(mills);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Mill A");
    expect(lines[0]).toContain("Mill B");
    expect(lines[0]).toContain("Total");
    expect(lines).toHaveLength(4); // header + 3 months
  });
});
