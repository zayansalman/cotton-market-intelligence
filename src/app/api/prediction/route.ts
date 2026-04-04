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

    // Train and get champion
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
    const { MODEL_REGISTRY } = await import("@/lib/models/trainer");
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

    const response: PredictionResponse = {
      version: 1,
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
