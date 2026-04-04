/**
 * Data quality checks for pipeline factors (#24).
 */

import type { DataPoint, DataQuality } from "./types";

/**
 * Compute data quality metrics for a factor series.
 */
export function assessQuality(
  data: DataPoint[],
  expectedFrequencyDays: number
): DataQuality {
  if (data.length === 0) {
    return {
      total_points: 0,
      missing_pct: 100,
      stale_days: Infinity,
      first_date: "",
      last_date: "",
      outlier_count: 0,
    };
  }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;

  // Staleness: days since last data point
  const lastMs = new Date(lastDate).getTime();
  const nowMs = Date.now();
  const staleDays = Math.round((nowMs - lastMs) / (24 * 60 * 60 * 1000));

  // Missing data estimate
  const totalDays =
    (new Date(lastDate).getTime() - new Date(firstDate).getTime()) /
    (24 * 60 * 60 * 1000);
  const expectedPoints = Math.max(1, Math.floor(totalDays / expectedFrequencyDays));
  const missingPct = Math.max(
    0,
    Math.round((1 - data.length / expectedPoints) * 10000) / 100
  );

  // Outlier detection: >3 std deviations from mean
  const values = data.map((d) => d.value);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  );
  const outlierCount =
    std > 0
      ? values.filter((v) => Math.abs(v - mean) > 3 * std).length
      : 0;

  return {
    total_points: data.length,
    missing_pct: Math.min(100, missingPct),
    stale_days: staleDays,
    first_date: firstDate,
    last_date: lastDate,
    outlier_count: outlierCount,
  };
}

const FREQ_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  quarterly: 90,
};

export function frequencyToDays(freq: string): number {
  return FREQ_DAYS[freq] ?? 1;
}
