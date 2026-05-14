/**
 * Framework-neutral market prediction orchestration.
 *
 * Next.js route handlers should stay thin adapters around this service so the
 * forecasting engine can also be reused by jobs, ERP integrations, or tests.
 */

import { hfChatCompletion, parseJsonResponse } from "../hf/client";
import { COTTON_PRICE_PREDICTION_SYSTEM_PROMPT } from "../hf/prompts";
import { analyzeHeadlineSentiment } from "../hf/sentiment";
import type { Horizon } from "../models/types";
import { runPipeline, alignToDaily } from "../pipeline/runner";
import { buildFeatures, type FeatureRow } from "../pipeline/features";
import {
  trainAndEvaluate,
  predictChampion,
  type TrainResult,
} from "../models/trainer";
import { fetchWithTimeout } from "../fetch-with-timeout";
import type { Benchmarks } from "../types";

export const VALID_HORIZONS: Horizon[] = ["5d", "21d", "63d"];

export interface QuickQuote {
  ticker: string;
  label: string;
  price: number | null;
  change_pct: number | null;
}

export interface PredictionHeadline {
  title: string;
  summary?: string;
}

export interface PredictionPriceData {
  benchmarks: Benchmarks;
}

interface PredictionDriver {
  feature: string;
  importance: number;
}

export interface PredictionForecast {
  horizon: Horizon;
  predicted_return: number;
  predicted_price: number;
  lower_price: number;
  upper_price: number;
  confidence_level: number;
  direction: "up" | "down" | "flat";
}

