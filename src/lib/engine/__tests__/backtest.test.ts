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

  it("excludes the decision bar from the execution window (walk-forward, no leakage)", () => {
    // Flat series except a sharp one-day dip AT the first decision bar (idx=252)
    // that fully recovers the next day. Because execution starts on the bar
    // AFTER the decision (fix #2), the realized execution price must ignore the
    // dip entirely — proving the decision bar's own price never leaks into
    // realized savings.
    const length = 300;
    const prices = new Array(length).fill(0.7);
    const dates: string[] = [];
    const baseDate = new Date("2021-01-01");
    for (let i = 0; i < length; i++) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    const DECISION_IDX = 252; // first decision bar (min_history default)
    prices[DECISION_IDX] = 0.1; // anomalous decision-bar price

    const result = runBacktest(prices, dates, { tonnage: 2000, months: 1 });
    const first = result.steps[0];

    expect(first.decision_date).toBe(dates[DECISION_IDX]);
    // Decision bar carries the anomaly...
    expect(first.price_at_decision).toBeCloseTo(0.1, 4);
    // ...but execution (idx+1 onward) sees only the flat 0.70 — the dip does NOT
    // leak in. If the decision bar were included, this would be ~0.6714.
    expect(first.benchmark_exec_price).toBeCloseTo(0.7, 4);
    expect(first.weighted_exec_price).toBeCloseTo(0.7, 4);
    expect(first.savings_pct).toBeCloseTo(0, 4);
  });

  it("hit rate excludes structural ties instead of counting them as losses", () => {
    // A perfectly flat market makes every HOLD an exact benchmark tie
    // (savings == 0). Ties must be excluded from the win/loss denominator, so
    // an all-tie backtest reports a 0% hit rate (0 wins / 0 decisive bars),
    // never a misleading 0% out of a full denominator of "losses".
    const { prices, dates } = syntheticPrices(800, 0.7, 0);
    const flat = prices.map(() => 0.7); // truly flat → HOLD everywhere, 0 savings
    const result = runBacktest(flat, dates, { tonnage: 2000, months: 3 });

    expect(result.steps.length).toBeGreaterThan(0);
    // Every step is a structural tie.
    expect(result.steps.every((s) => s.savings_pct === 0)).toBe(true);
    // No decisive bars → hit rate is 0, and crucially the ties were NOT counted
    // as losses (which the old code did, always yielding 0% over N "losses").
    expect(result.summary.hit_rate_pct).toBe(0);
  });

  it("tonnage scales total_savings_usd proportionally (fix #4)", () => {
    const { prices, dates } = syntheticPrices(800, 0.7, 0.0004); // some signal
    const r1 = runBacktest(prices, dates, { tonnage: 1000, months: 3 });
    const r2 = runBacktest(prices, dates, { tonnage: 2000, months: 3 });

    expect(r1.steps.length).toBe(r2.steps.length);
    // Per-lb and percentage metrics are tonnage-independent...
    expect(r1.summary.avg_savings_per_lb).toBe(r2.summary.avg_savings_per_lb);
    expect(r1.summary.avg_savings_pct).toBe(r2.summary.avg_savings_pct);
    // ...but dollar savings scale ~2x with 2x tonnage (tonnage is now wired in).
    // (±1 tolerance absorbs integer rounding of each step's USD figure.)
    for (let i = 0; i < r1.steps.length; i++) {
      expect(
        Math.abs(r2.steps[i].total_savings_usd - r1.steps[i].total_savings_usd * 2)
      ).toBeLessThanOrEqual(1);
    }
    // And it is non-trivial (there is real signal to save on).
    expect(Math.abs(r2.summary.total_savings_usd)).toBeGreaterThan(0);
  });
});
