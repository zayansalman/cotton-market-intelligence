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

interface HFForecast {
  provider: string;
  horizon: string;
  predicted_return: number;
  predicted_price: number;
  direction: "up" | "down" | "flat";
  confidence: number;
  reasoning?: string;
  model_used: string;
}

interface MarketSentiment {
  aggregate_score: number;
  label: "bullish" | "bearish" | "neutral";
  confidence: number;
  n_headlines: number;
  positive_pct: number;
  negative_pct: number;
  neutral_pct: number;
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
    kind: "model_stack" | "llm_fallback" | "heuristic_fallback";
    train_samples: number | null;
    test_rmse: number | null;
    direction_accuracy: number | null;
    validation_note?: string;
  };
  top_drivers: { feature: string; importance: number }[];
  sentiment: MarketSentiment | null;
  hf_forecasts: HFForecast[];
}

const SENTIMENT_STYLE: Record<string, string> = {
  bullish: "text-green-400 bg-green-500/10 border-green-500/30",
  bearish: "text-red-400 bg-red-500/10 border-red-500/30",
  neutral: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30",
};

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
  const visibleHfForecasts =
    prediction?.hf_forecasts.filter(
      (hf) => !(prediction.model.kind === "llm_fallback" && hf.provider === "hf_llm")
    ) ?? [];

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
            Model-stack forecast with optional HF analyst context
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
                {prediction.model.direction_accuracy != null
                  ? `${(prediction.model.direction_accuracy * 100).toFixed(1)}%`
                  : "not claimed"}
              </span>
            </span>
            <span>
              Training samples:{" "}
              <span className="text-zinc-200">
                {prediction.model.train_samples ?? "n/a"}
              </span>
            </span>
            <span>
              Base: ${prediction.current_price.toFixed(4)}/lb ({prediction.current_date})
            </span>
            {prediction.model.validation_note && (
              <span className="basis-full text-zinc-500">
                {prediction.model.validation_note}
              </span>
            )}
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

          {/* Market Sentiment */}
          {prediction.sentiment && (
            <div className={`mt-4 rounded-lg border p-3 ${SENTIMENT_STYLE[prediction.sentiment.label]}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase">
                    News Sentiment: {prediction.sentiment.label}
                  </span>
                  <span className="text-xs ml-2 opacity-70">
                    (score: {prediction.sentiment.aggregate_score.toFixed(2)}, {prediction.sentiment.n_headlines} headlines)
                  </span>
                </div>
              </div>
              <div className="flex gap-4 mt-1 text-xs opacity-70">
                <span>Positive: {prediction.sentiment.positive_pct}%</span>
                <span>Neutral: {prediction.sentiment.neutral_pct}%</span>
                <span>Negative: {prediction.sentiment.negative_pct}%</span>
              </div>
            </div>
          )}

          {/* HF AI Forecasts */}
          {visibleHfForecasts.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-zinc-400 uppercase mb-2">
                AI Model Forecasts (Hugging Face)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleHfForecasts.map((hf, i) => (
                  <div key={i} className="rounded-lg bg-zinc-700/30 border border-zinc-700 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">
                        {hf.provider === "hf_llm" ? "LLM Analyst" : "AI Forecast"}
                      </span>
                      <span className={`text-xs font-semibold ${DIRECTION_STYLE[hf.direction]}`}>
                        {DIRECTION_ICON[hf.direction]} {hf.direction.toUpperCase()}
                      </span>
                    </div>
                    <div className={`text-lg font-bold mt-1 ${DIRECTION_STYLE[hf.direction]}`}>
                      ${hf.predicted_price.toFixed(4)}/lb
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      {hf.predicted_return > 0 ? "+" : ""}{(hf.predicted_return * 100).toFixed(2)}%
                      ({hf.horizon}) | Conf: {(hf.confidence * 100).toFixed(0)}%
                    </div>
                    {hf.reasoning && (
                      <p className="text-xs text-zinc-500 mt-2 italic">{hf.reasoning}</p>
                    )}
                    <div className="text-[10px] text-zinc-600 mt-1">
                      Model: {hf.model_used}
                    </div>
                  </div>
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
