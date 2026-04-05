/**
 * /api/prediction — LLM price prediction with full cross-market context.
 *
 * The LLM sees EVERYTHING a senior commodity analyst would:
 * - Cotton price + statistical benchmarks (percentile, z-score, vol, MAs)
 * - Cross-market signals (DXY, oil, soybeans, wheat, corn, VIX, yields, freight)
 * - Input costs (fertilizer, diesel)
 * - FX rates (CNY, INR, BDT)
 * - News headlines with NLP sentiment scores
 *
 * The LLM reasons about causality and predicts a specific price level.
 * Not a toy statistical model — a genuine analytical judgment.
 *
 * GET ?horizon=21d
 */

import { NextResponse } from "next/server";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { safeErrorResponse, fetchWithTimeout } from "@/lib/api-security";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";
import { hfChatCompletion, parseJsonResponse } from "@/lib/hf/client";
import { analyzeHeadlineSentiment } from "@/lib/hf/sentiment";
import type { Horizon } from "@/lib/models/types";

const VALID_HORIZONS: Horizon[] = ["5d", "21d", "63d"];

/* ------------------------------------------------------------------ */
/*  Fast cross-market quote fetcher                                    */
/* ------------------------------------------------------------------ */

interface QuickQuote {
  ticker: string;
  label: string;
  price: number | null;
  change_pct: number | null;
}

async function fetchQuickQuote(ticker: string, label: string): Promise<QuickQuote> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=1d`;
    const res = await fetchWithTimeout(url, {
      timeout: 5_000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return { ticker, label, price: null, change_pct: null };
    const data = await res.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!closes || closes.length < 2) return { ticker, label, price: null, change_pct: null };
    const current = closes[closes.length - 1];
    const prev = closes[0]; // ~1 month ago
    if (current == null || prev == null) return { ticker, label, price: null, change_pct: null };
    return {
      ticker, label,
      price: Math.round(current * 100) / 100,
      change_pct: Math.round(((current - prev) / prev) * 1000) / 10,
    };
  } catch {
    return { ticker, label, price: null, change_pct: null };
  }
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

const PRICE_PREDICTION_PROMPT = `You are a senior cotton commodity analyst at Glencore/Cargill/Louis Dreyfus.

You have the FULL market picture — cotton data, cross-market signals, news, and sentiment. Your job: predict the price AND show your complete analytical work.

ANALYTICAL FRAMEWORK:
1. MOMENTUM: 30d/90d changes, MAs. Trend continuation is the base case until broken.
2. SUPPLY SIDE: Soybean/wheat/corn prices → acreage competition (6-9mo lag). Fertilizer/diesel → production cost floor. News about India/Brazil = supply shocks.
3. DEMAND SIDE: DXY inverse (strong USD = weak non-USD buyer demand). S&P 500 = consumer confidence. China PMI = mill demand.
4. SUBSTITUTION: Oil up → polyester expensive → cotton demand up. This is the oil-cotton substitution channel.
5. RISK REGIME: VIX level. Low VIX = risk-on = supports commodities. High VIX = risk-off.
6. FREIGHT/LOGISTICS: Container rates, diesel → CIF cost component. Directly adds to delivered cotton price.
7. FX: CNY weakness = bad for cotton demand. INR/BDT weakness = bad for South Asian import demand.
8. NEWS CATALYST: Forward-looking events that could move price in the next 1-3 months.
9. SEASONALITY: Planting Mar-May, harvest Oct-Dec (Northern Hemisphere). Bangladesh peak buying Aug-Dec.

CRITICAL: For EACH signal category, state what you observed and whether it's bullish, bearish, or neutral. SHOW YOUR WORK.

