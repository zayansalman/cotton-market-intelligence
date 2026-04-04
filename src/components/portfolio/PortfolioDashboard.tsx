"use client";

import { useState, useCallback, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { Mill } from "@/lib/portfolio/types";
import type { PurchaserInput } from "@/lib/schemas/purchaser-input";
import type { Benchmarks, Headline, LandedCostResponse, Strategy } from "@/lib/types";
import { loadMills, saveMills, generateId } from "@/lib/portfolio/store";
import {
  computePortfolioSummary,
  exportPortfolioJson,
  exportPortfolioCsv,
} from "@/lib/portfolio/aggregate";

const MILL_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#6366f1",
];

interface Props {
  benchmarks: Benchmarks | undefined;
  headlines: Headline[];
  landedCost: LandedCostResponse | null;
}

export default function PortfolioDashboard({
  benchmarks,
  headlines,
  landedCost,
}: Props) {
  const [mills, setMills] = useState<Mill[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    setMills(loadMills());
  }, []);

  // Persist on change
  useEffect(() => {
    if (mills.length > 0) saveMills(mills);
  }, [mills]);

  const addMill = useCallback(() => {
    const newMill: Mill = {
      id: generateId(),
      name: `Mill ${mills.length + 1}`,
      input: {
        demand: { required_tonnes: 2000, planning_horizon_months: 6 },
      } as PurchaserInput,
    };
    setMills((prev) => [...prev, newMill]);
  }, [mills.length]);

  const updateMill = useCallback(
    (id: string, updates: Partial<Pick<Mill, "name" | "input">>) => {
      setMills((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, ...updates, strategy: undefined } : m
        )
      );
    },
    []
  );

  const removeMill = useCallback((id: string) => {
    setMills((prev) => {
      const next = prev.filter((m) => m.id !== id);
      saveMills(next);
      return next;
    });
  }, []);

  const generateForMill = useCallback(
    async (mill: Mill) => {
      if (!benchmarks) return;
      setGenerating(mill.id);
      try {
        const res = await fetch("/api/strategy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tonnage: mill.input.demand.required_tonnes,
            months: mill.input.demand.planning_horizon_months,
            benchmarks,
            headlines,
            landedCost,
          }),
        });
        if (!res.ok) throw new Error("Strategy generation failed");
        const strategy: Strategy = await res.json();
        setMills((prev) =>
          prev.map((m) =>
            m.id === mill.id
              ? { ...m, strategy, generatedAt: new Date().toISOString() }
              : m
          )
        );
      } catch (e) {
        console.error("Portfolio strategy error:", e);
      } finally {
        setGenerating(null);
      }
    },
    [benchmarks, headlines, landedCost]
  );

  const generateAll = useCallback(async () => {
    for (const mill of mills) {
      await generateForMill(mill);
    }
  }, [mills, generateForMill]);

  const handleExportJson = () => {
    const json = exportPortfolioJson(mills);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csv = exportPortfolioCsv(mills);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = computePortfolioSummary(mills);
  const millsWithStrategy = mills.filter((m) => m.strategy);

  // Chart data for stacked bar
  const chartData = summary.aggregate_plan.map((row) => {
    const point: Record<string, unknown> = { month: `M${row.month}` };
    for (const entry of row.by_mill) {
      point[entry.mill_name] = entry.tonnes;
    }
    return point;
  });

  const SIGNAL_BADGE: Record<string, string> = {
    STRONG_BUY: "bg-green-600/20 text-green-300",
    BUY: "bg-green-500/20 text-green-300",
    HOLD: "bg-zinc-600/20 text-zinc-300",
    AVOID: "bg-red-500/20 text-red-300",
  };

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">
            Multi-Mill Portfolio
          </h3>
          <p className="text-xs text-zinc-400">
            Manage procurement across multiple mills simultaneously
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {!expanded ? (
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-400">
            {mills.length} mill{mills.length !== 1 ? "s" : ""} configured
            {millsWithStrategy.length > 0 &&
              ` (${millsWithStrategy.length} with strategies)`}
          </span>
          <button
            onClick={() => setExpanded(true)}
            className="text-xs bg-blue-600/20 text-blue-300 px-3 py-1 rounded"
          >
            Open Dashboard
          </button>
        </div>
      ) : (
        <>
          {/* Mill list */}
          <div className="space-y-3 mb-5">
            {mills.map((mill, idx) => (
              <div
                key={mill.id}
                className="bg-zinc-700/30 border border-zinc-700 rounded-lg p-3"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: MILL_COLORS[idx % MILL_COLORS.length],
                    }}
                  />
                  <input
                    value={mill.name}
                    onChange={(e) =>
                      updateMill(mill.id, { name: e.target.value })
                    }
                    className="bg-transparent border-b border-zinc-600 text-sm text-zinc-100 w-32 focus:outline-none focus:border-blue-500"
                  />
                  <label className="text-xs text-zinc-400">
                    Tonnes:
                    <input
                      type="number"
                      min={100}
                      step={500}
                      value={mill.input.demand.required_tonnes}
                      onChange={(e) =>
                        updateMill(mill.id, {
                          input: {
                            ...mill.input,
                            demand: {
                              ...mill.input.demand,
                              required_tonnes: Number(e.target.value) || 2000,
                            },
                          },
                        })
                      }
                      className="ml-1 w-20 bg-zinc-700 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-100"
                    />
                  </label>
                  <label className="text-xs text-zinc-400">
                    Months:
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={mill.input.demand.planning_horizon_months}
                      onChange={(e) =>
                        updateMill(mill.id, {
                          input: {
                            ...mill.input,
                            demand: {
                              ...mill.input.demand,
                              planning_horizon_months:
                                Number(e.target.value) || 6,
                            },
                          },
                        })
                      }
                      className="ml-1 w-14 bg-zinc-700 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-100"
                    />
                  </label>
                  {mill.strategy && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${SIGNAL_BADGE[mill.strategy.signal] ?? ""}`}
                    >
                      {mill.strategy.signal} ({mill.strategy.confidence}%)
                    </span>
                  )}
                  <div className="ml-auto flex gap-2">
                    <button
                      onClick={() => generateForMill(mill)}
                      disabled={generating === mill.id || !benchmarks}
                      className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-2 py-1 rounded"
                    >
                      {generating === mill.id ? "..." : "Generate"}
                    </button>
                    <button
                      onClick={() => removeMill(mill.id)}
                      className="text-xs text-red-400 hover:text-red-300 px-1"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 mb-5">
            <button
              onClick={addMill}
              className="text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded"
            >
              + Add Mill
            </button>
            {mills.length > 0 && (
              <button
                onClick={generateAll}
                disabled={!!generating || !benchmarks}
                className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded"
              >
                Generate All
              </button>
            )}
            {millsWithStrategy.length > 0 && (
              <>
                <button
                  onClick={handleExportJson}
                  className="text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded"
                >
                  Export JSON
                </button>
                <button
                  onClick={handleExportCsv}
                  className="text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded"
                >
                  Export CSV
                </button>
              </>
            )}
          </div>

          {/* Summary KPIs */}
          {millsWithStrategy.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <KPI label="Total Mills" value={String(summary.total_mills)} />
                <KPI
                  label="Total Demand"
                  value={`${summary.total_tonnes.toLocaleString()}t`}
                />
                <KPI
                  label="Monthly Rate"
                  value={`${summary.total_monthly_tonnes.toLocaleString()}t/mo`}
                />
                <KPI
                  label="Signals"
                  value={Object.entries(summary.signal_counts)
                    .map(([s, c]) => `${s}: ${c}`)
                    .join(", ")}
                />
              </div>

              {/* Stacked bar chart */}
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: "#a1a1aa" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#a1a1aa" }}
                      tickFormatter={(v: number) =>
                        `${(v / 1000).toFixed(1)}k`
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#27272a",
                        border: "1px solid #3f3f46",
                        fontSize: 12,
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    {millsWithStrategy.map((mill, idx) => (
                      <Bar
                        key={mill.id}
                        dataKey={mill.name}
                        stackId="portfolio"
                        fill={MILL_COLORS[idx % MILL_COLORS.length]}
                        radius={
                          idx === millsWithStrategy.length - 1
                            ? [2, 2, 0, 0]
                            : [0, 0, 0, 0]
                        }
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Per-mill summary table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-400 border-b border-zinc-700">
                      <th className="text-left py-2 pr-3">Mill</th>
                      <th className="text-right py-2 px-3">Tonnes</th>
                      <th className="text-right py-2 px-3">Months</th>
                      <th className="text-center py-2 px-3">Signal</th>
                      <th className="text-right py-2 px-3">Confidence</th>
                      <th className="text-left py-2 pl-3">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mills.map((mill) => (
                      <tr
                        key={mill.id}
                        className="border-b border-zinc-800 text-zinc-300"
                      >
                        <td className="py-2 pr-3 font-medium">{mill.name}</td>
                        <td className="text-right py-2 px-3">
                          {mill.input.demand.required_tonnes.toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3">
                          {mill.input.demand.planning_horizon_months}
                        </td>
                        <td className="text-center py-2 px-3">
                          {mill.strategy ? (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] ${SIGNAL_BADGE[mill.strategy.signal] ?? ""}`}
                            >
                              {mill.strategy.signal}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="text-right py-2 px-3">
                          {mill.strategy?.confidence ?? "—"}%
                        </td>
                        <td className="py-2 pl-3 text-zinc-400 max-w-[200px] truncate">
                          {mill.strategy?.executive_summary?.slice(0, 80) ??
                            "Not generated"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-700/50 p-3">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="text-sm font-semibold text-zinc-100">{value}</div>
    </div>
  );
}
