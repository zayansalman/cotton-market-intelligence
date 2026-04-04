"use client";

import { useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

interface BacktestStep {
  decision_date: string;
  signal: string;
  savings_pct: number;
  price_at_decision: number;
  pct_rank_1y: number;
}

interface BacktestSummary {
  total_steps: number;
  hit_rate_pct: number;
  avg_savings_pct: number;
  worst_savings_pct: number;
  best_savings_pct: number;
  signal_counts: Record<string, number>;
  avg_savings_by_signal: Record<string, number>;
}

interface BacktestResult {
  steps: BacktestStep[];
  summary: BacktestSummary;
}

const SIGNAL_COLORS: Record<string, string> = {
  STRONG_BUY: "#22c55e",
  BUY: "#86efac",
  HOLD: "#94a3b8",
  AVOID: "#f87171",
};

export default function BacktestPanel() {
  const [tonnage, setTonnage] = useState(2000);
  const [months, setMonths] = useState(6);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/backtest?tonnage=${tonnage}&months=${months}&step_months=1`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Backtest failed (${res.status})`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }, [tonnage, months]);

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-5">
      <h3 className="text-lg font-semibold text-zinc-100 mb-3">
        Strategy Backtest
      </h3>
      <p className="text-xs text-zinc-400 mb-4">
        Replay heuristic strategy at monthly intervals against 5 years of Cotton
        #2 history. Walk-forward methodology — no future data leakage.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end mb-4">
        <label className="text-xs text-zinc-400">
          Tonnage
          <input
            type="number"
            min={100}
            step={500}
            value={tonnage}
            onChange={(e) => setTonnage(Number(e.target.value) || 2000)}
            className="block mt-1 w-28 rounded bg-zinc-700 border border-zinc-600 px-2 py-1 text-sm text-zinc-100"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Horizon (months)
          <input
            type="number"
            min={1}
            max={12}
            value={months}
            onChange={(e) => setMonths(Number(e.target.value) || 6)}
            className="block mt-1 w-20 rounded bg-zinc-700 border border-zinc-600 px-2 py-1 text-sm text-zinc-100"
          />
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-1.5 text-sm font-medium text-white"
        >
          {loading ? "Running..." : "Run Backtest"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-400 mb-3">{error}</p>
      )}

      {result && (
        <>
          {/* KPI Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <KPI
              label="Hit Rate"
              value={`${result.summary.hit_rate_pct}%`}
              color={result.summary.hit_rate_pct >= 50 ? "text-green-400" : "text-red-400"}
            />
            <KPI
              label="Avg Savings"
              value={`${result.summary.avg_savings_pct > 0 ? "+" : ""}${result.summary.avg_savings_pct}%`}
              color={result.summary.avg_savings_pct >= 0 ? "text-green-400" : "text-red-400"}
            />
            <KPI
              label="Best Step"
              value={`+${result.summary.best_savings_pct}%`}
              color="text-green-400"
            />
            <KPI
              label="Worst Step"
              value={`${result.summary.worst_savings_pct}%`}
              color="text-red-400"
            />
          </div>

          {/* Signal breakdown */}
          <div className="flex flex-wrap gap-3 mb-5">
            {Object.entries(result.summary.signal_counts).map(([sig, count]) => (
              <div key={sig} className="text-xs text-zinc-400">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full mr-1"
                  style={{ backgroundColor: SIGNAL_COLORS[sig] ?? "#666" }}
                />
                {sig}: {count}x (avg {result.summary.avg_savings_by_signal[sig] > 0 ? "+" : ""}
                {result.summary.avg_savings_by_signal[sig]}%)
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={result.steps}
                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              >
                <XAxis
                  dataKey="decision_date"
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  interval={Math.max(0, Math.floor(result.steps.length / 8))}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#27272a",
                    border: "1px solid #3f3f46",
                    fontSize: 12,
                  }}
                  formatter={(value: unknown) => [
                    `${Number(value) > 0 ? "+" : ""}${value}%`,
                    "Savings vs benchmark",
                  ]}
                  labelFormatter={(label: unknown) => `Decision: ${label}`}
                />
                <ReferenceLine y={0} stroke="#52525b" strokeDasharray="3 3" />
                <Bar dataKey="savings_pct" radius={[2, 2, 0, 0]}>
                  {result.steps.map((step, i) => (
                    <Cell
                      key={i}
                      fill={step.savings_pct >= 0 ? "#22c55e" : "#ef4444"}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="text-xs text-zinc-500 mt-3">
            {result.summary.total_steps} decision points.
            Savings = strategy weighted execution price vs equal-weight monthly benchmark.
            Positive = strategy outperformed.
          </p>
        </>
      )}
    </div>
  );
}

function KPI({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-zinc-700/50 p-3">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
