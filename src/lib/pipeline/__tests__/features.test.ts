/**
 * Feature engineering tests (#27).
 */

import { describe, it, expect } from "vitest";
import { buildFeatures, FEATURE_SPECS } from "../features";

/** Build synthetic aligned data with known values. */
function syntheticAligned(
  days: number,
  startPrice: number = 0.70
): { dates: string[]; aligned: Record<string, Record<string, number>> } {
  const dates: string[] = [];
  const aligned: Record<string, Record<string, number>> = {};
  const base = new Date("2022-01-03"); // a Monday

  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    // Skip weekends
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;

    const dateStr = d.toISOString().slice(0, 10);
    dates.push(dateStr);

    const noise = Math.sin(i * 0.05) * 0.03;
    aligned[dateStr] = {
      cotton_close: startPrice + noise + i * 0.0001,
      dxy: 103 + Math.sin(i * 0.02) * 2,
      crude_oil: 75 + Math.cos(i * 0.03) * 5,
      vix: 18 + Math.sin(i * 0.1) * 5,
      sp500: 4500 + i * 0.5,
    };
  }

  return { dates, aligned };
}

describe("buildFeatures", () => {
  const { dates, aligned } = syntheticAligned(400);

  it("returns rows with all feature specs", () => {
    const rows = buildFeatures(dates, aligned);
    expect(rows.length).toBeGreaterThan(0);

    const lastRow = rows[rows.length - 1];
    for (const spec of FEATURE_SPECS) {
      expect(lastRow.features).toHaveProperty(spec.name);
    }
  });

  it("has correct target values", () => {
    const rows = buildFeatures(dates, aligned);
    for (const row of rows) {
      expect(row.target).toBe(aligned[row.date]?.cotton_close);
    }
  });

  it("produces valid forward returns (not at end)", () => {
    const rows = buildFeatures(dates, aligned);
    // Early rows should have forward returns
    const earlyRow = rows[100];
    expect(earlyRow.fwd_return_5d).not.toBeNull();
    expect(earlyRow.fwd_return_21d).not.toBeNull();

    // Last rows should have null forward returns
    const lastRow = rows[rows.length - 1];
    expect(lastRow.fwd_return_5d).toBeNull();
  });

  it("lag features are correctly offset", () => {
    const rows = buildFeatures(dates, aligned);
    const row100 = rows[100];
    const row95 = rows[95];

    // cotton_lag_5d at row 100 should equal cotton close at row 95
    if (row100.features.cotton_lag_5d != null) {
      expect(row100.features.cotton_lag_5d).toBe(row95.target);
    }
  });

  it("calendar features are correct", () => {
    const rows = buildFeatures(dates, aligned);
    for (const row of rows.slice(0, 20)) {
      const d = new Date(row.date);
      const month = d.getUTCMonth() + 1;
      expect(row.features.month).toBe(month);
      expect(row.features.quarter).toBe(Math.ceil(month / 3));
    }
  });

  it("volatility regime is categorical", () => {
    const rows = buildFeatures(dates, aligned);
    for (const row of rows) {
      const vr = row.features.vol_regime;
      if (vr != null) {
        expect([0, 1, 2]).toContain(vr);
      }
    }
  });

  it("trend regime is categorical", () => {
    const rows = buildFeatures(dates, aligned);
    for (const row of rows) {
      const tr = row.features.trend_regime;
      if (tr != null) {
        expect([-1, 0, 1]).toContain(tr);
      }
    }
  });

  it("RSI is between 0 and 100", () => {
    const rows = buildFeatures(dates, aligned);
    for (const row of rows) {
      const r = row.features.rsi_14;
      if (r != null) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(100);
      }
    }
  });

  it("percentile ranks are between 0 and 1", () => {
    const rows = buildFeatures(dates, aligned);
    for (const row of rows) {
      const pr = row.features.pct_rank_252d;
      if (pr != null) {
        expect(pr).toBeGreaterThanOrEqual(0);
        expect(pr).toBeLessThanOrEqual(1);
      }
    }
  });

  it("no look-ahead bias: forward returns are null at tail", () => {
    const rows = buildFeatures(dates, aligned);
    const tail = rows.slice(-5);
    for (const row of tail) {
      expect(row.fwd_return_63d).toBeNull();
    }
  });
});

describe("FEATURE_SPECS", () => {
  it("all have unique names", () => {
    const names = FEATURE_SPECS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all have valid groups", () => {
    const validGroups = ["lag", "momentum", "volatility", "cross_market", "calendar", "technical", "regime"];
    for (const spec of FEATURE_SPECS) {
      expect(validGroups).toContain(spec.group);
    }
  });
});