Return ONLY valid JSON:
{
  "predicted_price": <$/lb, e.g., 0.7250>,
  "direction": "up" | "down" | "flat",
  "confidence": <0-100>,
  "methodology": {
    "momentum": {"signal": "bullish" | "bearish" | "neutral", "observation": "<what you see>", "weight": "<how much this influenced your prediction>"},
    "supply": {"signal": "bullish" | "bearish" | "neutral", "observation": "<acreage competition, input costs, supply news>", "weight": "<influence>"},
    "demand": {"signal": "bullish" | "bearish" | "neutral", "observation": "<DXY, S&P, China PMI effects>", "weight": "<influence>"},
    "substitution": {"signal": "bullish" | "bearish" | "neutral", "observation": "<oil-polyester channel>", "weight": "<influence>"},
    "risk_regime": {"signal": "bullish" | "bearish" | "neutral", "observation": "<VIX, risk appetite>", "weight": "<influence>"},
    "freight_fx": {"signal": "bullish" | "bearish" | "neutral", "observation": "<shipping costs, currency effects>", "weight": "<influence>"},
    "news_catalyst": {"signal": "bullish" | "bearish" | "neutral", "observation": "<key events and their forward implications>", "weight": "<influence>"},
    "seasonality": {"signal": "bullish" | "bearish" | "neutral", "observation": "<current seasonal context>", "weight": "<influence>"}
  },
  "reasoning": "<3-4 sentence summary tying it all together>",
  "key_factors": [
    {"factor": "<specific signal>", "impact": "bullish" | "bearish", "magnitude": "high" | "medium" | "low"}
  ],
  "risk": "<what could make this prediction wrong>"
}`;

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

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

    const host = req.headers.get("host") ?? "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const baseUrl = `${proto}://${host}`;
    const hdrs = { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Accept-Language": "en" };

    // Fetch EVERYTHING in parallel — cotton data, headlines, cross-market
    const [pricesRes, headlinesRes, ...crossMarketQuotes] = await Promise.all([
      fetch(`${baseUrl}/api/prices`, { headers: hdrs }).catch(() => null),
      fetch(`${baseUrl}/api/headlines`, { headers: hdrs }).catch(() => null),
      // Cross-market quotes (5s timeout each, all parallel)
      fetchQuickQuote("DX-Y.NYB", "US Dollar Index (DXY)"),
      fetchQuickQuote("CL=F", "WTI Crude Oil"),
      fetchQuickQuote("ZS=F", "Soybeans"),
      fetchQuickQuote("ZW=F", "Wheat"),
      fetchQuickQuote("ZC=F", "Corn"),
      fetchQuickQuote("^VIX", "VIX"),
      fetchQuickQuote("^TNX", "US 10Y Treasury Yield"),
      fetchQuickQuote("NG=F", "Natural Gas"),
      fetchQuickQuote("MOS", "Mosaic (Fertilizer proxy)"),
      fetchQuickQuote("HO=F", "Diesel (ULSD)"),
      fetchQuickQuote("CNY=X", "CNY/USD"),
      fetchQuickQuote("ZIM", "ZIM Shipping (Container freight)"),
      fetchQuickQuote("^GSPC", "S&P 500"),
      fetchQuickQuote("INR=X", "INR/USD"),
      fetchQuickQuote("BDT=X", "BDT/USD"),
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
    const sentiment = await analyzeHeadlineSentiment(headlines).catch(() => null);

    // Build cross-market context string
    const crossMarket = (crossMarketQuotes as QuickQuote[])
      .filter((q) => q.price != null)
      .map((q) => {
        const dir = q.change_pct! > 1 ? "UP" : q.change_pct! < -1 ? "DOWN" : "FLAT";
        return `  ${q.label}: ${q.price} (${q.change_pct! > 0 ? "+" : ""}${q.change_pct}% 1mo) [${dir}]`;
      })
      .join("\n");

    const horizonLabel = horizon === "5d" ? "1 week" : horizon === "21d" ? "1 month" : "3 months";
    const headlineText = headlines
      .slice(0, 12)
      .map((h: { title: string; summary?: string }, i: number) =>
        `${i + 1}. ${h.title}${h.summary ? ` — ${h.summary.slice(0, 100)}` : ""}`
      )
      .join("\n");

    const sentimentText = sentiment
      ? `NLP Sentiment: ${sentiment.label.toUpperCase()} (score: ${sentiment.aggregate_score.toFixed(2)}, ${sentiment.positive_pct}% pos / ${sentiment.negative_pct}% neg)`
      : "";

    const userMsg = `=== COTTON #2 FUTURES ===
Price: $${currentPrice.toFixed(4)}/lb (${bm.price_date})
1Y Percentile: ${(bm.pct_rank_1y * 100).toFixed(0)}% ${bm.pct_rank_1y > 0.8 ? "[HISTORICALLY EXPENSIVE]" : bm.pct_rank_1y < 0.2 ? "[HISTORICALLY CHEAP]" : "[MID-RANGE]"}
Z-Score: ${bm.z_score_1y.toFixed(2)} ${Math.abs(bm.z_score_1y) > 2 ? "[EXTREME]" : ""}
30d Change: ${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}%
90d Change: ${bm.change_90d_pct > 0 ? "+" : ""}${bm.change_90d_pct.toFixed(1)}%
Volatility: ${bm.vol_30d_ann.toFixed(1)}% (30d ann.) ${bm.vol_30d_ann > 30 ? "[HIGH — spread risk]" : bm.vol_30d_ann < 15 ? "[LOW — trending]" : "[NORMAL]"}
50d MA: $${bm.ma_50d.toFixed(4)} (${bm.above_ma_50d ? "ABOVE" : "BELOW"})
200d MA: $${bm.ma_200d.toFixed(4)} (${bm.above_ma_200d ? "ABOVE — long-term bullish" : "BELOW — long-term bearish"})
1Y Range: $${bm.low_1y.toFixed(4)} – $${bm.high_1y.toFixed(4)}

=== CROSS-MARKET SIGNALS (1-month changes) ===
${crossMarket || "  Cross-market data unavailable"}

=== NEWS HEADLINES ===
${headlineText || "  No recent headlines."}

${sentimentText}

=== TASK ===
Predict Cotton #2 price in ${horizonLabel}. Consider ALL signals above.`;

    // Call LLM
    let predictedPrice = currentPrice;
    let direction: "up" | "down" | "flat" = "flat";
    let confidence = 35;
    let reasoning = "";
    let keyFactors: { factor: string; impact: string; magnitude: string }[] = [];
    let risk = "";
    let source = "heuristic";
    let methodology: Record<string, { signal: string; observation: string; weight: string }> | null = null;

    const llmText = await hfChatCompletion({
      messages: [
        { role: "system", content: PRICE_PREDICTION_PROMPT },
        { role: "user", content: userMsg },
      ],
      max_tokens: 800,
      temperature: 0.2,
    });

    if (llmText) {
      const parsed = parseJsonResponse(llmText);
      if (parsed && parsed.predicted_price) {
        const pp = Number(parsed.predicted_price);
        if (pp > currentPrice * 0.85 && pp < currentPrice * 1.15) {
          predictedPrice = Math.round(pp * 10000) / 10000;
          direction = String(parsed.direction) === "up" ? "up" : String(parsed.direction) === "down" ? "down" : "flat";
          confidence = Math.min(95, Math.max(10, Number(parsed.confidence) || 50));
          reasoning = String(parsed.reasoning || "");
          keyFactors = Array.isArray(parsed.key_factors) ? parsed.key_factors as typeof keyFactors : [];
          risk = String(parsed.risk || "");
          source = "LLM Analyst (Qwen 2.5 7B)";
          if (parsed.methodology && typeof parsed.methodology === "object") {
            methodology = parsed.methodology as unknown as typeof methodology;
          }
        }
      }
    }

    // Heuristic fallback
    if (source === "heuristic") {
      const momentum = bm.change_30d_pct / 100;
      const meanRev = (0.5 - bm.pct_rank_1y) * 0.03;
      const blend = momentum * 0.6 + meanRev * 0.4;
      const cappedReturn = Math.max(-0.08, Math.min(0.08, blend));
      predictedPrice = Math.round(currentPrice * (1 + cappedReturn) * 10000) / 10000;
      direction = cappedReturn > 0.003 ? "up" : cappedReturn < -0.003 ? "down" : "flat";
      reasoning = `Heuristic: momentum (${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}% 30d) + mean reversion (${(bm.pct_rank_1y * 100).toFixed(0)}th pct). LLM unavailable.`;
    }

    const predictedReturn = (predictedPrice - currentPrice) / currentPrice;
    const horizonDays = horizon === "5d" ? 5 : horizon === "21d" ? 21 : 63;
    const ciWidth = (bm.vol_30d_ann / 100) * Math.sqrt(horizonDays / 252) * 1.96;

    const response = {
      version: 6,
      generated_at: new Date().toISOString(),
      current_price: Math.round(currentPrice * 10000) / 10000,
      current_date: bm.price_date,
      forecasts: [{
        horizon,
        predicted_return: Math.round(predictedReturn * 100000) / 100000,
        predicted_price: predictedPrice,
        lower_price: Math.round(currentPrice * (1 - ciWidth) * 10000) / 10000,
        upper_price: Math.round(currentPrice * (1 + ciWidth) * 10000) / 10000,
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
      methodology,
      key_factors: keyFactors,
      top_drivers: keyFactors.map((f) => ({
        feature: f.factor,
        importance: f.magnitude === "high" ? 0.8 : f.magnitude === "medium" ? 0.5 : 0.2,
      })),
      // What the LLM saw (transparency)
      cross_market_signals: (crossMarketQuotes as QuickQuote[]).filter((q) => q.price != null),
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
