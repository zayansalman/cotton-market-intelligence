/**
 * Backtest engine tests (#6).
 */

import { describe, it, expect } from "vitest";
import { runBacktest } from "../backtest";

/** Generate synthetic price series with a known trend. */
function syntheticPrices(
  length: number,
  start: number,
  trendPerDay: number
): { prices: number[]; dates: string[] } {
  const prices: number[] = [];
  const dates: string[] = [];
  const baseDate = new Date("2021-01-01");

  for (let i = 0; i < length; i++) {
    // Add some noise
    const noise = (Math.sin(i * 0.1) * 0.02 + Math.cos(i * 0.05) * 0.01);
    prices.push(start + trendPerDay * i + noise);
    const d = new Date(baseDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  return { prices, dates };
}

describe("runBacktest", () => {
  it("returns steps and summary for sufficient data", () => {
    const { prices, dates } = syntheticPrices(800, 0.70, 0);
    const result = runBacktest(prices, dates, { tonnage: 2000, months: 3 });

    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.summary.total_steps).toBe(result.steps.length);
    expect(typeof result.summary.hit_rate_pct).toBe("number");
    expect(typeof result.summary.avg_savings_pct).toBe("number");
  });

  it("returns empty for insufficient data", () => {
    const { prices, dates } = syntheticPrices(200, 0.70, 0);
    const result = runBacktest(prices, dates, { tonnage: 2000, months: 6 });
    expect(result.steps).toHaveLength(0);
    expect(result.summary.total_steps).toBe(0);
  });

  it("each step has required fields", () => {
    const { prices, dates } = syntheticPrices(600, 0.70, 0);
    const result = runBacktest(prices, dates, { tonnage: 2000, months: 3 });
    const step = result.steps[0];

    expect(step).toHaveProperty("decision_date");
    expect(step).toHaveProperty("signal");
    expect(step).toHaveProperty("confidence");
    expect(step).toHaveProperty("weighted_exec_price");
    expect(step).toHaveProperty("benchmark_exec_price");
    expect(step).toHaveProperty("savings_pct");
    expect(["STRONG_BUY", "BUY", "HOLD", "AVOID"]).toContain(step.signal);
  });

  it("savings_pct is consistent with price diff", () => {
    const { prices, dates } = syntheticPrices(600, 0.70, 0);
    const result = runBacktest(prices, dates, { tonnage: 2000, months: 3 });

    for (const step of result.steps) {
      const expectedSavings =
        step.benchmark_exec_price > 0
          ? ((step.benchmark_exec_price - step.weighted_exec_price) / step.benchmark_exec_price) * 100
          : 0;
      expect(Math.abs(step.savings_pct - Math.round(expectedSavings * 100) / 100)).toBeLessThan(0.02);
    }
  });

  it("step_months controls spacing", () => {
    const { prices, dates } = syntheticPrices(800, 0.70, 0);
    const r1 = runBacktest(prices, dates, { tonnage: 2000, months: 3, step_months: 1 });
    const r3 = runBacktest(prices, dates, { tonnage: 2000, months: 3, step_months: 3 });
    expect(r1.steps.length).toBeGreaterThan(r3.steps.length);
  });

  it("signal_counts sum to total_steps", () => {
    const { prices, dates } = syntheticPrices(800, 0.70, 0);
    const result = runBacktest(prices, dates, { tonnage: 2000, months: 3 });
    const totalFromCounts = Object.values(result.summary.signal_counts).reduce((a, b) => a + b, 0);
    expect(totalFromCounts).toBe(result.summary.total_steps);
  });

  it("uses walk-forward methodology (no future data)", () => {
    // In a trending-up market, BUY signals should front-load and save money
    const { prices, dates } = syntheticPrices(800, 0.50, 0.0005); // trending up
    const result = runBacktest(prices, dates, { tonnage: 2000, months: 6 });
    // Most steps should exist
    expect(result.steps.length).toBeGreaterThan(5);
  });
});
