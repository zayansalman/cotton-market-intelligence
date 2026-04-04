"use client";

import type { Strategy, Headline, Benchmarks, PurchaserInput } from "@/lib/types";
import SignalBadge from "./SignalBadge";
import RoadmapChart from "./RoadmapChart";
import MetricCard from "./MetricCard";
import KDenseHandoff from "./KDenseHandoff";

interface StrategyResultsProps {
  strategy: Strategy;
  headlines: Headline[];
  tonnage: number;
  months: number;
  benchmarks?: Benchmarks;
  purchaserInput?: PurchaserInput;
}

export default function StrategyResults({
  strategy,
  headlines,
  tonnage,
  months,
  benchmarks,
  purchaserInput,
}: StrategyResultsProps) {
  return (
    <>
      <SignalBadge strategy={strategy} />

      {/* Market analysis */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-3">
          Market Analysis
        </h3>
        <div className="prose prose-invert prose-sm max-w-none text-zinc-300 leading-relaxed whitespace-pre-line">
          {strategy.market_analysis}
        </div>
      </div>

      {/* V2 constraint fields */}
      {"plan_feasibility_score" in strategy && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="Feasibility"
            value={`${(strategy as Record<string, unknown>).plan_feasibility_score}/100`}
            delta={
              ((strategy as Record<string, unknown>).plan_feasibility_score as number) >= 70
                ? "Achievable"
                : ((strategy as Record<string, unknown>).plan_feasibility_score as number) >= 40
                  ? "Challenging"
                  : "Difficult"
            }
            deltaColor={
              ((strategy as Record<string, unknown>).plan_feasibility_score as number) >= 70
                ? "green"
                : ((strategy as Record<string, unknown>).plan_feasibility_score as number) >= 40
                  ? "neutral"
                  : "red"
            }
          />
        </div>
      )}

      {"binding_constraints" in strategy &&
        Array.isArray((strategy as Record<string, unknown>).binding_constraints) &&
        ((strategy as Record<string, unknown>).binding_constraints as string[]).length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-amber-400/80 uppercase tracking-wider mb-3">
              Binding Constraints
            </h3>
            <div className="flex flex-wrap gap-2">
              {((strategy as Record<string, unknown>).binding_constraints as string[]).map((c, i) => (
                <span
                  key={i}
                  className="text-xs bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-md px-2 py-1"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

      {"assumption_set" in strategy &&
        Object.keys((strategy as Record<string, unknown>).assumption_set as Record<string, string>).length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Assumptions
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries((strategy as Record<string, unknown>).assumption_set as Record<string, string>).map(
                ([key, value]) => (
                  <div key={key} className="text-xs">
                    <span className="text-zinc-500">{key.replace(/_/g, " ")}: </span>
                    <span className="text-zinc-300">{value}</span>
                  </div>
                )
              )}
            </div>
          </div>
        )}

      {/* Key levels */}
      {strategy.key_levels && (
        <div className="grid grid-cols-3 gap-3">
          <MetricCard
            label="Support"
            value={`$${strategy.key_levels.support.toFixed(4)}/lb`}
          />
          <MetricCard
            label="Fair Value"
            value={`$${strategy.key_levels.fair_value.toFixed(4)}/lb`}
          />
          <MetricCard
            label="Resistance"
            value={`$${strategy.key_levels.resistance.toFixed(4)}/lb`}
          />
        </div>
      )}

      {/* Roadmap */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-3">
          Procurement Roadmap — {tonnage.toLocaleString()}t over {months} months
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RoadmapChart plan={strategy.monthly_plan} />
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase">
                  <th className="text-left px-4 py-3">Month</th>
                  <th className="text-right px-4 py-3">Tonnes</th>
                  <th className="text-right px-4 py-3">%</th>
                  <th className="text-left px-4 py-3">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {strategy.monthly_plan.map((p) => (
                  <tr
                    key={p.month}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                  >
                    <td className="px-4 py-2.5 font-medium">M{p.month}</td>
                    <td className="text-right px-4 py-2.5 text-zinc-300">
                      {p.tonnes.toLocaleString()}
                    </td>
                    <td className="text-right px-4 py-2.5 text-zinc-400">
                      {p.pct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 text-xs">
                      {p.rationale}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Decision drivers */}
      {(strategy as unknown as Record<string, unknown>).decision_drivers && (
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">Decision Drivers</h4>
          <div className="space-y-2">
            {((strategy as unknown as Record<string, unknown>).decision_drivers as Array<{
              source: string; weight: number; direction: string; magnitude: number; reasoning: string;
            }>).map((driver, i) => (
              <div key={i} className="bg-zinc-700/30 border border-zinc-700 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-200">{driver.source}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{(driver.weight * 100).toFixed(0)}% weight</span>
                    <span className={`text-xs font-semibold ${
                      driver.direction === "up" ? "text-green-400" : driver.direction === "down" ? "text-red-400" : "text-zinc-400"
                    }`}>
                      {driver.direction === "up" ? "\u2191" : driver.direction === "down" ? "\u2193" : "\u2192"} {driver.direction.toUpperCase()}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-zinc-400 mt-1">{driver.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks & Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {strategy.risk_factors.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-red-400/80 uppercase tracking-wider mb-3">
              Risk Factors
            </h3>
            <ul className="space-y-2">
              {strategy.risk_factors.map((r, i) => (
                <li key={i} className="text-sm text-zinc-400 flex gap-2">
                  <span className="text-red-500 mt-0.5">•</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}
        {strategy.next_actions.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-blue-400/80 uppercase tracking-wider mb-3">
              Next Actions
            </h3>
            <ul className="space-y-2">
              {strategy.next_actions.map((a, i) => (
                <li key={i} className="text-sm text-zinc-400 flex gap-2">
                  <span className="text-blue-500 mt-0.5">→</span>
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Headlines */}
      {headlines.length > 0 && (
        <details className="bg-zinc-900 border border-zinc-800 rounded-xl">
          <summary className="p-5 cursor-pointer text-sm font-semibold text-zinc-300 uppercase tracking-wider hover:text-white">
            News Headlines ({headlines.length})
          </summary>
          <div className="px-5 pb-5 space-y-2">
            {headlines.slice(0, 20).map((h, i) => (
              <a
                key={i}
                href={h.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-zinc-400 hover:text-blue-400 transition-colors"
              >
                • {h.title}
              </a>
            ))}
          </div>
        </details>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => {
            const blob = new Blob(
              [JSON.stringify(strategy, null, 2)],
              { type: "application/json" }
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `procurement_strategy_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-4 py-2 transition-colors"
        >
          Download Strategy (JSON)
        </button>
        {benchmarks && purchaserInput && (
          <KDenseHandoff
            purchaserInput={purchaserInput}
            benchmarks={benchmarks}
          />
        )}
      </div>
    </>
  );
}
