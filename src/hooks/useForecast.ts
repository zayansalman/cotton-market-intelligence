"use client";

import { useState, useCallback, useEffect } from "react";
import type {
  ForecastOverlayData,
  ForecastPoint,
  PredictionPerformanceMetrics,
  PreviousForecastOverlayData,
} from "@/components/PriceChart";

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

interface ForecastEvidence {
  source: string;
  kind: "model_stack" | "heuristic" | "sentiment" | "news_context";
  predicted_return: number | null;
  direction: "up" | "down" | "flat";
  confidence: number | null;
  validation_note: string;
  reasoning: string;
}

interface PredictionResponse {
  current_price: number;
  current_date: string;
  forecasts: PredictionForecast[];
  model: {
    id: string;
    name: string;
    kind: "llm_synthesis" | "model_stack" | "llm_fallback" | "heuristic_fallback";
    test_rmse: number | null;
    direction_accuracy: number | null;
    validation_note?: string;
  };
  top_drivers: { feature: string; importance: number }[];
  forecast_evidence?: ForecastEvidence[];
  hf_forecasts?: HFForecast[];
  sentiment?: { label: string; aggregate_score: number; n_headlines: number } | null;
  methodology?: Record<string, MethodologySignal> | null;
  reasoning?: string;
  risk?: string;
  confidence?: number;
}

interface ForecastHistoryResponse {
  metrics?: PredictionPerformanceMetrics;
}

interface PreviousForecastResponse {
  forecasts?: PreviousForecastOverlayData[];
}

