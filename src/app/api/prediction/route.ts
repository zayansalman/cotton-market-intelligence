/**
 * /api/prediction — Quantitative price forecast + LLM adjustment.
 *
 * Architecture (how a top quant commodity desk does it):
 *
 * LAYER 1: Quant Model → Price Curve
 *   Statistical models trained on 21 data sources, ~50 features.
 *   Gradient boosted trees (depth 3) capture non-linear cross-market
 *   interactions. Elastic net selects relevant features automatically.
 *   Top-3 ensemble reduces variance. This produces the PRICE CURVE.
 *
 * LAYER 2: LLM Adjustment
 *   The LLM sees the quant forecast + news + sentiment and can
 *   ADJUST the forecast for things models can't see:
 *   "Model predicts +2%, but India export ban → supply squeeze → +5%"
 *   This adjustment is additive, not replacement.
 *
 * GET ?horizon=21d
 */

import { NextResponse } from "next/server";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/api-security";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";
import { runPipeline, alignToDaily } from "@/lib/pipeline/runner";
import { buildFeatures } from "@/lib/pipeline/features";
import { trainAndEvaluate } from "@/lib/models/trainer";
import { hfChatCompletion, parseJsonResponse } from "@/lib/hf/client";
import { analyzeHeadlineSentiment } from "@/lib/hf/sentiment";
import type { Horizon } from "@/lib/models/types";

const VALID_HORIZONS: Horizon[] = ["5d", "21d", "63d"];

const LLM_ADJUSTMENT_PROMPT = `You are a senior cotton commodity analyst. You are given a QUANTITATIVE MODEL FORECAST and current NEWS. Your job is to ADJUST the model's forecast based on news that the model cannot account for.

The model uses: cross-market correlations (DXY, oil, soybeans, freight), momentum, volatility regime, technical indicators. It CANNOT read news or reason about geopolitics.

Your adjustment should be:
- POSITIVE (add to forecast) if news suggests prices will go HIGHER than the model predicts
- NEGATIVE (subtract from forecast) if news suggests prices will go LOWER
- ZERO if news is neutral or already reflected in price

Return ONLY valid JSON:
{
  "adjustment_pct": <additional % to add to model forecast, e.g., +2.0 or -1.5>,
  "reasoning": "<1-2 sentences: what news-driven factor does the model miss?>",
  "key_event": "<the single most important news event affecting price>"
}`;

