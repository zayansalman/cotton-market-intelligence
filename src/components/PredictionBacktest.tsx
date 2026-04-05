"use client";

import { useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";

interface WalkForwardStep {
  date: string;
  actual: number;
  predicted: number;
  error: number;
  direction_correct: boolean;
}

interface WalkForwardMetrics {
  n_steps: number;
  mae: number;
  rmse: number;
  direction_accuracy: number;
  mape: number;
}

interface RegimeSlice {
  regime_name: string;
  n_steps: number;
  mae: number;
  direction_accuracy: number;
}

interface ModelResult {
  model_id: string;
  model_name: string;
  horizon: string;
  metrics: WalkForwardMetrics;
  steps: WalkForwardStep[];
  regime_metrics: RegimeSlice[];
}

export default function PredictionBacktest() {
  const [results, setResults] = useState<ModelResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prediction?horizon=21d&include_backtest=true");
      if (!res.ok) throw new Error("Failed to fetch prediction backtest");
      const data = await res.json();
      if (data.backtest_results) {
        setResults(data.backtest_results);
        if (data.backtest_results.length > 0) {
          setSelectedModel(data.backtest_results[0].model_id);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const selected = results?.find((r) => r.model_id === selectedModel);

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">Model Backtest</h3>
          <p className="text-xs text-zinc-400">
            Walk-forward validation of prediction models across market regimes
          </p>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded"
        >
          {loading ? "Running..." : "Run Backtest"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {results && (
        <>
          {/* Model comparison table */}
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-700">
                  <th className="text-left py-2 pr-3">Model</th>
                  <th className="text-right py-2 px-2">Steps</th>
                  <th className="text-right py-2 px-2">MAE</th>
                  <th className="text-right py-2 px-2">RMSE</th>
                  <th className="text-right py-2 px-2">Dir. Acc.</th>
                  <th className="text-right py-2 px-2">MAPE</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.model_id}
                    onClick={() => setSelectedModel(r.model_id)}
                    className={`border-b border-zinc-800 cursor-pointer hover:bg-zinc-700/30 ${
                      selectedModel === r.model_id ? "bg-zinc-700/50" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 text-zinc-200 font-medium">{r.model_name}</td>
                    <td className="text-right py-2 px-2 text-zinc-400">{r.metrics.n_steps}</td>
                    <td className="text-right py-2 px-2 text-zinc-300">{(r.metrics.mae * 100).toFixed(3)}%</td>
                    <td className="text-right py-2 px-2 text-zinc-300">{(r.metrics.rmse * 100).toFixed(3)}%</td>
                    <td className={`text-right py-2 px-2 font-medium ${
                      r.metrics.direction_accuracy > 0.52 ? "text-green-400" : "text-zinc-400"
                    }`}>
                      {(r.metrics.direction_accuracy * 100).toFixed(1)}%
                    </td>
                    <td className="text-right py-2 px-2 text-zinc-400">{r.metrics.mape.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Selected model details */}
          {selected && (
            <>
              {/* Regime slicing */}
              {selected.regime_metrics.length > 0 && (
                <div className="mb-5">
                  <h4 className="text-xs font-semibold text-zinc-400 uppercase mb-2">
                    Performance by Regime — {selected.model_name}
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {selected.regime_metrics.map((rm) => (
                      <div key={rm.regime_name} className="rounded-lg bg-zinc-700/50 p-3 min-w-[120px]">
                        <div className="text-xs text-zinc-400">{rm.regime_name}</div>
                        <div className="text-sm font-semibold text-zinc-100">
                          {(rm.direction_accuracy * 100).toFixed(1)}% dir
                        </div>
                        <div className="text-xs text-zinc-500">{rm.n_steps} steps</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error chart */}
              {selected.steps.length > 0 && (
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selected.steps} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#a1a1aa" }} interval={Math.floor(selected.steps.length / 6)} />
                      <YAxis tick={{ fontSize: 9, fill: "#a1a1aa" }} tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                      <Tooltip contentStyle={{ background: "#27272a", border: "1px solid #3f3f46", fontSize: 11 }} />
                      <ReferenceLine y={0} stroke="#52525b" strokeDasharray="3 3" />
                      <Bar dataKey="error" radius={[2, 2, 0, 0]}>
                        {selected.steps.map((s, i) => (
                          <Cell key={i} fill={s.direction_correct ? "#22c55e" : "#ef4444"} fillOpacity={0.7} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
