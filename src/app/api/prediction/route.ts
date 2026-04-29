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
import { getSupabase, addBusinessDays } from "@/lib/supabase";
import type { Horizon } from "@/lib/models/types";
import { runPipeline, alignToDaily } from "@/lib/pipeline/runner";
import { buildFeatures, type FeatureRow } from "@/lib/pipeline/features";
import {
  trainAndEvaluate,
  predictChampion,
  type TrainResult,
} from "@/lib/models/trainer";
import type { Benchmarks } from "@/lib/types";

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

interface PredictionDriver {
  feature: string;
  importance: number;
}

interface ModelStackForecast {
  predicted_price: number;
  predicted_return: number;
  lower_price: number;
  upper_price: number;
  direction: "up" | "down" | "flat";
  confidence: number;
  reasoning: string;
  risk: string;
  model: {
    id: string;
    name: string;
    train_samples: number;
    test_samples: number;
    test_mae: number;
    test_rmse: number;
    direction_accuracy: number;
  };
  top_drivers: PredictionDriver[];
}

interface LlmForecast {
  predicted_price: number;
  predicted_return: number;
  direction: "up" | "down" | "flat";
  confidence: number;
  reasoning: string;
  risk: string;
  methodology: Record<string, { signal: string; observation: string; weight: string }> | null;
  key_factors: { factor: string; impact: string; magnitude: string }[];
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

function horizonDaysFor(horizon: Horizon): number {
  return horizon === "5d" ? 5 : horizon === "21d" ? 21 : 63;
}

function directionFromReturn(value: number): "up" | "down" | "flat" {
  if (value > 0.003) return "up";
  if (value < -0.003) return "down";
  return "flat";
}

function isPlausiblePrice(price: number, currentPrice: number): boolean {
  return (
    Number.isFinite(price) &&
    price > currentPrice * 0.85 &&
    price < currentPrice * 1.15
  );
}

function latestUsableRow(rows: FeatureRow[]): FeatureRow | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const finiteFeatures = Object.values(row.features).filter(
      (value) => value != null && Number.isFinite(value)
    ).length;
    if (finiteFeatures >= 10) return row;
  }
  return null;
}

function buildModelDrivers(
  row: FeatureRow,
  result: TrainResult
): PredictionDriver[] {
  const state = result.champion.state as Record<string, unknown>;
  const selected = Array.isArray(state.selected_features)
    ? (state.selected_features as number[])
    : [];

  const selectedDrivers = selected
    .slice(0, 6)
    .map((idx, rank) => ({
      feature: result.featureNames[idx],
      importance: Math.round((0.9 - rank * 0.1) * 100) / 100,
    }))
    .filter((driver) => Boolean(driver.feature));

  if (selectedDrivers.length > 0) return selectedDrivers;

  const preferred = [
    "cotton_ret_21d",
    "pct_rank_252d",
    "trend_regime",
    "cotton_vol_21d",
    "rsi_14",
    "ma_cross_50_200",
    "dxy_ret_21d",
    "oil_ret_21d",
    "vix_level",
  ];

  return preferred
    .filter((name) => {
      const value = row.features[name];
      return value != null && Number.isFinite(value);
    })
    .slice(0, 6)
    .map((feature, idx) => ({
      feature,
      importance: Math.round((0.75 - idx * 0.08) * 100) / 100,
    }));
}