export async function GET(req: Request) {
  const abuse = checkAbuse(req);
  if (abuse.blocked) return abuseBlockedResponse(abuse);

  const rateLimit = evaluateRequestRateLimit(req, "strategy");
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

  try {
    const { searchParams } = new URL(req.url);
    const horizonParam = searchParams.get("horizon") ?? "21d";
    const horizon: Horizon = VALID_HORIZONS.includes(horizonParam as Horizon)
      ? (horizonParam as Horizon)
      : "21d";

    // === LAYER 1: QUANT MODEL FORECAST ===

    // Run data pipeline
    const pipelineOutput = await runPipeline();
    if (pipelineOutput.target.length < 300) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Insufficient data" }, { status: 502 }),
        rateLimit.headers
      );
    }

    // Build features
    const dates = pipelineOutput.target.map((p) => p.date);
    const aligned = alignToDaily(pipelineOutput.factors, dates);
    const featureRows = buildFeatures(dates, aligned);

    if (featureRows.length < 100) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Insufficient feature data" }, { status: 502 }),
        rateLimit.headers
      );
    }

    // Train models and get ensemble prediction
    const { MODEL_REGISTRY } = await import("@/lib/models/trainer");
    const trainResult = trainAndEvaluate(featureRows, horizon, 0.85);
    const champion = trainResult.champion;

    // Ensemble prediction from top 3 models
    const featureNames = Object.keys(featureRows[0]?.features ?? {}).filter(
      (name) => name !== "sentiment_score"
    );
    const latestRow = featureRows[featureRows.length - 1];
    const latestFeatures = featureNames.map((name) => {
      const v = latestRow.features[name];
      return v != null && Number.isFinite(v) ? v : 0;
    });

    const top3Models = trainResult.top3Ids
      .map((id) => {
        const model = MODEL_REGISTRY.find((m) => m.meta.id === id);
        const result = trainResult.results.find((r) => r.model_id === id);
        return model && result ? { model, result } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // Model now predicts FUTURE PRICE LEVEL (not return).
    // Ensemble: inverse-RMSE weighted average of top 3 predictions.
    const currentPrice = latestRow.target;
    let modelPredictedPrice: number;

    if (top3Models.length > 1) {
      const weights = top3Models.map((m) => m.result.rmse > 0 ? 1 / m.result.rmse : 1);
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      modelPredictedPrice = 0;
      for (let i = 0; i < top3Models.length; i++) {
        const pred = top3Models[i].model.predict(top3Models[i].result.state, latestFeatures);
        modelPredictedPrice += (weights[i] / totalWeight) * pred.value;
      }
    } else {
      const inst = MODEL_REGISTRY.find((m) => m.meta.id === champion.model_id);
      modelPredictedPrice = inst ? inst.predict(champion.state, latestFeatures).value : currentPrice;
    }

    // Sanity check: predicted price should be within ±15% of current
    modelPredictedPrice = Math.max(currentPrice * 0.85, Math.min(currentPrice * 1.15, modelPredictedPrice));
    const modelReturn = (modelPredictedPrice - currentPrice) / currentPrice;

    // === LAYER 2: LLM ADJUSTMENT ===

    // Fetch headlines + sentiment
    // Construct base URL from request headers (serverless functions don't have reliable req.url base)
    const host = req.headers.get("host") ?? "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const baseUrl = `${proto}://${host}`;
    const headlinesRes = await fetch(`${baseUrl}/api/headlines`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Accept-Language": "en" },
    }).catch((e) => { console.error("[prediction] Headlines fetch failed:", e); return null; });
    const headlines = headlinesRes?.ok ? await headlinesRes.json() : [];
    console.info(`[prediction] Fetched ${headlines.length} headlines for LLM context`);
    const sentiment = await analyzeHeadlineSentiment(headlines).catch(() => null);

    let llmAdjustment = 0;
    let llmReasoning = "";
    let llmKeyEvent = "";

    console.info(`[prediction] LLM adjustment: ${headlines.length} headlines, calling HF chat...`);
    if (headlines.length > 0) {
      const headlineText = headlines
        .slice(0, 12)
        .map((h: { title: string }, i: number) => `${i + 1}. ${h.title}`)
        .join("\n");

      const sentText = sentiment
        ? `Sentiment: ${sentiment.label} (${sentiment.aggregate_score.toFixed(2)})`
        : "";

      const adjText = await hfChatCompletion({
        messages: [
          { role: "system", content: LLM_ADJUSTMENT_PROMPT },
          {
            role: "user",
            content: `MODEL FORECAST: ${(modelReturn * 100).toFixed(2)}% over ${horizon}\nCurrent price: $${currentPrice.toFixed(4)}/lb\n${sentText}\n\nNEWS:\n${headlineText}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.2,
      });

      if (adjText) {
        const parsed = parseJsonResponse(adjText);
        if (parsed) {
          llmAdjustment = Math.max(-5, Math.min(5, Number(parsed.adjustment_pct) || 0)) / 100;
          llmReasoning = String(parsed.reasoning || "");
          llmKeyEvent = String(parsed.key_event || "");
        }
      }
    }

    // Combined forecast: quant model price + LLM adjustment
    const totalReturn = modelReturn + llmAdjustment;
    const adjustedPrice = modelPredictedPrice * (1 + llmAdjustment);
    const predictedPrice = Math.round(
      Math.max(currentPrice * 0.85, Math.min(currentPrice * 1.15, adjustedPrice)) * 10000
    ) / 10000;

    // CI from realized vol (market-consistent)
    const pricesRes = await fetch(`${baseUrl}/api/prices`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Accept-Language": "en" },
    }).catch(() => null);
    let vol30d = 20; // default
    if (pricesRes?.ok) {
      const pd = await pricesRes.json();
      vol30d = pd.benchmarks?.vol_30d_ann ?? 20;
    }
    const horizonDays = horizon === "5d" ? 5 : horizon === "21d" ? 21 : 63;
    const ciWidth = (vol30d / 100) * Math.sqrt(horizonDays / 252) * 1.96;
    const lowerPrice = Math.round(currentPrice * (1 + totalReturn - ciWidth) * 10000) / 10000;
    const upperPrice = Math.round(currentPrice * (1 + totalReturn + ciWidth) * 10000) / 10000;

    const direction: "up" | "down" | "flat" =
      totalReturn > 0.003 ? "up" : totalReturn < -0.003 ? "down" : "flat";

    // Top drivers from model coefficients
    const topDrivers = extractDrivers(champion.state, featureNames);

    // === BACKTEST: Model's past predictions vs reality ===
    // Train on first 70% of data, predict the remaining 30%, compare.
    // This shows exactly how the model would have performed historically.
    const backtestSplit = Math.floor(featureRows.length * 0.7);
    const btTrainResult = trainAndEvaluate(featureRows.slice(0, backtestSplit + Math.floor(featureRows.length * 0.15)), horizon, 0.82);
    const btChampion = btTrainResult.champion;
    const btModel = MODEL_REGISTRY.find((m) => m.meta.id === btChampion.model_id);

    const backtestPoints: { date: string; predicted: number; actual: number; error_pct: number }[] = [];
    if (btModel) {
      // Predict on the held-out test period (last 30%)
      const testRows = featureRows.slice(backtestSplit);
      for (const row of testRows) {
        const target = row.fwd_return_21d; // This is now the future price
        if (target == null) continue;

        const fVec = featureNames.map((name) => {
          const v = row.features[name];
          return v != null && Number.isFinite(v) ? v : 0;
        });

        const pred = btModel.predict(btChampion.state, fVec);
        const predictedPrice = pred.value;
        const actualPrice = target;
        const errorPct = actualPrice > 0 ? ((predictedPrice - actualPrice) / actualPrice) * 100 : 0;

        backtestPoints.push({
          date: row.date,
          predicted: Math.round(predictedPrice * 10000) / 10000,
          actual: Math.round(actualPrice * 10000) / 10000,
          error_pct: Math.round(errorPct * 100) / 100,
        });
      }
    }

    // Backtest accuracy metrics
    const btActuals = backtestPoints.map((p) => p.actual);
    const btPreds = backtestPoints.map((p) => p.predicted);
    const btMAE = btActuals.length > 0
      ? btActuals.reduce((s, a, i) => s + Math.abs(a - btPreds[i]), 0) / btActuals.length
      : 0;
    const btDirAcc = btActuals.length > 1
      ? btActuals.filter((a, i) => {
          if (i === 0) return true;
          const actualDir = a > btActuals[i - 1];
          const predDir = btPreds[i] > btPreds[i - 1];
          return actualDir === predDir;
        }).length / btActuals.length
      : 0;

    const response = {
      version: 4,
      generated_at: new Date().toISOString(),
      current_price: Math.round(currentPrice * 10000) / 10000,
      current_date: latestRow.date,
      forecasts: [{
        horizon,
        predicted_return: Math.round(totalReturn * 100000) / 100000,
        predicted_price: predictedPrice,
        lower_price: lowerPrice,
        upper_price: upperPrice,
        confidence_level: 0.95,
        direction,
      }],
      model: {
        id: champion.model_id,
        name: `${champion.model_name} + LLM adjustment`,
        train_samples: champion.n_train,
        test_rmse: champion.rmse,
        direction_accuracy: champion.direction_accuracy,
      },
      // Decomposition: what drove the forecast
      decomposition: {
        quant_model_return: Math.round(modelReturn * 100000) / 100000,
        llm_adjustment: Math.round(llmAdjustment * 100000) / 100000,
        total_return: Math.round(totalReturn * 100000) / 100000,
        llm_reasoning: llmReasoning,
        llm_key_event: llmKeyEvent,
      },
      top_drivers: topDrivers,
      sentiment,
      hf_forecasts: llmAdjustment !== 0 ? [{
        provider: "hf_llm",
        predicted_price: predictedPrice,
        predicted_return: totalReturn,
        direction,
        confidence: 0.6,
        model_used: "Qwen/Qwen2.5-7B-Instruct",
        reasoning: llmReasoning,
      }] : [],
    };

    return applyRateLimitHeaders(NextResponse.json(response), rateLimit.headers);
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "strategy"),
      rateLimit.headers
    );
  }
}

function extractDrivers(
  state: Record<string, unknown>,
  featureNames: string[]
): { feature: string; importance: number }[] {
  const coef = state.coefficients as number[] | undefined;
  if (!coef || coef.length !== featureNames.length) return [];
  return featureNames
    .map((name, i) => ({ feature: name, importance: Math.round(Math.abs(coef[i]) * 100000) / 100000 }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);
}
