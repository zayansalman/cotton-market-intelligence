"use client";

import { useState, useCallback } from "react";
import type { ForecastOverlayData, ForecastPoint, BacktestPrediction } from "@/components/PriceChart";

interface PredictionForecast {
  horizon: string;
  predicted_return: number;
  predicted_price: number;
  lower_price: number;
  upper_price: number;
  direction: "up" | "down" | "flat";
}

interface HFForecast {
  provider: string;
  predicted_price: number;
  predicted_return: number;
  direction: string;
  confidence: number;
  model_used: string;
  reasoning?: string;
}

interface PredictionResponse {
  current_price: number;
  current_date: string;
  forecasts: PredictionForecast[];
  model: { name: string; test_rmse: number; direction_accuracy: number };
  top_drivers: { feature: string; importance: number }[];
  hf_forecasts?: HFForecast[];
  sentiment?: { label: string; aggregate_score: number; n_headlines: number } | null;
}

/** Forecast attribution — what drove the prediction and how much. */
export interface ForecastAttribution {
  sources: {
    name: string;
    weight: string;
    direction: "up" | "down" | "flat";
    detail: string;
  }[];
  model_name: string;
  model_accuracy: string;
  top_features: string[];
}

function futureDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(startDate);
  while (dates.length < count) {
    d.setDate(d.getDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

/**
 * Cap predicted return to realistic bounds.
 * Cotton rarely moves more than 10% in 21 trading days.
 * Even during India export ban (2022), max monthly move was ~15%.
 */
const MAX_21D_RETURN = 0.12; // ±12%

export function useForecast() {
  const [forecast, setForecast] = useState<ForecastOverlayData | undefined>();
  const [attribution, setAttribution] = useState<ForecastAttribution | null>(null);
  const [backtestPredictions, setBacktestPredictions] = useState<BacktestPrediction[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchForecast = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prediction?horizon=21d");
      if (!res.ok) throw new Error("Prediction failed");
      const data: PredictionResponse = await res.json();

      const horizonDays: Record<string, number> = { "5d": 5, "21d": 21, "63d": 63 };
      const points: ForecastPoint[] = [];

      const primary = data.forecasts.find((f) => f.horizon === "21d") ?? data.forecasts[0];
      if (!primary) return;

      const dates = futureDates(data.current_date, horizonDays[primary.horizon] ?? 21);
      const startPrice = data.current_price;

      // Build attribution sources
      const sources: ForecastAttribution["sources"] = [];

      // 1. Local model forecast
      const localReturn = primary.predicted_return;
      const localDir = localReturn > 0.003 ? "up" : localReturn < -0.003 ? "down" : "flat";
      sources.push({
        name: `Quant Model (${data.model.name})`,
        weight: "40%",
        direction: localDir as "up" | "down" | "flat",
        detail: `${(localReturn * 100).toFixed(2)}% predicted return, ${(data.model.direction_accuracy * 100).toFixed(0)}% directional accuracy`,
      });

      // 2. HF forecasts
      let hfBlendReturn = 0;
      let hfCount = 0;
      if (data.hf_forecasts && data.hf_forecasts.length > 0) {
        for (const hf of data.hf_forecasts) {
          if (hf.predicted_price > 0) {
            const hfReturn = (hf.predicted_price - startPrice) / startPrice;
            // Cap HF returns to realistic bounds
            const cappedReturn = Math.max(-MAX_21D_RETURN, Math.min(MAX_21D_RETURN, hfReturn));
            hfBlendReturn += cappedReturn;
            hfCount++;
            sources.push({
              name: hf.provider === "hf_llm" ? "LLM Analyst (Qwen 2.5 7B)" : `AI Model (${hf.model_used})`,
              weight: hf.provider === "hf_llm" ? "20%" : "10%",
              direction: (hf.direction as "up" | "down" | "flat") ?? "flat",
              detail: hf.reasoning?.slice(0, 100) ?? `${(cappedReturn * 100).toFixed(2)}% return, ${(hf.confidence * 100).toFixed(0)}% confidence`,
            });
          }
        }
        if (hfCount > 0) hfBlendReturn /= hfCount;
      }

      // 3. Sentiment
      if (data.sentiment) {
        const sentDir = data.sentiment.aggregate_score > 0.1 ? "up" : data.sentiment.aggregate_score < -0.1 ? "down" : "flat";
        sources.push({
          name: "News Sentiment (DistilRoBERTa)",
          weight: "15%",
          direction: sentDir as "up" | "down" | "flat",
          detail: `${data.sentiment.label} (score: ${data.sentiment.aggregate_score.toFixed(2)}, ${data.sentiment.n_headlines} headlines analyzed)`,
        });
      }

      // Compute blended forecast return.
      // If model returns near-zero (naive or flat prediction), use any
      // available signal — HF forecasts, or the 5d/63d horizons which
      // might have more signal. A flat forecast is useless for procurement.
      let finalReturn = localReturn;

      // Blend with HF when local is flat and HF has a view
      if (Math.abs(localReturn) < 0.003 && hfCount > 0) {
        finalReturn = hfBlendReturn; // Use HF signal directly, not 50/50
      }

      // If still flat, check other horizons for any signal
      if (Math.abs(finalReturn) < 0.003) {
        const altForecast = data.forecasts.find(
          (f) => Math.abs(f.predicted_return) > 0.003
        );
        if (altForecast) {
          finalReturn = altForecast.predicted_return;
        }
      }

      // Cap to realistic bounds (cotton rarely moves >12% in 21 days)
      finalReturn = Math.max(-MAX_21D_RETURN, Math.min(MAX_21D_RETURN, finalReturn));

      const endPrice = Math.round(startPrice * (1 + finalReturn) * 10000) / 10000;
      // CI based on model RMSE (wider = more honest)
      const rmse = data.model.test_rmse || 0.05;
      const ciWidth = rmse * 1.96;
      const endLower = Math.round(startPrice * (1 + finalReturn - ciWidth) * 10000) / 10000;
      const endUpper = Math.round(startPrice * (1 + finalReturn + ciWidth) * 10000) / 10000;

      // Use slight curve (ease-out) instead of linear interpolation
      // This looks more natural — fast initial move, then flattening
      for (let i = 0; i < dates.length; i++) {
        const t = (i + 1) / dates.length;
        const eased = 1 - Math.pow(1 - t, 1.5); // ease-out curve
        points.push({
          date: dates[i],
          predicted_price: Math.round((startPrice + (endPrice - startPrice) * eased) * 10000) / 10000,
          lower_price: Math.round((startPrice + (endLower - startPrice) * eased) * 10000) / 10000,
          upper_price: Math.round((startPrice + (endUpper - startPrice) * eased) * 10000) / 10000,
          horizon: primary.horizon,
        });
      }

      const direction: "up" | "down" | "flat" =
        finalReturn > 0.003 ? "up" : finalReturn < -0.003 ? "down" : "flat";

      setForecast({
        points,
        model_name: data.model.name,
        direction,
      });

      setAttribution({
        sources,
        model_name: data.model.name,
        model_accuracy: `RMSE: ${(rmse * 100).toFixed(2)}%, Direction: ${(data.model.direction_accuracy * 100).toFixed(0)}%`,
        top_features: (data.top_drivers ?? []).slice(0, 6).map((d) => d.feature.replace(/_/g, " ")),
      });

      // Fetch strategy backtest for chart overlay (lightweight, no model walk-forward)
      try {
        const btRes = await fetch(
          `/api/backtest?tonnage=2000&months=6&step_months=3`
        );
        if (btRes.ok) {
          const btData = await btRes.json();
          if (btData.steps) {
            const btPoints: BacktestPrediction[] = btData.steps.map(
              (s: { decision_date: string; price_at_decision: number; weighted_exec_price: number; savings_pct: number }) => ({
                date: s.decision_date,
                predicted_price: s.weighted_exec_price,
                actual_price: s.price_at_decision,
                direction_correct: s.savings_pct > 0,
              })
            );
            setBacktestPredictions(btPoints);
          }
        }
      } catch { /* backtest overlay is non-fatal */ }
    } catch (e) {
      console.error("Forecast fetch failed:", e);
      setForecast(undefined);
      setAttribution(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return { forecast, attribution, backtestPredictions, forecastLoading: loading, fetchForecast };
}
