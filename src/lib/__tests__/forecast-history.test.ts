import { describe, expect, it } from "vitest";
import {
  normalizeForecastPoints,
  selectNonOverlappingPreviousForecasts,
} from "../forecast-history";

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
});
