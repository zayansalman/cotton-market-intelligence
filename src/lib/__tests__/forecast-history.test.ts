import { describe, expect, it } from "vitest";
import {
  buildHistoricalPreviousForecasts,
  normalizeForecastPoints,
  selectNonOverlappingPreviousForecasts,
} from "../forecast-history";
import type { PricePoint } from "@/lib/types";

const points = (start: string, end: string) => [
  {
    date: start,
    predicted_price: 0.82,
    lower_price: 0.78,
    upper_price: 0.86,
    horizon: "21d",
  },
  {
    date: end,
    predicted_price: 0.84,
    lower_price: 0.79,
    upper_price: 0.89,
    horizon: "21d",
  },
];

function addBusinessDays(startDate: string, days: number): string {
  const d = new Date(startDate + "T00:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

function priceSeries(length: number): PricePoint[] {
  let date = "2025-01-01";
  return Array.from({ length }, (_, i) => {
    if (i > 0) date = addBusinessDays(date, 1);
    const close = Math.round((0.7 + i * 0.0002 + Math.sin(i / 8) * 0.01) * 10000) / 10000;
    return {
      date,
      close,
      ma50: null,
      ma200: null,
    };
  });
}

describe("forecast-history helpers", () => {
  it("normalizes only valid saved forecast points", () => {
    expect(
      normalizeForecastPoints([
        points("2026-04-01", "2026-04-30")[0],
        { date: "2026-04-02", predicted_price: "0.82" },
        null,
      ])
    ).toEqual([points("2026-04-01", "2026-04-30")[0]]);
  });

  it("excludes the current market forecast and selects non-overlapping prior windows", () => {
    const rows = [
      {
        created_at: "2026-05-06T12:00:00.000Z",
        prediction_date: "2026-05-06",
        target_date: "2026-06-04",
        forecast_points: points("2026-05-06", "2026-06-04"),
      },
      {
        created_at: "2026-05-01T12:00:00.000Z",
        prediction_date: "2026-05-01",
        target_date: "2026-05-29",
        forecast_points: points("2026-05-01", "2026-05-29"),
      },
      {
        created_at: "2026-04-01T12:00:00.000Z",
        prediction_date: "2026-04-01",
        target_date: "2026-04-30",
        forecast_points: points("2026-04-01", "2026-04-30"),
      },
      {
        created_at: "2026-03-01T12:00:00.000Z",
        prediction_date: "2026-03-01",
        target_date: "2026-03-30",
        forecast_points: points("2026-03-01", "2026-03-30"),
      },
    ];

    const selected = selectNonOverlappingPreviousForecasts(rows, {
      currentMarketDate: "2026-05-06",
      maxCount: 2,
    });

    expect(selected.map((row) => row.prediction_date)).toEqual([
      "2026-04-01",
      "2026-03-01",
    ]);
  });

  it("allows prior windows to touch at endpoints so lines appear in sequence", () => {
    const rows = [
      {
        created_at: "2026-04-07T12:00:00.000Z",
        prediction_date: "2026-04-07",
        target_date: "2026-05-06",
        forecast_points: points("2026-04-07", "2026-05-06"),
      },
      {
        created_at: "2026-03-09T12:00:00.000Z",
        prediction_date: "2026-03-09",
        target_date: "2026-04-07",
        forecast_points: points("2026-03-09", "2026-04-07"),
      },
    ];

    const selected = selectNonOverlappingPreviousForecasts(rows, {
      currentMarketDate: "2026-05-06",
      maxCount: 2,
    });

    expect(selected.map((row) => row.prediction_date)).toEqual([
      "2026-04-07",
      "2026-03-09",
    ]);
  });

  it("skips overlapping previous windows instead of drawing stacked lines", () => {
    const rows = [
      {
        created_at: "2026-04-20T12:00:00.000Z",
        prediction_date: "2026-04-20",
        target_date: "2026-05-19",
        forecast_points: points("2026-04-20", "2026-05-19"),
      },
      {
        created_at: "2026-04-10T12:00:00.000Z",
        prediction_date: "2026-04-10",
        target_date: "2026-05-09",
        forecast_points: points("2026-04-10", "2026-05-09"),
      },
      {
        created_at: "2026-03-01T12:00:00.000Z",
        prediction_date: "2026-03-01",
        target_date: "2026-03-30",
        forecast_points: points("2026-03-01", "2026-03-30"),
      },
      {
        created_at: "2026-02-01T12:00:00.000Z",
        prediction_date: "2026-02-01",
        target_date: "2026-03-02",
        forecast_points: points("2026-02-01", "2026-03-02"),
      },
      {
        created_at: "2026-01-01T12:00:00.000Z",
        prediction_date: "2026-01-01",
        target_date: "2026-01-30",
        forecast_points: points("2026-01-01", "2026-01-30"),
      },
    ];

    const selected = selectNonOverlappingPreviousForecasts(rows, {
      currentMarketDate: "2026-05-06",
      maxCount: 2,
    });

    expect(selected.map((row) => row.prediction_date)).toEqual([
      "2026-03-01",
      "2026-01-01",
    ]);
  });

  it("builds two sequential historical forecasts ending at the current market date", () => {
    const prices = priceSeries(340);
    const currentMarketDate = prices.at(-1)!.date;
    const forecasts = buildHistoricalPreviousForecasts(prices, currentMarketDate, {
      horizon: "21d",
      count: 2,
    });

    expect(forecasts).toHaveLength(2);
    expect(forecasts[0].target_date).toBe(currentMarketDate);
    expect(forecasts[1].target_date).toBe(forecasts[0].prediction_date);
    expect(forecasts[0].forecast_points).toHaveLength(22);
    expect(forecasts[0].model_id).toBe("historical_heuristic");
    expect(forecasts[0].actual_price).toBeGreaterThan(0);
  });
});
