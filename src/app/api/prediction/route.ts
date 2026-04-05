/**
 * /api/prediction — V3 forecast API (#30).
 *
 * Returns point forecasts + intervals + driver attribution
 * for configurable horizons.
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
import { buildFeatures, FEATURE_SPECS } from "@/lib/pipeline/features";
import { trainAndEvaluate } from "@/lib/models/trainer";
import type { Horizon } from "@/lib/models/types";
import { analyzeHeadlineSentiment } from "@/lib/hf/sentiment";
import { llmForecast, chronosForecast } from "@/lib/hf/forecast";
import type { MarketSentiment } from "@/lib/hf/sentiment";
import type { HFForecast } from "@/lib/hf/forecast";

interface PredictionResponse {
  /** API version. */
  version: number;
  /** ISO timestamp of generation. */
  generated_at: string;
  /** Current cotton price used as base. */
  current_price: number;
  current_date: string;
  /** Forecasts by horizon. */
  forecasts: ForecastEntry[];
  /** Model metadata. */
  model: {
    id: string;
    name: string;
    train_samples: number;
    test_rmse: number;
    direction_accuracy: number;
  };
  /** Top feature drivers (absolute coefficient magnitude). */
  top_drivers: { feature: string; importance: number }[];
  /** HF-powered sentiment analysis on headlines. */
  sentiment: MarketSentiment | null;
  /** HF-powered AI forecasts (LLM + Chronos). */
  hf_forecasts: HFForecast[];
  /** Walk-forward backtest results (when include_backtest=true). */
  backtest_results: unknown;
}

interface ForecastEntry {
  horizon: string;
  /** Predicted return (e.g., 0.02 = +2%). */
  predicted_return: number;
  /** Predicted price. */
  predicted_price: number;
  /** Interval bounds. */
  lower_price: number;
  upper_price: number;
  /** Confidence level for interval. */
  confidence_level: number;
  direction: "up" | "down" | "flat";
}