/** Forecast attribution — what drove the prediction and how much. */
export interface MethodologySignal {
  signal: string;
  observation: string;
  weight: string;
}

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
  methodology: Record<string, MethodologySignal> | null;
  reasoning: string;
  risk: string;
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
  const [previousForecasts, setPreviousForecasts] = useState<PreviousForecastOverlayData[]>([]);
  const [predictionPerformance, setPredictionPerformance] =
    useState<PredictionPerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPredictionHistory = useCallback(async () => {
    const fhRes = await fetch("/api/forecast-history").catch(() => null);
    if (!fhRes?.ok) {
      setPredictionPerformance(null);
      return;
    }

    const fhData: ForecastHistoryResponse = await fhRes.json();
    setPredictionPerformance(fhData.metrics ?? null);
  }, []);

  const loadPreviousForecasts = useCallback(async () => {
    const prevRes = await fetch("/api/previous-forecast?months_ago=1&horizon=21d").catch(() => null);
    if (!prevRes?.ok) {
      setPreviousForecasts([]);
      return;
    }

    const prevData: PreviousForecastResponse = await prevRes.json();
    setPreviousForecasts(prevData.forecasts ?? []);
  }, []);

  useEffect(() => {
    void Promise.all([loadPredictionHistory(), loadPreviousForecasts()]);
  }, [loadPredictionHistory, loadPreviousForecasts]);

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

      // 1. Primary forecast source
      const localReturn = primary.predicted_return;
      const localDir = localReturn > 0.003 ? "up" : localReturn < -0.003 ? "down" : "flat";
      const primarySourceName =
        data.model.kind === "llm_synthesis"
          ? "LLM Analyst Synthesis (Qwen 2.5 7B)"
          : data.model.kind === "model_stack"
          ? `Quant Model (${data.model.name})`
          : data.model.kind === "llm_fallback"
            ? "LLM Analyst (Qwen 2.5 7B)"
            : "Heuristic fallback";
      const primaryAccuracy =
        data.model.direction_accuracy != null
          ? `${(data.model.direction_accuracy * 100).toFixed(0)}% directional accuracy`
          : data.model.validation_note ?? "No historical validation metrics claimed";
      sources.push({
        name: primarySourceName,
        weight: data.model.kind === "llm_synthesis" ? "final decision" : data.model.kind === "model_stack" ? "primary model" : "fallback",
        direction: localDir as "up" | "down" | "flat",
        detail: `${(localReturn * 100).toFixed(2)}% predicted return, ${primaryAccuracy}`,
      });

      // 2. Evidence the analyst considered
      if (data.forecast_evidence?.length) {
        for (const evidence of data.forecast_evidence) {
          const evidenceReturn = evidence.predicted_return;
          sources.push({
            name: evidence.source,
            weight: evidence.kind === "model_stack" ? "quant evidence" : "supporting evidence",
            direction: evidence.direction,
            detail:
              `${evidenceReturn != null ? `${(evidenceReturn * 100).toFixed(2)}% implied return, ` : ""}` +
              evidence.reasoning.slice(0, 140),
          });
        }
      } else if (data.hf_forecasts && data.hf_forecasts.length > 0) {
        for (const hf of data.hf_forecasts) {
          if (data.model.kind === "llm_fallback" && hf.provider === "hf_llm") {
            continue;
          }
          if (hf.predicted_price > 0) {
            const hfReturn = (hf.predicted_price - startPrice) / startPrice;
            // Cap HF returns to realistic bounds
            const cappedReturn = Math.max(-MAX_21D_RETURN, Math.min(MAX_21D_RETURN, hfReturn));
            sources.push({
              name: hf.provider === "hf_llm" ? "LLM Analyst (Qwen 2.5 7B)" : `AI Model (${hf.model_used})`,
              weight: hf.provider === "hf_llm" ? "analyst evidence" : "model evidence",
              direction: (hf.direction as "up" | "down" | "flat") ?? "flat",
              detail: hf.reasoning?.slice(0, 100) ?? `${(cappedReturn * 100).toFixed(2)}% return, ${(hf.confidence * 100).toFixed(0)}% confidence`,
            });
          }
        }
      }

      // 3. Sentiment fallback for older responses without forecast_evidence
      if (data.sentiment && !data.forecast_evidence?.some((e) => e.kind === "sentiment")) {
        const sentDir = data.sentiment.aggregate_score > 0.1 ? "up" : data.sentiment.aggregate_score < -0.1 ? "down" : "flat";
        sources.push({
          name: "News Sentiment (DistilRoBERTa)",
          weight: "sentiment evidence",
          direction: sentDir as "up" | "down" | "flat",
          detail: `${data.sentiment.label} (score: ${data.sentiment.aggregate_score.toFixed(2)}, ${data.sentiment.n_headlines} headlines analyzed)`,
        });
      }

      // Use predicted price directly from API (model predicts price level, not return)
      const endPrice = primary.predicted_price;
      const endLower = primary.lower_price;
      const endUpper = primary.upper_price;
      const finalReturn = (endPrice - startPrice) / startPrice;

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
        model_accuracy:
          data.model.direction_accuracy != null
            ? `Direction accuracy: ${(data.model.direction_accuracy * 100).toFixed(1)}%`
            : `Confidence: ${data.confidence ?? "?"}%`,
        top_features: (data.top_drivers ?? []).slice(0, 6).map((d) => d.feature.replace(/_/g, " ")),
        methodology: data.methodology ?? null,
        reasoning: data.reasoning ?? "",
        risk: data.risk ?? "",
      });

      // Refresh stored metrics + prior forecast path after the live forecast stores.
      try {
        await Promise.all([
          loadPredictionHistory().catch(() => undefined),
          loadPreviousForecasts().catch(() => undefined),
        ]);
      } catch { /* Previous-forecast overlays are non-fatal. */ }
    } catch (e) {
      console.error("Forecast fetch failed:", e);
      setForecast(undefined);
      setAttribution(null);
    } finally {
      setLoading(false);
    }
  }, [loadPredictionHistory, loadPreviousForecasts]);

  return {
    forecast,
    attribution,
    previousForecasts,
    predictionPerformance,
    forecastLoading: loading,
    fetchForecast,
  };
}
