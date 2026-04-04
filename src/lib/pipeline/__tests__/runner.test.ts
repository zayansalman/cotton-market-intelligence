/**
 * Pipeline runner alignment tests (#24).
 */

import { describe, it, expect } from "vitest";
import { alignToDaily } from "../runner";
import type { FactorSeries } from "../types";

function makeSeries(
  id: string,
  data: { date: string; value: number }[],
  lagDays = 0
): FactorSeries {
  return {
    meta: {
      id,
      name: id,
      group: "macro",
      frequency: "daily",
      release_lag_days: lagDays,
      unit: "index",
      source: "test",
      direction: 1,
    },
    data,
    quality: {
      total_points: data.length,
      missing_pct: 0,
      stale_days: 0,
      first_date: data[0]?.date ?? "",
      last_date: data[data.length - 1]?.date ?? "",
      outlier_count: 0,
    },
  };
}

describe("alignToDaily", () => {
  const dates = ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05"];

  it("forward-fills missing dates", () => {
    const series = makeSeries("test", [
      { date: "2025-01-01", value: 100 },
      { date: "2025-01-03", value: 110 },
    ]);

    const aligned = alignToDaily([series], dates);
    expect(aligned["2025-01-01"]["test"]).toBe(100);
    expect(aligned["2025-01-02"]["test"]).toBe(100); // forward-filled
    expect(aligned["2025-01-03"]["test"]).toBe(110);
    expect(aligned["2025-01-04"]["test"]).toBe(110); // forward-filled
  });

  it("applies release lag offset", () => {
    const series = makeSeries(
      "lagged",
      [
        { date: "2025-01-01", value: 50 },
        { date: "2025-01-03", value: 60 },
      ],
      2 // 2 day lag
    );

    const aligned = alignToDaily([series], dates);
    // Jan 1 data with 2-day lag isn't available until Jan 3
    expect(aligned["2025-01-01"]["lagged"]).toBeUndefined();
    expect(aligned["2025-01-02"]["lagged"]).toBeUndefined();
    expect(aligned["2025-01-03"]["lagged"]).toBe(50); // Jan 1 data available on Jan 3
    expect(aligned["2025-01-05"]["lagged"]).toBe(60); // Jan 3 data available on Jan 5
  });

  it("handles empty factor data", () => {
    const series = makeSeries("empty", []);
    const aligned = alignToDaily([series], dates);
    expect(aligned["2025-01-01"]["empty"]).toBeUndefined();
  });

  it("aligns multiple factors independently", () => {
    const a = makeSeries("a", [{ date: "2025-01-01", value: 10 }]);
    const b = makeSeries("b", [{ date: "2025-01-02", value: 20 }]);

    const aligned = alignToDaily([a, b], dates);
    expect(aligned["2025-01-01"]["a"]).toBe(10);
    expect(aligned["2025-01-01"]["b"]).toBeUndefined();
    expect(aligned["2025-01-02"]["a"]).toBe(10);
    expect(aligned["2025-01-02"]["b"]).toBe(20);
  });
});
