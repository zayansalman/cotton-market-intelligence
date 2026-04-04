/**
 * Pipeline data quality tests (#24).
 */

import { describe, it, expect } from "vitest";
import { assessQuality, frequencyToDays } from "../quality";
import type { DataPoint } from "../types";

function makePoints(count: number, startDate: string, stepDays: number): DataPoint[] {
  const points: DataPoint[] = [];
  const start = new Date(startDate);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i * stepDays);
    points.push({
      date: d.toISOString().slice(0, 10),
      value: 100 + Math.sin(i * 0.1) * 10,
    });
  }
  return points;
}

describe("assessQuality", () => {
  it("handles empty data", () => {
    const q = assessQuality([], 1);
    expect(q.total_points).toBe(0);
    expect(q.missing_pct).toBe(100);
  });

  it("computes basic metrics for daily data", () => {
    const points = makePoints(252, "2025-01-01", 1);
    const q = assessQuality(points, 1);
    expect(q.total_points).toBe(252);
    expect(q.first_date).toBe("2025-01-01");
    expect(q.missing_pct).toBeLessThan(5);
    expect(q.outlier_count).toBe(0);
  });

  it("detects high missing rate", () => {
    // 50 points over 252 days of daily data
    const points = makePoints(50, "2025-01-01", 5);
    const q = assessQuality(points, 1);
    expect(q.missing_pct).toBeGreaterThan(50);
  });

  it("detects outliers", () => {
    const points = makePoints(100, "2025-01-01", 1);
    // Inject outlier
    points[50].value = 99999;
    const q = assessQuality(points, 1);
    expect(q.outlier_count).toBeGreaterThan(0);
  });

  it("computes staleness", () => {
    const points = makePoints(10, "2024-01-01", 1);
    const q = assessQuality(points, 1);
    expect(q.stale_days).toBeGreaterThan(300);
  });
});

describe("frequencyToDays", () => {
  it("maps known frequencies", () => {
    expect(frequencyToDays("daily")).toBe(1);
    expect(frequencyToDays("weekly")).toBe(7);
    expect(frequencyToDays("monthly")).toBe(30);
    expect(frequencyToDays("quarterly")).toBe(90);
  });

  it("defaults unknown to 1", () => {
    expect(frequencyToDays("unknown")).toBe(1);
  });
});
