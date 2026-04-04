"use client";

import { useState, useCallback } from "react";

interface ForecastEntry {
  horizon: string;
  predicted_return: number;
  predicted_price: number;
  lower_price: number;
  upper_price: number;
  confidence_level: number;
  direction: "up" | "down" | "flat";
}

interface PredictionResponse {
  version: number;
  generated_at: string;
  current_price: number;
  current_date: string;
  forecasts: ForecastEntry[];
  model: {
    id: string;
    name: string;
    train_samples: number;
    test_rmse: number;
    direction_accuracy: number;
  };
  top_drivers: { feature: string; importance: number }[];
}

const DIRECTION_STYLE: Record<string, string> = {
  up: "text-green-400",
  down: "text-red-400",
  flat: "text-zinc-400",
};

const DIRECTION_ICON: Record<string, string> = {
  up: "\u2191",
  down: "\u2193",
  flat: "\u2192",
};

export default function ForecastOverlay() {
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrediction = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prediction?horizon=21d");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Prediction failed (${res.status})`);
      }
      setPrediction(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prediction failed");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">
            Price Forecast
          </h3>
          <p className="text-xs text-zinc-400">
            ML-driven cotton price predictions with confidence intervals
          </p>
        </div>
        <button
          onClick={fetchPrediction}
          disabled={loading}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded"
        >
          {loading ? "Computing..." : "Generate Forecast"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {prediction && (
        <>
          {/* Horizon forecasts */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            {prediction.forecasts.map((f) => (
              <div
                key={f.horizon}
                className="rounded-lg bg-zinc-700/50 p-4"
              >
                <div className="text-xs text-zinc-400 mb-1">
                  {f.horizon} Forecast
                </div>
                <div className={`text-xl font-bold ${DIRECTION_STYLE[f.direction]}`}>
                  {DIRECTION_ICON[f.direction]} ${f.predicted_price.toFixed(4)}/lb
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {f.predicted_return > 0 ? "+" : ""}
                  {(f.predicted_return * 100).toFixed(2)}% from current
                </div>
                <div className="text-xs text-zinc-600 mt-1">
                  95% CI: ${f.lower_price.toFixed(4)} — ${f.upper_price.toFixed(4)}
                </div>
              </div>
            ))}
          </div>

          {/* Model info */}
          <div className="flex flex-wrap gap-4 text-xs text-zinc-400 mb-4">
            <span>
              Model: <span className="text-zinc-200">{prediction.model.name}</span>
            </span>
            <span>
              Direction accuracy:{" "}
              <span className="text-zinc-200">
                {(prediction.model.direction_accuracy * 100).toFixed(1)}%
              </span>
            </span>
            <span>
              Training samples:{" "}
              <span className="text-zinc-200">{prediction.model.train_samples}</span>
            </span>
            <span>
              Base: ${prediction.current_price.toFixed(4)}/lb ({prediction.current_date})
            </span>
          </div>

          {/* Top drivers */}
          {prediction.top_drivers.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-400 uppercase mb-2">
                Top Forecast Drivers
              </h4>
              <div className="flex flex-wrap gap-2">
                {prediction.top_drivers.slice(0, 8).map((d) => (
                  <span
                    key={d.feature}
                    className="text-xs bg-zinc-700/50 text-zinc-300 px-2 py-1 rounded"
                  >
                    {d.feature.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-zinc-600 mt-4">
            Generated {new Date(prediction.generated_at).toLocaleString()}.
            Forecasts are model-generated estimates, not trading advice.
            Confidence intervals assume normally distributed errors.
          </p>
        </>
      )}
    </div>
  );
}
