/**
 * Experimental HF-powered price forecasting helpers.
 *
 * These helpers are not the live primary `/api/prediction` path. The route
 * currently runs the local TypeScript model stack first, then uses Qwen as
 * analyst context/fallback, then deterministic heuristic fallback.
 *
 * 1. LLM Quant Analyst — Structured prompt to Qwen with price data,
 *    features, and sentiment for directional + magnitude forecast
 *
 * 2. Chronos T5 — Amazon's time-series foundation model for
 *    probabilistic point forecasts (when available via Inference API)
 */

import { fetchWithTimeout } from "@/lib/api-security";
import type { Benchmarks, Headline } from "@/lib/types";
import type { MarketSentiment } from "./sentiment";
import { hfChatCompletion, parseJsonResponse } from "./client";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HFForecast {
  provider: "hf_llm" | "hf_chronos" | "local";
  horizon: string;
  predicted_return: number;
  predicted_price: number;
  direction: "up" | "down" | "flat";
  confidence: number;
  reasoning?: string;
  model_used: string;
}

/* ------------------------------------------------------------------ */
/*  1. LLM Quant Analyst Forecast                                      */
/* ------------------------------------------------------------------ */

const QUANT_SYSTEM_PROMPT = `You are a quantitative commodity analyst specializing in cotton futures.
Given market data, technical features, and news sentiment, provide a precise
directional forecast.

Return ONLY a JSON object:
{
  "direction": "up" | "down" | "flat",
  "magnitude_pct": <expected return in % for the horizon>,
  "confidence": <0-100>,
  "key_drivers": ["<driver1>", "<driver2>", "<driver3>"],
  "reasoning": "<2-3 sentence rationale>"
}`;

export async function llmForecast(
  benchmarks: Benchmarks,
  sentiment: MarketSentiment | null,
  features: Record<string, number | null>,
  horizon: string
): Promise<HFForecast | null> {
  if (!process.env.HF_TOKEN) return null;

  const model = process.env.HF_STRATEGY_MODEL ?? "Qwen/Qwen2.5-7B-Instruct";

  const userMsg = `COTTON #2 FUTURES DATA:
Price: $${benchmarks.current_price.toFixed(4)}/lb (${benchmarks.price_date})
1Y Percentile: ${(benchmarks.pct_rank_1y * 100).toFixed(0)}%
Z-Score: ${benchmarks.z_score_1y.toFixed(2)}
30d Vol: ${benchmarks.vol_30d_ann.toFixed(1)}%
30d Change: ${benchmarks.change_30d_pct.toFixed(1)}%
90d Change: ${benchmarks.change_90d_pct.toFixed(1)}%
50d MA: $${benchmarks.ma_50d.toFixed(4)}, 200d MA: $${benchmarks.ma_200d.toFixed(4)}
Above 50d MA: ${benchmarks.above_ma_50d}, Above 200d MA: ${benchmarks.above_ma_200d}

KEY FEATURES:
RSI-14: ${features.rsi_14 ?? "N/A"}
Vol Regime: ${features.vol_regime ?? "N/A"} (0=low, 1=normal, 2=high)
Trend Regime: ${features.trend_regime ?? "N/A"} (1=up, -1=down, 0=range)
Cotton/DXY Ratio: ${features.cotton_dxy_ratio ?? "N/A"}
5d Return: ${features.cotton_ret_5d != null ? (features.cotton_ret_5d * 100).toFixed(2) + "%" : "N/A"}
21d Return: ${features.cotton_ret_21d != null ? (features.cotton_ret_21d * 100).toFixed(2) + "%" : "N/A"}

NEWS SENTIMENT: ${sentiment ? `${sentiment.label} (score: ${sentiment.aggregate_score.toFixed(2)}, ${sentiment.positive_pct}% positive, ${sentiment.negative_pct}% negative)` : "Not available"}

FORECAST HORIZON: ${horizon}

Analyze all signals and provide your ${horizon} cotton price forecast.`;

  try {
    const text = await hfChatCompletion({
      messages: [
        { role: "system", content: QUANT_SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      max_tokens: 400,
      temperature: 0.2,
    });

    if (!text) return null;

    const rawParsed = parseJsonResponse(text);
    if (!rawParsed) return null;

    const parsed = rawParsed as {
      direction: string;
      magnitude_pct: number;
      confidence: number;
      reasoning?: string;
    };

    const direction = parsed.direction === "up" ? "up" : parsed.direction === "down" ? "down" : "flat";
    const returnPct = Number(parsed.magnitude_pct) || 0;
    const predictedReturn = direction === "down" ? -Math.abs(returnPct) / 100 : Math.abs(returnPct) / 100;

    return {
      provider: "hf_llm",
      horizon,
      predicted_return: Math.round(predictedReturn * 100000) / 100000,
      predicted_price: Math.round(benchmarks.current_price * (1 + predictedReturn) * 10000) / 10000,
      direction,
      confidence: Math.min(100, Math.max(0, parsed.confidence || 50)) / 100,
      reasoning: parsed.reasoning,
      model_used: model,
    };
  } catch (e) {
    console.error("[hf-forecast] LLM forecast failed:", e);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  2. Chronos T5 Time-Series Forecast                                 */
/* ------------------------------------------------------------------ */

export async function chronosForecast(
  priceHistory: number[],
  horizonDays: number
): Promise<HFForecast | null> {
  const token = process.env.HF_TOKEN;
  if (!token) return null;

  // Chronos expects a simple array of past values
  // Use last 512 points (model context limit)
  const context = priceHistory.slice(-512);
  if (context.length < 30) return null;

  try {
    const res = await fetchWithTimeout(
      "https://router.huggingface.co/hf-inference/models/amazon/chronos-t5-small",
      {
        method: "POST",
        timeout: 30_000,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: {
            past_values: context,
            future_length: horizonDays,
          },
          parameters: {},
          options: { wait_for_model: true },
        }),
      }
    );

    if (!res.ok) {
      console.error(`[hf-forecast] Chronos error: ${res.status}`);
      return null;
    }

    const data = await res.json();

    // Chronos returns predicted values or quantiles
    let forecastValues: number[] = [];
    if (Array.isArray(data) && typeof data[0] === "number") {
      forecastValues = data;
    } else if (data?.predicted_values) {
      forecastValues = data.predicted_values;
    } else if (Array.isArray(data) && data[0]?.predicted_values) {
      forecastValues = data[0].predicted_values;
    }

    if (forecastValues.length === 0) {
      console.warn("[hf-forecast] Chronos returned no forecast values");
      return null;
    }

    const currentPrice = context[context.length - 1];
    const forecastPrice = forecastValues[forecastValues.length - 1];
    const predictedReturn = (forecastPrice - currentPrice) / currentPrice;

    const direction: HFForecast["direction"] =
      predictedReturn > 0.005 ? "up" : predictedReturn < -0.005 ? "down" : "flat";

    const horizonLabel = horizonDays <= 7 ? "5d" : horizonDays <= 30 ? "21d" : "63d";

    return {
      provider: "hf_chronos",
      horizon: horizonLabel,
      predicted_return: Math.round(predictedReturn * 100000) / 100000,
      predicted_price: Math.round(forecastPrice * 10000) / 10000,
      direction,
      confidence: 0.6, // Chronos doesn't provide confidence directly
      model_used: "amazon/chronos-t5-small",
    };
  } catch (e) {
    console.error("[hf-forecast] Chronos forecast failed:", e);
    return null;
  }
}
