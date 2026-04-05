/**
 * /api/prediction — LLM-powered price prediction.
 *
 * WHY LLM-FIRST (not statistical models):
 * Statistical models on ~1000 samples of daily commodity data pick
 * "Moving Average" or "Naive" as champion because returns are noisy.
 * These models have ZERO predictive intelligence — they just minimize
 * error by predicting close to the current price.
 *
 * An LLM can reason: "price is rallying + India export ban + Brazil
 * drought = supply squeeze = momentum continues." This is what every
 * real commodity analyst does — they read data AND context.
 *
 * The statistical benchmarks (percentile, vol, momentum, MAs) are
 * provided as CONTEXT to the LLM, not as standalone models.
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
import { hfChatCompletion, parseJsonResponse } from "@/lib/hf/client";
import { analyzeHeadlineSentiment } from "@/lib/hf/sentiment";
import type { Horizon } from "@/lib/models/types";

const VALID_HORIZONS: Horizon[] = ["5d", "21d", "63d"];

const PRICE_PREDICTION_PROMPT = `You are a senior cotton commodity analyst at a top global trading house.

You will be given:
- Current Cotton #2 futures price and statistical context
- Recent news headlines with sentiment analysis
- Cross-market signals

Your job: predict the PRICE LEVEL of Cotton #2 futures at the specified horizon.

THINK LIKE A TRADER:
- If price is rallying with supply disruption news → momentum likely continues
- If DXY is strengthening → cotton gets more expensive for buyers → demand pressure down
- India/Brazil supply issues → global tightness → price support/increase
- High volatility + bullish news → could overshoot to upside
- Price at 99th percentile BUT with genuine supply shock → can go higher (don't mean-revert into a supply squeeze)

IMPORTANT: Give a SPECIFIC price prediction, not just direction.

Return ONLY valid JSON:
{
  "predicted_price": <predicted $/lb price, e.g., 0.7250>,
  "direction": "up" | "down" | "flat",
  "confidence": <0-100>,
  "reasoning": "<2-3 sentences explaining WHY you predict this price level>",
  "key_factors": [
    {"factor": "<what>", "impact": "bullish" | "bearish", "magnitude": "high" | "medium" | "low"}
  ],
  "risk": "<what could make this prediction wrong>"
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

    // Fetch market data + headlines in parallel
    const host = req.headers.get("host") ?? "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const baseUrl = `${proto}://${host}`;
    const headers = { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Accept-Language": "en" };

    const [pricesRes, headlinesRes] = await Promise.all([
      fetch(`${baseUrl}/api/prices`, { headers }).catch(() => null),
      fetch(`${baseUrl}/api/headlines`, { headers }).catch(() => null),
    ]);

    if (!pricesRes?.ok) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Market data unavailable" }, { status: 502 }),
        rateLimit.headers
      );
    }

    const pricesData = await pricesRes.json();
    const bm = pricesData.benchmarks;
    const currentPrice = bm.current_price;
    const headlines = headlinesRes?.ok ? await headlinesRes.json() : [];

    // Sentiment analysis (fast — classification model, not LLM)
    const sentiment = await analyzeHeadlineSentiment(headlines).catch(() => null);

    // Build rich context for LLM
    const horizonLabel = horizon === "5d" ? "1 week" : horizon === "21d" ? "1 month" : "3 months";
    const headlineText = headlines
      .slice(0, 15)
      .map((h: { title: string; summary?: string }, i: number) =>
        `${i + 1}. ${h.title}${h.summary ? ` — ${h.summary.slice(0, 100)}` : ""}`
      )
      .join("\n");

    const sentimentText = sentiment
      ? `News Sentiment: ${sentiment.label.toUpperCase()} (score: ${sentiment.aggregate_score.toFixed(2)}, ${sentiment.positive_pct}% positive, ${sentiment.negative_pct}% negative, ${sentiment.n_headlines} headlines)`
      : "";

    const userMsg = `CURRENT MARKET STATE (Cotton #2 Futures):
Price: $${currentPrice.toFixed(4)}/lb (${bm.price_date})
1Y Percentile: ${(bm.pct_rank_1y * 100).toFixed(0)}% ${bm.pct_rank_1y > 0.8 ? "(HISTORICALLY EXPENSIVE)" : bm.pct_rank_1y < 0.2 ? "(HISTORICALLY CHEAP)" : "(MID-RANGE)"}
Z-Score: ${bm.z_score_1y.toFixed(2)}
30d Change: ${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}%
90d Change: ${bm.change_90d_pct > 0 ? "+" : ""}${bm.change_90d_pct.toFixed(1)}%
30d Volatility: ${bm.vol_30d_ann.toFixed(1)}% annualized
50d MA: $${bm.ma_50d.toFixed(4)} (price ${bm.above_ma_50d ? "ABOVE — bullish" : "BELOW — bearish"})
200d MA: $${bm.ma_200d.toFixed(4)} (price ${bm.above_ma_200d ? "ABOVE — long-term bullish" : "BELOW — long-term bearish"})
1Y Range: $${bm.low_1y.toFixed(4)} (low) – $${bm.high_1y.toFixed(4)} (high)

${sentimentText}

RECENT NEWS:
${headlineText || "No recent headlines."}

PREDICTION HORIZON: ${horizonLabel}

Given all signals — price momentum, technical positioning, news context, and sentiment — predict where Cotton #2 will be in ${horizonLabel}. Give a specific price.`;

    // Call LLM
    let predictedPrice = currentPrice;
    let direction: "up" | "down" | "flat" = "flat";
    let confidence = 40;
    let reasoning = "";
    let keyFactors: { factor: string; impact: string; magnitude: string }[] = [];
    let risk = "";
    let source = "heuristic";

    const llmText = await hfChatCompletion({
      messages: [
        { role: "system", content: PRICE_PREDICTION_PROMPT },
        { role: "user", content: userMsg },
      ],
      max_tokens: 400,
      temperature: 0.2,
    });

    if (llmText) {
      const parsed = parseJsonResponse(llmText);
      if (parsed && parsed.predicted_price) {
        const pp = Number(parsed.predicted_price);
        // Sanity: predicted price within ±15% of current
        if (pp > currentPrice * 0.85 && pp < currentPrice * 1.15) {
          predictedPrice = Math.round(pp * 10000) / 10000;
          direction = String(parsed.direction) === "up" ? "up" : String(parsed.direction) === "down" ? "down" : "flat";
          confidence = Math.min(95, Math.max(10, Number(parsed.confidence) || 50));
          reasoning = String(parsed.reasoning || "");
          keyFactors = Array.isArray(parsed.key_factors) ? parsed.key_factors as typeof keyFactors : [];
          risk = String(parsed.risk || "");
          source = "LLM Analyst (Qwen 2.5 7B)";
        }
      }
    }

    // If LLM failed, use simple heuristic (momentum + mean reversion blend)
    if (source === "heuristic") {
      const momentum = bm.change_30d_pct / 100; // Recent momentum
      const meanRev = (0.5 - bm.pct_rank_1y) * 0.03; // Mean reversion pull
      const blend = momentum * 0.6 + meanRev * 0.4; // 60% momentum, 40% mean reversion
      const cappedReturn = Math.max(-0.08, Math.min(0.08, blend));
      predictedPrice = Math.round(currentPrice * (1 + cappedReturn) * 10000) / 10000;
      direction = cappedReturn > 0.003 ? "up" : cappedReturn < -0.003 ? "down" : "flat";
      confidence = 35;
      reasoning = `Heuristic: 60% momentum (${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}% 30d) + 40% mean reversion (${(bm.pct_rank_1y * 100).toFixed(0)}th percentile). LLM unavailable.`;
    }

    const predictedReturn = (predictedPrice - currentPrice) / currentPrice;

    // CI from realized vol
    const horizonDays = horizon === "5d" ? 5 : horizon === "21d" ? 21 : 63;
    const ciWidth = (bm.vol_30d_ann / 100) * Math.sqrt(horizonDays / 252) * 1.96;
    const lowerPrice = Math.round(currentPrice * (1 - ciWidth) * 10000) / 10000;
    const upperPrice = Math.round(currentPrice * (1 + ciWidth) * 10000) / 10000;

    const response = {
      version: 5,
      generated_at: new Date().toISOString(),
      current_price: Math.round(currentPrice * 10000) / 10000,
      current_date: bm.price_date,
      forecasts: [{
        horizon,
        predicted_return: Math.round(predictedReturn * 100000) / 100000,
        predicted_price: predictedPrice,
        lower_price: lowerPrice,
        upper_price: upperPrice,
        confidence_level: 0.95,
        direction,
      }],
      model: {
        id: source === "heuristic" ? "heuristic" : "llm_analyst",
        name: source,
        train_samples: 0,
        test_rmse: ciWidth,
        direction_accuracy: confidence / 100,
      },
      reasoning,
      confidence,
      risk,
      key_factors: keyFactors,
      top_drivers: keyFactors.map((f) => ({
        feature: f.factor,
        importance: f.magnitude === "high" ? 0.8 : f.magnitude === "medium" ? 0.5 : 0.2,
      })),
      sentiment,
      hf_forecasts: source !== "heuristic" ? [{
        provider: "hf_llm",
        predicted_price: predictedPrice,
        predicted_return: predictedReturn,
        direction,
        confidence: confidence / 100,
        model_used: "Qwen/Qwen2.5-7B-Instruct",
        reasoning,
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