async function runModelStackForecast(
  horizon: Horizon,
  currentPrice: number,
  benchmarks: Benchmarks
): Promise<ModelStackForecast | null> {
  const pipeline = await runPipeline();
  const dates = pipeline.target.map((point) => point.date);
  if (dates.length < 320) return null;

  const aligned = alignToDaily(pipeline.factors, dates);
  const rows = buildFeatures(dates, aligned);
  if (rows.length < 320) return null;

  const trainResult = trainAndEvaluate(rows, horizon);
  const row = latestUsableRow(rows);
  if (!row) return null;

  const prediction = predictChampion(trainResult, row);
  if (!prediction || !isPlausiblePrice(prediction.value, currentPrice)) {
    return null;
  }

  const predictedPrice = Math.round(prediction.value * 10000) / 10000;
  const predictedReturn = (predictedPrice - currentPrice) / currentPrice;
  const horizonDays = horizonDaysFor(horizon);
  const realizedVolInterval =
    currentPrice *
    (benchmarks.vol_30d_ann / 100) *
    Math.sqrt(horizonDays / 252) *
    1.96;
  const modelInterval = Math.max(
    trainResult.champion.rmse * 1.96,
    realizedVolInterval,
    currentPrice * 0.005
  );

  const confidence = Math.round(
    Math.min(
      95,
      Math.max(35, trainResult.champion.direction_accuracy * 100)
    )
  );

  return {
    predicted_price: predictedPrice,
    predicted_return: Math.round(predictedReturn * 100000) / 100000,
    lower_price:
      Math.round(Math.max(0.01, predictedPrice - modelInterval) * 10000) /
      10000,
    upper_price: Math.round((predictedPrice + modelInterval) * 10000) / 10000,
    direction: directionFromReturn(predictedReturn),
    confidence,
    reasoning:
      `${trainResult.champion.model_name} was selected from ${trainResult.results.length} local models ` +
      `using a held-out train/test split. It predicts $${predictedPrice.toFixed(4)}/lb for the ${horizon} horizon ` +
      `with ${(trainResult.champion.direction_accuracy * 100).toFixed(1)}% test directional accuracy.`,
    risk:
      "Model forecast uses historical market relationships; sudden weather, policy, or geopolitical shocks can invalidate those relationships.",
    model: {
      id: trainResult.champion.model_id,
      name: trainResult.champion.model_name,
      train_samples: trainResult.champion.n_train,
      test_samples: trainResult.champion.n_test,
      test_mae: trainResult.champion.mae,
      test_rmse: trainResult.champion.rmse,
      direction_accuracy: trainResult.champion.direction_accuracy,
    },
    top_drivers: buildModelDrivers(row, trainResult),
  };
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

    const [modelStackForecast, llmText] = await Promise.all([
      runModelStackForecast(horizon, currentPrice, bm).catch(() => null),
      hfChatCompletion({
        messages: [
          { role: "system", content: PRICE_PREDICTION_PROMPT },
          { role: "user", content: userMsg },
        ],
        max_tokens: 800,
        temperature: 0.2,
      }).catch(() => null),
    ]);

    let llmForecast: LlmForecast | null = null;
    if (llmText) {
      const parsed = parseJsonResponse(llmText);
      if (parsed && parsed.predicted_price) {
        const pp = Number(parsed.predicted_price);
        if (isPlausiblePrice(pp, currentPrice)) {
          const predictedPrice = Math.round(pp * 10000) / 10000;
          const predictedReturn = (predictedPrice - currentPrice) / currentPrice;
          llmForecast = {
            predicted_price: predictedPrice,
            predicted_return: Math.round(predictedReturn * 100000) / 100000,
            direction:
              String(parsed.direction) === "up"
                ? "up"
                : String(parsed.direction) === "down"
                  ? "down"
                  : "flat",
            confidence: Math.min(95, Math.max(10, Number(parsed.confidence) || 50)),
            reasoning: String(parsed.reasoning || ""),
            key_factors: Array.isArray(parsed.key_factors)
              ? parsed.key_factors as LlmForecast["key_factors"]
              : [],
            risk: String(parsed.risk || ""),
            methodology:
              parsed.methodology && typeof parsed.methodology === "object"
                ? parsed.methodology as LlmForecast["methodology"]
                : null,
          };
        }
      }
    }

    let predictedPrice: number;
    let predictedReturn: number;
    let direction: "up" | "down" | "flat";
    let confidence: number;
    let reasoning: string;
    let risk: string;
    let methodology: LlmForecast["methodology"] = llmForecast?.methodology ?? null;
    let keyFactors: LlmForecast["key_factors"] = [];
    let topDrivers: PredictionDriver[] = [];
    let model = modelStackForecast?.model ?? null;
    let lowerPrice: number;
    let upperPrice: number;

    if (modelStackForecast) {
      predictedPrice = modelStackForecast.predicted_price;
      predictedReturn = modelStackForecast.predicted_return;
      direction = modelStackForecast.direction;
      confidence = modelStackForecast.confidence;
      reasoning = modelStackForecast.reasoning;
      risk = llmForecast?.risk || modelStackForecast.risk;
      topDrivers = modelStackForecast.top_drivers;
      keyFactors = topDrivers.map((driver) => ({
        factor: driver.feature,
        impact: direction === "down" ? "bearish" : "bullish",
        magnitude:
          driver.importance >= 0.7
            ? "high"
            : driver.importance >= 0.45
              ? "medium"
              : "low",
      }));
      lowerPrice = modelStackForecast.lower_price;
      upperPrice = modelStackForecast.upper_price;
    } else if (llmForecast) {
      predictedPrice = llmForecast.predicted_price;
      predictedReturn = llmForecast.predicted_return;
      direction = llmForecast.direction;
      confidence = llmForecast.confidence;
      reasoning = llmForecast.reasoning;
      risk = llmForecast.risk;
      keyFactors = llmForecast.key_factors;
      const source = "LLM Analyst (Qwen 2.5 7B)";
      const horizonDays = horizonDaysFor(horizon);
      const ciWidth = (bm.vol_30d_ann / 100) * Math.sqrt(horizonDays / 252) * 1.96;
      lowerPrice = Math.round(currentPrice * (1 - ciWidth) * 10000) / 10000;
      upperPrice = Math.round(currentPrice * (1 + ciWidth) * 10000) / 10000;
      model = {
        id: "llm_analyst",
        name: source,
        train_samples: 0,
        test_samples: 0,
        test_mae: 0,
        test_rmse: ciWidth,
        direction_accuracy: confidence / 100,
      };
    } else {
      const momentum = bm.change_30d_pct / 100;
      const meanRev = (0.5 - bm.pct_rank_1y) * 0.03;
      const blend = momentum * 0.6 + meanRev * 0.4;
      const cappedReturn = Math.max(-0.08, Math.min(0.08, blend));
      predictedPrice = Math.round(currentPrice * (1 + cappedReturn) * 10000) / 10000;
      direction = cappedReturn > 0.003 ? "up" : cappedReturn < -0.003 ? "down" : "flat";
      predictedReturn = (predictedPrice - currentPrice) / currentPrice;
      confidence = 35;
      reasoning = `Heuristic: momentum (${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}% 30d) + mean reversion (${(bm.pct_rank_1y * 100).toFixed(0)}th pct). LLM unavailable.`;
      risk = "Heuristic forecast only; model stack and LLM analyst were unavailable.";
      const horizonDays = horizonDaysFor(horizon);
      const ciWidth = (bm.vol_30d_ann / 100) * Math.sqrt(horizonDays / 252) * 1.96;
      lowerPrice = Math.round(currentPrice * (1 - ciWidth) * 10000) / 10000;
      upperPrice = Math.round(currentPrice * (1 + ciWidth) * 10000) / 10000;
      model = {
        id: "heuristic",
        name: "Heuristic fallback",
        train_samples: 0,
        test_samples: 0,
        test_mae: 0,
        test_rmse: ciWidth,
        direction_accuracy: confidence / 100,
      };
    }

    const responseModel = model ?? {
      id: "heuristic",
      name: "Heuristic fallback",
      train_samples: 0,
      test_samples: 0,
      test_mae: 0,
      test_rmse: 0,
      direction_accuracy: confidence / 100,
    };

    if (topDrivers.length === 0) {
      topDrivers = keyFactors.map((f) => ({
        feature: f.factor,
        importance: f.magnitude === "high" ? 0.8 : f.magnitude === "medium" ? 0.5 : 0.2,
      }));
    }

    const horizonDays = horizonDaysFor(horizon);

    const response = {
      version: 6,
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
      model: responseModel,
      reasoning,
      confidence,
      risk,
      methodology,
      key_factors: keyFactors,
      top_drivers: topDrivers,
      // What the LLM saw (transparency)
      cross_market_signals: (crossMarketQuotes as QuickQuote[]).filter((q) => q.price != null),
      sentiment,
      hf_forecasts: llmForecast ? [{
        provider: "hf_llm",
        predicted_price: llmForecast.predicted_price,
        predicted_return: llmForecast.predicted_return,
        direction: llmForecast.direction,
        confidence: llmForecast.confidence / 100,
        model_used: "Qwen/Qwen2.5-7B-Instruct",
        reasoning: llmForecast.reasoning,
      }] : [],
    };

    // Fire-and-forget: persist prediction to Supabase for accuracy tracking
    const supabase = getSupabase();
    if (supabase) {
      const forecast = response.forecasts[0];
      const targetDate = addBusinessDays(response.current_date, horizonDays);
      Promise.resolve().then(async () => {
        try {
          await supabase.from("predictions").upsert(
            {
              current_date: response.current_date,
              current_price: response.current_price,
              horizon: forecast.horizon,
              target_date: targetDate,
              predicted_price: forecast.predicted_price,
              lower_price: forecast.lower_price,
              upper_price: forecast.upper_price,
              direction: forecast.direction,
              confidence: response.confidence,
              model_id: response.model.id,
              model_name: response.model.name,
              reasoning: response.reasoning || null,
            },
            { onConflict: "current_date,horizon,model_id" }
          );
        } catch { /* Supabase write failure must never break predictions */ }
      });
    }

    return applyRateLimitHeaders(NextResponse.json(response), rateLimit.headers);
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "strategy"),
      rateLimit.headers
    );
  }
}
