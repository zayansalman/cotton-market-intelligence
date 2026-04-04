/**
 * Pipeline runner — fetches all factors, applies quality checks,
 * aligns to common time index, and returns PipelineOutput (#24).
 */

import type { PipelineOutput, FactorSeries } from "./types";
import { buildFactorFetchers } from "./sources";
import { assessQuality, frequencyToDays } from "./quality";

/**
 * Run the full data pipeline. Fetches all configured factors
 * in parallel with graceful error handling.
 */
export async function runPipeline(): Promise<PipelineOutput> {
  const fetchers = buildFactorFetchers();

  // Fetch all factors in parallel
  const results = await Promise.allSettled(
    fetchers.map(async (f) => {
      const data = await f.fetch();
      const quality = assessQuality(data, frequencyToDays(f.meta.frequency));
      return { meta: f.meta, data, quality } as FactorSeries;
    })
  );

  const factors: FactorSeries[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      factors.push(r.value);
    }
  }

  // Extract cotton close as target variable
  const cottonFactor = factors.find((f) => f.meta.id === "cotton_close");
  const target = cottonFactor?.data ?? [];

  // Quality summary
  const withData = factors.filter((f) => f.data.length > 0);
  const staleFacs = factors.filter((f) => f.quality.stale_days > 7);
  const avgMissing =
    withData.length > 0
      ? Math.round(
          (withData.reduce((s, f) => s + f.quality.missing_pct, 0) /
            withData.length) *
            100
        ) / 100
      : 100;

  return {
    fetched_at: new Date().toISOString(),
    factors,
    target,
    quality_summary: {
      total_factors: factors.length,
      factors_with_data: withData.length,
      factors_stale: staleFacs.length,
      avg_missing_pct: avgMissing,
    },
  };
}

/**
 * Align all factors to a common daily time index using
 * forward-fill (last known value) with release-lag offset.
 *
 * Returns a record of date → { factor_id: value }.
 */
export function alignToDaily(
  factors: FactorSeries[],
  dates: string[]
): Record<string, Record<string, number>> {
  const aligned: Record<string, Record<string, number>> = {};

  for (const date of dates) {
    aligned[date] = {};
  }

  for (const factor of factors) {
    if (factor.data.length === 0) continue;

    const lagDays = factor.meta.release_lag_days;

    // Build a lookup map: date → value
    const valueMap = new Map<string, number>();
    for (const pt of factor.data) {
      valueMap.set(pt.date, pt.value);
    }

    // Forward-fill with lag offset
    let lastKnownValue: number | undefined;
    const sortedFactorDates = factor.data
      .map((d) => d.date)
      .sort();

    let factorIdx = 0;

    for (const date of dates) {
      // The "available date" is the current date minus release lag
      const availableMs =
        new Date(date).getTime() - lagDays * 24 * 60 * 60 * 1000;

      // Advance through factor dates that are available
      while (
        factorIdx < sortedFactorDates.length &&
        new Date(sortedFactorDates[factorIdx]).getTime() <= availableMs
      ) {
        lastKnownValue = valueMap.get(sortedFactorDates[factorIdx]);
        factorIdx++;
      }

      if (lastKnownValue !== undefined) {
        aligned[date][factor.meta.id] = lastKnownValue;
      }
    }

    // Reset for next factor
    lastKnownValue = undefined;
    factorIdx = 0;
  }

  return aligned;
}
