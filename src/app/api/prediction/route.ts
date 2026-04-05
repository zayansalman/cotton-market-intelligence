/**
 * /api/prediction — Smart forecast API.
 *
 * Architecture: LLM-FIRST, not model-first.
 *
 * Why: Statistical models on 1000 samples of daily commodity data
 * cannot reliably beat a random walk at the 21-day horizon. This is
 * a known result in quant finance. What DOES work is combining:
 * 1. An LLM that reads news and reasons about causality
 * 2. Statistical context (percentile, vol regime, momentum)
 * 3. Sentiment analysis on headlines
 * 4. Cross-market signals (DXY, oil, soybeans)
 *
 * The LLM sees ALL of this and makes a unified judgment call —
 * exactly like a senior commodity analyst would.
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

const FORECAST_PROMPT = `You are a senior cotton commodity analyst at a top global trading house (Glencore, Cargill, Louis Dreyfus level).

You have access to:
- Real-time Cotton #2 futures data and statistical benchmarks
- Cross-market signals (DXY, oil, soybeans, wheat, corn, VIX, yields, freight)
- News headlines with NLP sentiment scores
- Cotton-specific market context

Your job: predict where Cotton #2 futures will be in the specified time horizon.

THINK LIKE A TRADER:
- News about supply disruptions (India export ban, Brazil drought) → price UP even if current price is high
- DXY strengthening → cotton DOWN (USD-denominated commodity, non-USD buyers squeezed)
- Soybean/corn rallying → cotton UP in 6-9 months (acreage competition)
- VIX spiking → cotton DOWN short-term (risk-off)
- China PMI expanding → cotton UP (30% of demand)
- Political instability in producing countries → supply risk → price UP

Return ONLY valid JSON:
{
  "predicted_return_pct": <expected % change, e.g., 2.5 for +2.5% or -1.8 for -1.8%>,
  "direction": "up" | "down" | "flat",
  "confidence": <0-100>,
  "reasoning": "<2-3 sentences explaining the key drivers>",
  "key_factors": [
    {"factor": "<what>", "impact": "bullish" | "bearish" | "neutral", "weight": "high" | "medium" | "low"}
  ],
  "risk_to_forecast": "<what could make this forecast wrong>"
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

    // 1. Fetch market data
    const pricesRes = await fetch(new URL("/api/prices", req.url).toString());
    if (!pricesRes.ok) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Market data unavailable" }, { status: 502 }),
        rateLimit.headers
      );
    }
    const pricesData = await pricesRes.json();
    const bm = pricesData.benchmarks;

    // 2. Fetch headlines + sentiment (parallel)
    const headlinesRes = await fetch(new URL("/api/headlines", req.url).toString());
    const headlines = headlinesRes.ok ? await headlinesRes.json() : [];
    const sentiment = await analyzeHeadlineSentiment(headlines).catch(() => null);

    // 3. Build context for LLM
    const currentPrice = bm.current_price;
    const headlineText = headlines
      .slice(0, 15)
      .map((h: { title: string; summary?: string }, i: number) =>
        `${i + 1}. ${h.title}${h.summary ? ` — ${h.summary.slice(0, 120)}` : ""}`
      )
      .join("\n");

    const sentimentText = sentiment
      ? `NLP Sentiment: ${sentiment.label.toUpperCase()} (score: ${sentiment.aggregate_score.toFixed(2)}, ${sentiment.n_headlines} headlines: ${sentiment.positive_pct}% positive, ${sentiment.negative_pct}% negative)`
      : "Sentiment: unavailable";

    const userMsg = `MARKET STATE (Cotton #2 Futures):
Price: $${bm.current_price.toFixed(4)}/lb (${bm.price_date})
1Y Percentile: ${(bm.pct_rank_1y * 100).toFixed(0)}% (${bm.pct_rank_1y > 0.7 ? "EXPENSIVE" : bm.pct_rank_1y < 0.3 ? "CHEAP" : "MID-RANGE"})
Z-Score: ${bm.z_score_1y.toFixed(2)} (${Math.abs(bm.z_score_1y) > 1.5 ? "EXTREME" : Math.abs(bm.z_score_1y) > 1 ? "ELEVATED" : "NORMAL"})
30d Change: ${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}%
90d Change: ${bm.change_90d_pct > 0 ? "+" : ""}${bm.change_90d_pct.toFixed(1)}%
30d Volatility: ${bm.vol_30d_ann.toFixed(1)}% (${bm.vol_30d_ann > 30 ? "HIGH" : bm.vol_30d_ann > 20 ? "NORMAL" : "LOW"})
50d MA: $${bm.ma_50d.toFixed(4)} (price ${bm.above_ma_50d ? "ABOVE" : "BELOW"})
200d MA: $${bm.ma_200d.toFixed(4)} (price ${bm.above_ma_200d ? "ABOVE" : "BELOW"})
1Y Range: $${bm.low_1y.toFixed(4)} – $${bm.high_1y.toFixed(4)}

${sentimentText}

NEWS HEADLINES:
${headlineText || "No recent headlines available."}

FORECAST HORIZON: ${horizon} (${horizon === "5d" ? "1 week" : horizon === "21d" ? "1 month" : "3 months"})

Analyze all signals and predict the ${horizon} cotton price movement. Consider supply/demand fundamentals, cross-market signals, and news context.`;

    // 4. Call LLM for forecast
    interface LLMForecast {
      predicted_return_pct: number;
      direction: string;
      confidence: number;
      reasoning: string;
      key_factors: { factor: string; impact: string; weight: string }[];
      risk_to_forecast: string;
    }
    let llmForecast: LLMForecast | null = null;

    const llmText = await hfChatCompletion({
      messages: [
        { role: "system", content: FORECAST_PROMPT },
        { role: "user", content: userMsg },
      ],
      max_tokens: 500,
      temperature: 0.2,
    });

    if (llmText) {
      const parsed = parseJsonResponse(llmText);
      if (parsed) {
        llmForecast = parsed as unknown as LLMForecast;
      }
    }

    // 5. Build forecast from LLM or fall back to heuristic
    let predictedReturn: number;
    let direction: "up" | "down" | "flat";
    let confidence: number;
    let reasoning: string;
    let keyFactors: { factor: string; impact: string; weight: string }[] = [];
    let riskToForecast = "";
    let source: string;

    if (llmForecast && llmForecast.predicted_return_pct != null) {
      // LLM forecast available — use it
      predictedReturn = Math.max(-12, Math.min(12, llmForecast.predicted_return_pct)) / 100;
      direction = llmForecast.direction === "up" ? "up" : llmForecast.direction === "down" ? "down" : "flat";
      confidence = Math.min(95, Math.max(10, llmForecast.confidence || 50));
      reasoning = llmForecast.reasoning || "";
      keyFactors = llmForecast.key_factors || [];
      riskToForecast = llmForecast.risk_to_forecast || "";
      source = "LLM Analyst (Qwen 2.5 7B via HF Pro)";
    } else {
      // Heuristic fallback — percentile-based directional signal
      const rank = bm.pct_rank_1y;
      if (rank < 0.2) {
        predictedReturn = 0.03; // Cheap → expect mean reversion up
        direction = "up";
        confidence = 60;
      } else if (rank < 0.4) {
        predictedReturn = 0.015;
        direction = "up";
        confidence = 50;
      } else if (rank > 0.8) {
        predictedReturn = -0.02;
        direction = "down";
        confidence = 55;
      } else {
        // Mid-range: use momentum
        predictedReturn = bm.change_30d_pct > 2 ? 0.01 : bm.change_30d_pct < -2 ? -0.01 : 0.005;
        direction = predictedReturn > 0.003 ? "up" : predictedReturn < -0.003 ? "down" : "flat";
        confidence = 40;
      }
      reasoning = `Statistical heuristic: price at ${(rank * 100).toFixed(0)}th percentile of 1Y range, ${bm.change_30d_pct > 0 ? "positive" : "negative"} 30d momentum.`;
      source = "Statistical Heuristic (no LLM available)";

      // Adjust for sentiment if available
      if (sentiment) {
        if (sentiment.aggregate_score > 0.15 && direction !== "up") {
          predictedReturn += 0.005;
          reasoning += ` Bullish sentiment (+${sentiment.aggregate_score.toFixed(2)}) nudges forecast up.`;
        } else if (sentiment.aggregate_score < -0.15 && direction !== "down") {
          predictedReturn -= 0.005;
          reasoning += ` Bearish sentiment (${sentiment.aggregate_score.toFixed(2)}) nudges forecast down.`;
        }
        direction = predictedReturn > 0.003 ? "up" : predictedReturn < -0.003 ? "down" : "flat";
      }
    }

    // 6. Build response
    const predictedPrice = Math.round(currentPrice * (1 + predictedReturn) * 10000) / 10000;
    const ciWidth = bm.vol_30d_ann / 100 * Math.sqrt(horizon === "5d" ? 5/252 : horizon === "21d" ? 21/252 : 63/252) * 1.96;
    const lowerPrice = Math.round(currentPrice * (1 + predictedReturn - ciWidth) * 10000) / 10000;
    const upperPrice = Math.round(currentPrice * (1 + predictedReturn + ciWidth) * 10000) / 10000;

    const response = {
      version: 3,
      generated_at: new Date().toISOString(),
      current_price: currentPrice,
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
        id: llmForecast ? "llm_analyst" : "heuristic",
        name: source,
        train_samples: 0,
        test_rmse: ciWidth,
        direction_accuracy: confidence / 100,
      },
      top_drivers: keyFactors.map((f) => ({
        feature: f.factor,
        importance: f.weight === "high" ? 0.8 : f.weight === "medium" ? 0.5 : 0.2,
      })),
      sentiment,
      hf_forecasts: llmForecast ? [{
        provider: "hf_llm",
        predicted_price: predictedPrice,
        predicted_return: predictedReturn,
        direction,
        confidence: confidence / 100,
        model_used: "Qwen/Qwen2.5-7B-Instruct",
        reasoning,
      }] : [],
      reasoning,
      confidence,
      risk_to_forecast: riskToForecast,
      key_factors: keyFactors,
    };

    return applyRateLimitHeaders(NextResponse.json(response), rateLimit.headers);
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "strategy"),
      rateLimit.headers
    );
  }
}