const VALID_HORIZONS: Horizon[] = ["5d", "21d", "63d"];

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

    // Run pipeline to get factors
    const pipelineOutput = await runPipeline();
    if (pipelineOutput.target.length < 300) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Insufficient data for prediction" }, { status: 502 }),
        rateLimit.headers
      );
    }

    // Align and build features
    const dates = pipelineOutput.target.map((p) => p.date);
    const aligned = alignToDaily(pipelineOutput.factors, dates);
    const featureRows = buildFeatures(dates, aligned);

    if (featureRows.length < 300) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Insufficient feature data" }, { status: 502 }),
        rateLimit.headers
      );
    }

    // --- Inject live sentiment into latest feature rows ---
    // Compute sentiment BEFORE training so the model sees it as a real feature
    let liveSentimentScore = 0;
    try {
      const headlinesForSentiment = await fetch(new URL("/api/headlines", req.url).toString());
      if (headlinesForSentiment.ok) {
        const hlData = await headlinesForSentiment.json();
        const sentResult = await analyzeHeadlineSentiment(hlData).catch(() => null);
        if (sentResult) {
          liveSentimentScore = sentResult.aggregate_score;
          // Inject sentiment into the last 21 rows (recent context window)
          const injectWindow = Math.min(21, featureRows.length);
          for (let i = featureRows.length - injectWindow; i < featureRows.length; i++) {
            featureRows[i].features.sentiment_score = liveSentimentScore;
          }
        }
      }
    } catch { /* non-fatal — sentiment stays at 0 */ }

    // Fast path: single train/test split for real-time prediction (<2s).
    // Walk-forward is too heavy for serverless (400+ model trainings, >10s timeout).
    // Walk-forward is available via include_backtest=true for analysis.
    const { MODEL_REGISTRY } = await import("@/lib/models/trainer");
    const trainResult = trainAndEvaluate(featureRows, horizon, 0.85);
    const champion = trainResult.champion;

    // Get latest feature row for prediction
    const latestRow = featureRows[featureRows.length - 1];
    const featureNames = Object.keys(latestRow.features);
    const latestFeatures = featureNames.map((name) => {
      const v = latestRow.features[name];
      return v != null && Number.isFinite(v) ? v : 0;
    });

    // Find the model instance and predict
    const modelInstance = MODEL_REGISTRY.find((m) => m.meta.id === champion.model_id);
    if (!modelInstance) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Model not found" }, { status: 500 }),
        rateLimit.headers
      );
    }

    const prediction = modelInstance.predict(champion.state, latestFeatures);
    const currentPrice = latestRow.target;
    const predictedReturn = prediction.value;
    const predictedPrice = Math.round(currentPrice * (1 + predictedReturn) * 10000) / 10000;

    // Simple prediction interval based on test RMSE
    const intervalWidth = champion.rmse * 1.96; // ~95% CI
    const lowerPrice = Math.round(currentPrice * (1 + predictedReturn - intervalWidth) * 10000) / 10000;
    const upperPrice = Math.round(currentPrice * (1 + predictedReturn + intervalWidth) * 10000) / 10000;

    const direction: "up" | "down" | "flat" =
      predictedReturn > 0.005 ? "up" : predictedReturn < -0.005 ? "down" : "flat";

    // Top drivers: use ridge coefficients if available
    const topDrivers = extractDrivers(champion.state, featureNames);

    // Build forecasts for all horizons
    const forecasts: ForecastEntry[] = [];
    for (const h of VALID_HORIZONS) {
      if (h === horizon) {
        forecasts.push({
          horizon: h,
          predicted_return: Math.round(predictedReturn * 100000) / 100000,
          predicted_price: predictedPrice,
          lower_price: lowerPrice,
          upper_price: upperPrice,
          confidence_level: 0.95,
          direction,
        });
      } else {
        // Quick train for other horizons
        const otherResult = trainAndEvaluate(featureRows, h, 0.85);
        const otherModel = MODEL_REGISTRY.find((m) => m.meta.id === otherResult.champion.model_id);
        if (otherModel) {
          const otherPred = otherModel.predict(otherResult.champion.state, latestFeatures);
          const otherRet = otherPred.value;
          const otherInterval = otherResult.champion.rmse * 1.96;
          forecasts.push({
            horizon: h,
            predicted_return: Math.round(otherRet * 100000) / 100000,
            predicted_price: Math.round(currentPrice * (1 + otherRet) * 10000) / 10000,
            lower_price: Math.round(currentPrice * (1 + otherRet - otherInterval) * 10000) / 10000,
            upper_price: Math.round(currentPrice * (1 + otherRet + otherInterval) * 10000) / 10000,
            confidence_level: 0.95,
            direction: otherRet > 0.005 ? "up" : otherRet < -0.005 ? "down" : "flat",
          });
        }
      }
    }

    // --- HF-powered enhancements (parallel, non-blocking) ---
    const benchmarks = pipelineOutput.factors
      .find((f) => f.meta.id === "cotton_close")?.data ?? [];

    // Fetch headlines for sentiment
    let sentiment: MarketSentiment | null = null;
    let hfForecasts: HFForecast[] = [];
    try {
      const headlinesRes = await fetch(new URL("/api/headlines", req.url).toString());
      const headlines = headlinesRes.ok ? await headlinesRes.json() : [];

      // Run HF sentiment + forecasts in parallel
      const bmForHF: import("@/lib/types").Benchmarks = {
        current_price: currentPrice,
        price_date: latestRow.date,
        change_30d_pct: (latestRow.features.cotton_ret_21d ?? 0) * 100,
        change_90d_pct: (latestRow.features.cotton_ret_63d ?? 0) * 100,
        pct_rank_1y: latestRow.features.pct_rank_252d ?? 0.5,
        pct_rank_5y: latestRow.features.pct_rank_252d ?? 0.5,
        z_score_1y: 0,
        vol_30d_ann: latestRow.features.cotton_vol_21d ?? 20,
        vol_90d_ann: latestRow.features.cotton_vol_63d ?? 20,
        ma_50d: currentPrice,
        ma_200d: currentPrice,
        above_ma_50d: (latestRow.features.ma_cross_50_200 ?? 0) > 0,
        above_ma_200d: true,
        high_1y: currentPrice * 1.1,
        low_1y: currentPrice * 0.9,
      };

      const horizonDays = horizon === "5d" ? 5 : horizon === "21d" ? 21 : 63;
      const priceHistoryForChronos = pipelineOutput.target.map((p) => p.value);

      const [sentimentResult, llmResult, chronosResult] = await Promise.allSettled([
        analyzeHeadlineSentiment(headlines),
        llmForecast(bmForHF, null, latestRow.features, horizon),
        chronosForecast(priceHistoryForChronos, horizonDays),
      ]);

      sentiment = sentimentResult.status === "fulfilled" ? sentimentResult.value : null;

      // If we got sentiment, retry LLM forecast with it for better quality
      if (sentiment && llmResult.status !== "fulfilled") {
        try {
          const retryLlm = await llmForecast(bmForHF, sentiment, latestRow.features, horizon);
          if (retryLlm) hfForecasts.push(retryLlm);
        } catch { /* swallow */ }
      } else if (llmResult.status === "fulfilled" && llmResult.value) {
        hfForecasts.push(llmResult.value);
      }

      if (chronosResult.status === "fulfilled" && chronosResult.value) {
        hfForecasts.push(chronosResult.value);
      }
    } catch (e) {
      console.warn("[prediction] HF enhancement failed (non-fatal):", e);
    }

    // --- Backtest results (optional) ---
    const includeBacktest = searchParams.get("include_backtest") === "true";
    let backtestResults = undefined;
    if (includeBacktest) {
      try {
        const { compareModelsWalkForward } = await import("@/lib/models/walk-forward");
        const { MODEL_REGISTRY } = await import("@/lib/models/trainer");
        backtestResults = compareModelsWalkForward(MODEL_REGISTRY, featureRows, {
          min_train_size: 200,
          step_size: 21,
          horizon,
        });
      } catch (e) {
        console.warn("[prediction] Backtest computation failed (non-fatal):", e);
      }
    }

    const response: PredictionResponse = {
      version: 2,
      generated_at: new Date().toISOString(),
      current_price: Math.round(currentPrice * 10000) / 10000,
      current_date: latestRow.date,
      forecasts,
      model: {
        id: champion.model_id,
        name: champion.model_name,
        train_samples: champion.n_train,
        test_rmse: champion.rmse,
        direction_accuracy: champion.direction_accuracy,
      },
      top_drivers: topDrivers,
      sentiment,
      hf_forecasts: hfForecasts,
      backtest_results: backtestResults ?? null,
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
  if (!coef || coef.length !== featureNames.length) {
    // For non-linear models, return empty (would need SHAP for proper attribution)
    return [];
  }

  return featureNames
    .map((name, i) => ({ feature: name, importance: Math.round(Math.abs(coef[i]) * 100000) / 100000 }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);
}