export interface PredictionModelMetadata {
  id: string;
  name: string;
  kind: "llm_synthesis" | "model_stack" | "llm_fallback" | "heuristic_fallback";
  train_samples: number | null;
  test_samples: number | null;
  test_mae: number | null;
  test_rmse: number | null;
  direction_accuracy: number | null;
  validation_note: string;
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
  model: PredictionModelMetadata;
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

interface EvidenceAssessment {
  source: string;
  stance: "support" | "contradict" | "neutral";
  influence: "high" | "medium" | "low";
  rationale: string;
}

interface AnalystSynthesisForecast extends LlmForecast {
  evidence_assessment: EvidenceAssessment[];
}

export interface ForecastEvidence {
  source: string;
  kind: "model_stack" | "heuristic" | "sentiment" | "news_context";
  predicted_price: number | null;
  predicted_return: number | null;
  direction: "up" | "down" | "flat";
  confidence: number | null;
  validation_note: string;
  reasoning: string;
  top_drivers?: PredictionDriver[];
}

interface DeterministicForecast {
  predicted_price: number;
  predicted_return: number;
  lower_price: number;
  upper_price: number;
  direction: "up" | "down" | "flat";
  confidence: number;
  reasoning: string;
  risk: string;
  model: PredictionModelMetadata;
  key_factors: LlmForecast["key_factors"];
  top_drivers: PredictionDriver[];
}

export interface PredictionForecastPoint {
  date: string;
  predicted_price: number;
  lower_price: number;
  upper_price: number;
  horizon: Horizon;
}

type SentimentResult = Awaited<ReturnType<typeof analyzeHeadlineSentiment>>;

export interface PredictionResponse {
  version: number;
  generated_at: string;
  current_price: number;
  current_date: string;
  forecasts: PredictionForecast[];
  model: PredictionModelMetadata;
  reasoning: string;
  confidence: number;
  risk: string;
  methodology: LlmForecast["methodology"];
  key_factors: LlmForecast["key_factors"];
  top_drivers: PredictionDriver[];
  forecast_evidence: ForecastEvidence[];
  evidence_assessment: EvidenceAssessment[];
  cross_market_signals: QuickQuote[];
  sentiment: SentimentResult | null;
  hf_forecasts: [];
}

export interface PredictionCacheWrite {
  response: PredictionResponse;
  forecast: PredictionForecast;
  targetDate: string;
  forecastPoints: PredictionForecastPoint[];
}

export interface PredictionCache {
  read(currentDate: string, horizon: Horizon): Promise<PredictionResponse | null>;
  write(entry: PredictionCacheWrite): Promise<void>;
}

export interface PredictionServiceDependencies {
  fetchPrices: () => Promise<PredictionPriceData | null>;
  fetchHeadlines: () => Promise<PredictionHeadline[]>;
  fetchCrossMarketQuotes?: () => Promise<QuickQuote[]>;
  cache?: PredictionCache | null;
  now?: () => Date;
  completeChat?: typeof hfChatCompletion;
  parseChatJson?: typeof parseJsonResponse;
  analyzeSentiment?: typeof analyzeHeadlineSentiment;
}

export interface GenerateMarketPredictionInput {
  horizon: Horizon;
  deps: PredictionServiceDependencies;
}

export interface GenerateMarketPredictionResult {
  response: PredictionResponse;
  cacheHit: boolean;
}

export class PredictionMarketDataUnavailableError extends Error {
  constructor() {
    super("Market data unavailable");
    this.name = "PredictionMarketDataUnavailableError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isPredictionResponseFor(
  value: unknown,
  currentDate: string,
  horizon: Horizon
): value is PredictionResponse {
  if (!isRecord(value)) return false;
  if (value.current_date !== currentDate) return false;
  if (!Array.isArray(value.forecasts)) return false;
  return value.forecasts.some((forecast) =>
    isRecord(forecast) && forecast.horizon === horizon
  );
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
    const prev = closes[0];
    if (current == null || prev == null) return { ticker, label, price: null, change_pct: null };
    return {
      ticker,
      label,
      price: Math.round(current * 100) / 100,
      change_pct: Math.round(((current - prev) / prev) * 1000) / 10,
    };
  } catch {
    return { ticker, label, price: null, change_pct: null };
  }
}

export function fetchDefaultCrossMarketQuotes(): Promise<QuickQuote[]> {
  return Promise.all([
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
}

function horizonDaysFor(horizon: Horizon): number {
  return horizon === "5d" ? 5 : horizon === "21d" ? 21 : 63;
}

function futureBusinessDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(startDate + "T00:00:00Z");
  while (dates.length < count) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function addBusinessDays(startDate: string, days: number): string {
  const d = new Date(startDate + "T00:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

function buildForecastPoints({
  startDate,
  startPrice,
  predictedPrice,
  lowerPrice,
  upperPrice,
  horizon,
  horizonDays,
}: {
  startDate: string;
  startPrice: number;
  predictedPrice: number;
  lowerPrice: number;
  upperPrice: number;
  horizon: Horizon;
  horizonDays: number;
}): PredictionForecastPoint[] {
  const dates = futureBusinessDates(startDate, horizonDays);
  return [
    {
      date: startDate,
      predicted_price: Math.round(startPrice * 10000) / 10000,
      lower_price: Math.round(startPrice * 10000) / 10000,
      upper_price: Math.round(startPrice * 10000) / 10000,
      horizon,
    },
    ...dates.map((date, index) => {
      const t = (index + 1) / dates.length;
      const eased = 1 - Math.pow(1 - t, 1.5);
      return {
        date,
        predicted_price:
          Math.round((startPrice + (predictedPrice - startPrice) * eased) * 10000) / 10000,
        lower_price:
          Math.round((startPrice + (lowerPrice - startPrice) * eased) * 10000) / 10000,
        upper_price:
          Math.round((startPrice + (upperPrice - startPrice) * eased) * 10000) / 10000,
        horizon,
      };
    }),
  ];
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
      kind: "model_stack",
      train_samples: trainResult.champion.n_train,
      test_samples: trainResult.champion.n_test,
      test_mae: trainResult.champion.mae,
      test_rmse: trainResult.champion.rmse,
      direction_accuracy: trainResult.champion.direction_accuracy,
      validation_note:
        "Held-out train/test metrics from the local TypeScript model stack.",
    },
    top_drivers: buildModelDrivers(row, trainResult),
  };
}

function buildHeuristicForecast(
  horizon: Horizon,
  currentPrice: number,
  benchmarks: Benchmarks
): DeterministicForecast {
  const momentum = benchmarks.change_30d_pct / 100;
  const meanRev = (0.5 - benchmarks.pct_rank_1y) * 0.03;
  const blend = momentum * 0.6 + meanRev * 0.4;
  const cappedReturn = Math.max(-0.08, Math.min(0.08, blend));
  const predictedPrice =
    Math.round(currentPrice * (1 + cappedReturn) * 10000) / 10000;
  const horizonDays = horizonDaysFor(horizon);
  const ciWidth =
    (benchmarks.vol_30d_ann / 100) * Math.sqrt(horizonDays / 252) * 1.96;
  const direction = directionFromReturn(cappedReturn);
  const topDrivers: PredictionDriver[] = [
    { feature: "30d_momentum", importance: 0.7 },
    { feature: "1y_percentile_rank", importance: 0.65 },
    { feature: "z_score_1y", importance: 0.55 },
    { feature: "30d_volatility", importance: 0.45 },
  ];

  return {
    predicted_price: predictedPrice,
    predicted_return: Math.round(cappedReturn * 100000) / 100000,
    lower_price: Math.round(currentPrice * (1 - ciWidth) * 10000) / 10000,
    upper_price: Math.round(currentPrice * (1 + ciWidth) * 10000) / 10000,
    direction,
    confidence: 35,
    reasoning:
      `Heuristic candidate: momentum (${benchmarks.change_30d_pct > 0 ? "+" : ""}${benchmarks.change_30d_pct.toFixed(1)}% 30d) ` +
      `blended with mean reversion (${(benchmarks.pct_rank_1y * 100).toFixed(0)}th pct).`,
    risk:
      "Deterministic heuristic only; it cannot reason about new supply, demand, policy, or weather information.",
    model: {
      id: "heuristic",
      name: "Heuristic fallback",
      kind: "heuristic_fallback",
      train_samples: null,
      test_samples: null,
      test_mae: null,
      test_rmse: null,
      direction_accuracy: null,
      validation_note:
        "Deterministic fallback; confidence is heuristic and not historical model accuracy.",
    },
    key_factors: topDrivers.map((driver) => ({
      factor: driver.feature,
      impact: direction === "down" ? "bearish" : direction === "up" ? "bullish" : "neutral",
      magnitude: driver.importance >= 0.65 ? "high" : "medium",
    })),
    top_drivers: topDrivers,
  };
}

function confidence01(confidence: number | null | undefined): number | null {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  return confidence > 1 ? confidence / 100 : confidence;
}

function buildForecastEvidence(
  modelStackForecast: ModelStackForecast | null,
  heuristicForecast: DeterministicForecast,
  sentiment: SentimentResult | null
): ForecastEvidence[] {
  const evidence: ForecastEvidence[] = [];

  if (modelStackForecast) {
    evidence.push({
      source: `Quant model stack (${modelStackForecast.model.name})`,
      kind: "model_stack",
      predicted_price: modelStackForecast.predicted_price,
      predicted_return: modelStackForecast.predicted_return,
      direction: modelStackForecast.direction,
      confidence: confidence01(modelStackForecast.confidence),
      validation_note: modelStackForecast.model.validation_note,
      reasoning: modelStackForecast.reasoning,
      top_drivers: modelStackForecast.top_drivers,
    });
  }

  evidence.push({
    source: "Statistical heuristic",
    kind: "heuristic",
    predicted_price: heuristicForecast.predicted_price,
    predicted_return: heuristicForecast.predicted_return,
    direction: heuristicForecast.direction,
    confidence: confidence01(heuristicForecast.confidence),
    validation_note: heuristicForecast.model.validation_note,
    reasoning: heuristicForecast.reasoning,
    top_drivers: heuristicForecast.top_drivers,
  });

  if (sentiment) {
    const sentReturn = sentiment.aggregate_score * 0.02;
    evidence.push({
      source: "News sentiment",
      kind: "sentiment",
      predicted_price: null,
      predicted_return: Math.round(sentReturn * 100000) / 100000,
      direction: directionFromReturn(sentReturn),
      confidence: confidence01(sentiment.confidence),
      validation_note:
        "Headline sentiment is qualitative context, not a standalone validated price model.",
      reasoning:
        `${sentiment.label} headline tone across ${sentiment.n_headlines} headlines ` +
        `(score ${sentiment.aggregate_score.toFixed(2)}).`,
    });
  }

  return evidence;
}

function confidenceIntervalForFinalForecast(
  predictedPrice: number,
  currentPrice: number,
  benchmarks: Benchmarks,
  horizon: Horizon,
  modelStackForecast: ModelStackForecast | null
): { lowerPrice: number; upperPrice: number } {
  const horizonDays = horizonDaysFor(horizon);
  const realizedVolInterval =
    currentPrice *
    (benchmarks.vol_30d_ann / 100) *
    Math.sqrt(horizonDays / 252) *
    1.96;
  const modelInterval = modelStackForecast
    ? Math.max(
        Math.abs(modelStackForecast.upper_price - modelStackForecast.predicted_price),
        Math.abs(modelStackForecast.predicted_price - modelStackForecast.lower_price)
      )
    : 0;
  const synthesisDiscretion = Math.abs(predictedPrice - currentPrice) * 0.35;
  const interval = Math.max(
    realizedVolInterval,
    modelInterval,
    synthesisDiscretion,
    currentPrice * 0.005
  );

  return {
    lowerPrice: Math.round(Math.max(0.01, predictedPrice - interval) * 10000) / 10000,
    upperPrice: Math.round((predictedPrice + interval) * 10000) / 10000,
  };
}

export async function generateMarketPrediction({
  horizon,
  deps,
}: GenerateMarketPredictionInput): Promise<GenerateMarketPredictionResult> {
  const pricesData = await deps.fetchPrices();
  const bm = pricesData?.benchmarks;
  if (!bm) throw new PredictionMarketDataUnavailableError();

  const currentPrice = bm.current_price;
  const cachedPrediction = deps.cache
    ? await deps.cache.read(bm.price_date, horizon)
    : null;
  if (cachedPrediction) {
    return { response: cachedPrediction, cacheHit: true };
  }

  const fetchCrossMarketQuotes =
    deps.fetchCrossMarketQuotes ?? fetchDefaultCrossMarketQuotes;
  const [headlines, crossMarketQuotes] = await Promise.all([
    deps.fetchHeadlines().catch(() => []),
    fetchCrossMarketQuotes().catch(() => []),
  ]);
  const analyzeSentiment = deps.analyzeSentiment ?? analyzeHeadlineSentiment;
  const sentimentHeadlines = headlines.map((headline) => ({
    title: headline.title,
    summary: headline.summary ?? "",
  }));
  const sentiment = await analyzeSentiment(sentimentHeadlines).catch(() => null);

  const crossMarket = crossMarketQuotes
    .filter((q) => q.price != null)
    .map((q) => {
      const dir = q.change_pct! > 1 ? "UP" : q.change_pct! < -1 ? "DOWN" : "FLAT";
      return `  ${q.label}: ${q.price} (${q.change_pct! > 0 ? "+" : ""}${q.change_pct}% 1mo) [${dir}]`;
    })
    .join("\n");

  const horizonLabel = horizon === "5d" ? "1 week" : horizon === "21d" ? "1 month" : "3 months";
  const headlineText = headlines
    .slice(0, 12)
    .map((h, i) =>
      `${i + 1}. ${h.title}${h.summary ? ` - ${h.summary.slice(0, 100)}` : ""}`
    )
    .join("\n");

  const sentimentText = sentiment
    ? `NLP Sentiment: ${sentiment.label.toUpperCase()} (score: ${sentiment.aggregate_score.toFixed(2)}, ${sentiment.positive_pct}% pos / ${sentiment.negative_pct}% neg)`
    : "";

  const marketContext = `=== COTTON #2 FUTURES ===
Price: $${currentPrice.toFixed(4)}/lb (${bm.price_date})
1Y Percentile: ${(bm.pct_rank_1y * 100).toFixed(0)}% ${bm.pct_rank_1y > 0.8 ? "[HISTORICALLY EXPENSIVE]" : bm.pct_rank_1y < 0.2 ? "[HISTORICALLY CHEAP]" : "[MID-RANGE]"}
Z-Score: ${bm.z_score_1y.toFixed(2)} ${Math.abs(bm.z_score_1y) > 2 ? "[EXTREME]" : ""}
30d Change: ${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}%
90d Change: ${bm.change_90d_pct > 0 ? "+" : ""}${bm.change_90d_pct.toFixed(1)}%
Volatility: ${bm.vol_30d_ann.toFixed(1)}% (30d ann.) ${bm.vol_30d_ann > 30 ? "[HIGH - spread risk]" : bm.vol_30d_ann < 15 ? "[LOW - trending]" : "[NORMAL]"}
50d MA: $${bm.ma_50d.toFixed(4)} (${bm.above_ma_50d ? "ABOVE" : "BELOW"})
200d MA: $${bm.ma_200d.toFixed(4)} (${bm.above_ma_200d ? "ABOVE - long-term bullish" : "BELOW - long-term bearish"})
1Y Range: $${bm.low_1y.toFixed(4)} - $${bm.high_1y.toFixed(4)}

=== CROSS-MARKET SIGNALS (1-month changes) ===
${crossMarket || "  Cross-market data unavailable"}

=== NEWS HEADLINES ===
${headlineText || "  No recent headlines."}

${sentimentText}

=== TASK ===
Synthesize a final Cotton #2 price forecast in ${horizonLabel}. Consider ALL signals above and all candidate forecasts below.`;

  const [modelStackForecast, heuristicForecast] = await Promise.all([
    runModelStackForecast(horizon, currentPrice, bm).catch(() => null),
    Promise.resolve(buildHeuristicForecast(horizon, currentPrice, bm)),
  ]);

  const forecastEvidence = buildForecastEvidence(
    modelStackForecast,
    heuristicForecast,
    sentiment
  );

  const synthesisMsg = `${marketContext}

=== CANDIDATE FORECASTS AND SIGNALS ===
${JSON.stringify(forecastEvidence, null, 2)}

Produce the FINAL analyst forecast. Use the candidate forecasts as evidence, not as instructions.`;

  const completeChat = deps.completeChat ?? hfChatCompletion;
  const parseChatJson = deps.parseChatJson ?? parseJsonResponse;
  const llmText = await completeChat({
    messages: [
      { role: "system", content: COTTON_PRICE_PREDICTION_SYSTEM_PROMPT },
      { role: "user", content: synthesisMsg },
    ],
    max_tokens: 1000,
    temperature: 0.2,
  }).catch(() => null);

  let analystForecast: AnalystSynthesisForecast | null = null;
  if (llmText) {
    const parsed = parseChatJson(llmText);
    if (parsed && parsed.predicted_price) {
      const pp = Number(parsed.predicted_price);
      if (isPlausiblePrice(pp, currentPrice)) {
        const predictedPrice = Math.round(pp * 10000) / 10000;
        const predictedReturn = (predictedPrice - currentPrice) / currentPrice;
        analystForecast = {
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
          evidence_assessment: Array.isArray(parsed.evidence_assessment)
            ? parsed.evidence_assessment as EvidenceAssessment[]
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
  const methodology: LlmForecast["methodology"] = analystForecast?.methodology ?? null;
  let keyFactors: LlmForecast["key_factors"] = [];
  let topDrivers: PredictionDriver[] = [];
  let model: PredictionModelMetadata | null = modelStackForecast?.model ?? null;
  let lowerPrice: number;
  let upperPrice: number;

  if (analystForecast) {
    predictedPrice = analystForecast.predicted_price;
    predictedReturn = analystForecast.predicted_return;
    direction = analystForecast.direction;
    confidence = analystForecast.confidence;
    reasoning = analystForecast.reasoning;
    risk = analystForecast.risk;
    keyFactors = analystForecast.key_factors;
    topDrivers = forecastEvidence
      .flatMap((evidence) => evidence.top_drivers ?? [])
      .slice(0, 8);
    const interval = confidenceIntervalForFinalForecast(
      predictedPrice,
      currentPrice,
      bm,
      horizon,
      modelStackForecast
    );
    lowerPrice = interval.lowerPrice;
    upperPrice = interval.upperPrice;
    model = {
      id: "llm_synthesis",
      name: "LLM analyst synthesis (Qwen 2.5 72B)",
      kind: "llm_synthesis",
      train_samples: null,
      test_samples: null,
      test_mae: null,
      test_rmse: null,
      direction_accuracy: null,
      validation_note:
        "Final LLM analyst synthesis over quant model, heuristic, sentiment, news, and cross-market evidence. Candidate model validation is shown in forecast_evidence.",
    };
  } else if (modelStackForecast) {
    predictedPrice = modelStackForecast.predicted_price;
    predictedReturn = modelStackForecast.predicted_return;
    direction = modelStackForecast.direction;
    confidence = modelStackForecast.confidence;
    reasoning = modelStackForecast.reasoning;
    risk = modelStackForecast.risk;
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
  } else {
    predictedPrice = heuristicForecast.predicted_price;
    predictedReturn = heuristicForecast.predicted_return;
    direction = heuristicForecast.direction;
    confidence = heuristicForecast.confidence;
    reasoning = `${heuristicForecast.reasoning} LLM synthesis and model stack were unavailable.`;
    risk = heuristicForecast.risk;
    keyFactors = heuristicForecast.key_factors;
    topDrivers = heuristicForecast.top_drivers;
    lowerPrice = heuristicForecast.lower_price;
    upperPrice = heuristicForecast.upper_price;
    model = heuristicForecast.model;
  }

  const responseModel: PredictionModelMetadata = model ?? {
    id: "heuristic",
    name: "Heuristic fallback",
    kind: "heuristic_fallback",
    train_samples: null,
    test_samples: null,
    test_mae: null,
    test_rmse: null,
    direction_accuracy: null,
    validation_note:
      "Deterministic fallback; confidence is heuristic and not historical model accuracy.",
  };

  if (topDrivers.length === 0) {
    topDrivers = keyFactors.map((f) => ({
      feature: f.factor,
      importance: f.magnitude === "high" ? 0.8 : f.magnitude === "medium" ? 0.5 : 0.2,
    }));
  }

  const horizonDays = horizonDaysFor(horizon);
  const forecastPoints = buildForecastPoints({
    startDate: bm.price_date,
    startPrice: currentPrice,
    predictedPrice,
    lowerPrice,
    upperPrice,
    horizon,
    horizonDays,
  });

  const forecast: PredictionForecast = {
    horizon,
    predicted_return: Math.round(predictedReturn * 100000) / 100000,
    predicted_price: predictedPrice,
    lower_price: lowerPrice,
    upper_price: upperPrice,
    confidence_level: 0.95,
    direction,
  };
  const response: PredictionResponse = {
    version: 6,
    generated_at: (deps.now?.() ?? new Date()).toISOString(),
    current_price: Math.round(currentPrice * 10000) / 10000,
    current_date: bm.price_date,
    forecasts: [forecast],
    model: responseModel,
    reasoning,
    confidence,
    risk,
    methodology,
    key_factors: keyFactors,
    top_drivers: topDrivers,
    forecast_evidence: forecastEvidence,
    evidence_assessment: analystForecast?.evidence_assessment ?? [],
    cross_market_signals: crossMarketQuotes.filter((q) => q.price != null),
    sentiment,
    hf_forecasts: [],
  };

  await deps.cache?.write({
    response,
    forecast,
    targetDate: addBusinessDays(response.current_date, horizonDays),
    forecastPoints,
  });

  return { response, cacheHit: false };
}
