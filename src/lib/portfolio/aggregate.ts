/**
 * Portfolio aggregation logic (#7).
 */

import type { Mill, PortfolioSummary, AggregatePlanMonth } from "./types";

export function computePortfolioSummary(mills: Mill[]): PortfolioSummary {
  const withStrategy = mills.filter((m) => m.strategy);

  const totalTonnes = mills.reduce(
    (sum, m) => sum + m.input.demand.required_tonnes,
    0
  );

  const maxMonths = Math.max(
    ...mills.map((m) => m.input.demand.planning_horizon_months),
    1
  );

  // Aggregate monthly plan
  const aggregate: AggregatePlanMonth[] = [];
  for (let month = 1; month <= maxMonths; month++) {
    const byMill: AggregatePlanMonth["by_mill"] = [];
    let totalMonthTonnes = 0;

    for (const mill of withStrategy) {
      const planEntry = mill.strategy?.monthly_plan?.find(
        (p) => p.month === month
      );
      const tonnes = planEntry?.tonnes ?? 0;
      totalMonthTonnes += tonnes;
      byMill.push({
        mill_id: mill.id,
        mill_name: mill.name,
        tonnes,
      });
    }

    aggregate.push({
      month,
      total_tonnes: totalMonthTonnes,
      by_mill: byMill,
    });
  }

  // Signal counts
  const signalCounts: Record<string, number> = {};
  for (const mill of withStrategy) {
    const sig = mill.strategy!.signal;
    signalCounts[sig] = (signalCounts[sig] ?? 0) + 1;
  }

  return {
    total_mills: mills.length,
    total_tonnes: totalTonnes,
    total_monthly_tonnes: Math.round(
      totalTonnes /
        Math.max(
          ...mills.map((m) => m.input.demand.planning_horizon_months),
          1
        )
    ),
    aggregate_plan: aggregate,
    signal_counts: signalCounts,
  };
}

/**
 * Export portfolio as JSON for backup/share.
 */
export function exportPortfolioJson(mills: Mill[]): string {
  const summary = computePortfolioSummary(mills);
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      summary,
      mills: mills.map((m) => ({
        name: m.name,
        tonnes: m.input.demand.required_tonnes,
        months: m.input.demand.planning_horizon_months,
        signal: m.strategy?.signal ?? null,
        confidence: m.strategy?.confidence ?? null,
        monthly_plan: m.strategy?.monthly_plan ?? [],
      })),
    },
    null,
    2
  );
}

/**
 * Export portfolio as CSV.
 */
export function exportPortfolioCsv(mills: Mill[]): string {
  const summary = computePortfolioSummary(mills);
  const lines: string[] = [
    "Month," + mills.map((m) => m.name).join(",") + ",Total",
  ];

  for (const row of summary.aggregate_plan) {
    const millValues = mills.map((m) => {
      const entry = row.by_mill.find((b) => b.mill_id === m.id);
      return entry?.tonnes ?? 0;
    });
    lines.push(
      `${row.month},${millValues.join(",")},${row.total_tonnes}`
    );
  }

  return lines.join("\n");
}
