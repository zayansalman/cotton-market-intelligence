"use client";

import type { Scenario } from "@/lib/scenarios/types";

interface ScenarioCompareProps {
  a: Scenario;
  b: Scenario;
  onClose: () => void;
}

function MetricRow({
  label,
  valueA,
  valueB,
}: {
  label: string;
  valueA: string;
  valueB: string;
}) {
  return (
    <tr className="border-b border-zinc-800/50">
      <td className="px-3 py-2 text-xs text-zinc-500 font-medium">{label}</td>
      <td className="px-3 py-2 text-xs text-zinc-200 text-right">{valueA}</td>
      <td className="px-3 py-2 text-xs text-zinc-200 text-right">{valueB}</td>
    </tr>
  );
}

export default function ScenarioCompare({
  a,
  b,
  onClose,
}: ScenarioCompareProps) {
  const feasA = "plan_feasibility_score" in a.strategy
    ? (a.strategy as Record<string, unknown>).plan_feasibility_score as number
    : null;
  const feasB = "plan_feasibility_score" in b.strategy
    ? (b.strategy as Record<string, unknown>).plan_feasibility_score as number
    : null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          Scenario Comparison
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase">
              <th className="text-left px-3 py-2">Metric</th>
              <th className="text-right px-3 py-2 max-w-[140px] truncate">{a.name}</th>
              <th className="text-right px-3 py-2 max-w-[140px] truncate">{b.name}</th>
            </tr>
          </thead>
          <tbody>
            <MetricRow
              label="Signal"
              valueA={a.strategy.signal}
              valueB={b.strategy.signal}
            />
            <MetricRow
              label="Confidence"
              valueA={`${a.strategy.confidence}%`}
              valueB={`${b.strategy.confidence}%`}
            />
            {feasA !== null && feasB !== null && (
              <MetricRow
                label="Feasibility"
                valueA={`${feasA}/100`}
                valueB={`${feasB}/100`}
              />
            )}
            <MetricRow
              label="Volume"
              valueA={`${a.inputs.demand.required_tonnes.toLocaleString()}t`}
              valueB={`${b.inputs.demand.required_tonnes.toLocaleString()}t`}
            />
            <MetricRow
              label="Horizon"
              valueA={`${a.inputs.demand.planning_horizon_months}mo`}
              valueB={`${b.inputs.demand.planning_horizon_months}mo`}
            />
            <MetricRow
              label="Risks"
              valueA={`${a.strategy.risk_factors.length}`}
              valueB={`${b.strategy.risk_factors.length}`}
            />
            <MetricRow
              label="Market date"
              valueA={a.market_snapshot.price_date}
              valueB={b.market_snapshot.price_date}
            />
          </tbody>
        </table>
      </div>

      {/* Monthly allocation comparison */}
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
          Monthly Allocations (%)
        </p>
        <div className="grid grid-cols-2 gap-4">
          {[a, b].map((s) => (
            <div key={s.id}>
              <p className="text-[10px] text-zinc-400 mb-1 truncate">{s.name}</p>
              <div className="space-y-0.5">
                {s.strategy.monthly_plan.map((p) => (
                  <div key={p.month} className="flex items-center gap-2 text-[10px]">
                    <span className="text-zinc-500 w-6">M{p.month}</span>
                    <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-blue-500/60 rounded-full"
                        style={{ width: `${Math.min(p.pct, 100)}%` }}
                      />
                    </div>
                    <span className="text-zinc-400 w-10 text-right">
                      {p.pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
