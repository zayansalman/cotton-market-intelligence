import { NextResponse } from "next/server";
import type {
  Benchmarks,
  Headline,
  Strategy,
  LandedCostResponse,
  PurchaserInput,
} from "@/lib/types";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { parseStrategyRequest } from "@/lib/schemas/strategy-request";
import { safeParseBody, safeErrorResponse } from "@/lib/api-security";
import { checkAiQuota, recordAiUsage } from "@/lib/usage-quota";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";
import { computeUnifiedSignal } from "@/lib/engine/unified-signal";
import type { UnifiedSignal } from "@/lib/engine/unified-signal";
import { analyzeHeadlineSentiment } from "@/lib/hf/sentiment";
import { heuristicStrategyV2 } from "@/lib/engine/heuristic-v2";
import { getSupabase } from "@/lib/supabase";
import { cacheKey } from "@/lib/cache-key";

const SYSTEM_PROMPT = `You are a senior cotton procurement strategist and commodity analyst \
for spinning mills in South Asia (Bangladesh, India, Pakistan).

Your expertise:
- Cotton #2 ICE futures and global spot markets
- Supply/demand fundamentals: US, India, China, Brazil, West Africa
- Seasonal patterns: planting (Mar-May), growing (Jun-Sep), harvest (Oct-Dec) Northern Hemisphere
- South Asian demand: peak procurement Aug-Dec for winter/spring production runs
- Risk management: a mill running out of cotton is catastrophic — bias conservative

INSTRUCTIONS:
- Analyze the market data and news headlines holistically.
- Be specific and actionable — mills need exact tonnage guidance, not vague advice.
- Consider the client's timeline urgency vs current market conditions.
- When headlines are sparse or generic, weight statistical signals more heavily.

Return ONLY a JSON object with these fields:
{
  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "AVOID",
  "confidence": <int 0-100>,
  "executive_summary": "<2-3 sentences for the MD/CEO>",
  "market_analysis": "<3-5 paragraph markdown analysis>",
  "monthly_plan": [
    {"month": 1, "pct": <percent of total>, "rationale": "<1 sentence>"},
    ...
  ],
  "risk_factors": ["<risk>", ...],
  "next_actions": ["<action>", ...],
  "key_levels": {"support": <float>, "resistance": <float>, "fair_value": <float>}
}
The monthly_plan pct values MUST sum to 100.`;

type StrategyProvider = "huggingface" | "heuristic";
type SupabaseClientInstance = NonNullable<ReturnType<typeof getSupabase>>;

interface AnalystMarketForecast {
  current_price: number;
  current_date: string;
  forecasts: Array<{
    horizon: string;
    predicted_return: number;
    predicted_price: number;
    direction: "up" | "down" | "flat";
  }>;
  model: {
    id: string;
    name: string;
    kind: "llm_synthesis" | "model_stack" | "llm_fallback" | "heuristic_fallback";
    validation_note?: string;
  };
  confidence?: number;
  reasoning?: string;
  risk?: string;
  key_factors?: Array<{ factor: string; impact: string; magnitude: string }>;
  forecast_evidence?: unknown[];
  evidence_assessment?: unknown[];
  sentiment?: { aggregate_score?: number } | null;
}

function mapSignalToReturn(signal: Strategy["signal"]): number {
  if (signal === "STRONG_BUY") return 0.03;
  if (signal === "BUY") return 0.015;
  if (signal === "AVOID") return -0.02;
  return 0;
}

function attachConstraintFields(
  strategy: Strategy,
  heuristicBaseResult: ReturnType<typeof heuristicStrategyV2>
) {
  return {
    ...strategy,
    binding_constraints: heuristicBaseResult.binding_constraints,
    assumption_set: heuristicBaseResult.assumption_set,
    constraint_risks: heuristicBaseResult.constraint_risks,
    plan_feasibility_score: heuristicBaseResult.plan_feasibility_score,
  };
}

function attachUnifiedSignalFields(
  strategy: ReturnType<typeof attachConstraintFields>,
  unifiedSignal: UnifiedSignal | null
) {
  if (!unifiedSignal) return strategy;

  return {
    ...strategy,
    signal: unifiedSignal.signal,
    confidence: Math.round(unifiedSignal.confidence * 100),
    decision_drivers: unifiedSignal.decision_drivers,
    predicted_return: unifiedSignal.predicted_return,
    news_override: unifiedSignal.news_override,
  };
}

function confidence01(confidence: number | undefined): number | null {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  return confidence > 1 ? confidence / 100 : confidence;
}

function sentimentScoreFromForecast(
  marketForecast: AnalystMarketForecast | null
): number | null {
  const score = marketForecast?.sentiment?.aggregate_score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function buildUserMessage(
  benchmarks: Benchmarks,
  headlines: Headline[],
  purchaserInput: PurchaserInput,
  landedCost?: LandedCostResponse | null,
  marketForecast?: AnalystMarketForecast | null
): string {
  const tonnage = purchaserInput.demand.required_tonnes;
  const months = purchaserInput.demand.planning_horizon_months;
  const headlineSummary = headlines
    .slice(0, 25)
    .map((h) => ({ title: h.title, summary: h.summary.slice(0, 150) }));
  const purchaserHighlights = [
    `- Total tonnage: ${tonnage.toLocaleString()} tonnes`,
    `- Horizon: ${months} months`,
    `- Implied monthly rate: ${Math.round(tonnage / months).toLocaleString()} tonnes/month`,
    ...(purchaserInput.timeline?.urgency_level
      ? [`- Urgency: ${purchaserInput.timeline.urgency_level}`]
      : []),
    ...(purchaserInput.timeline?.max_monthly_receipt_capacity_tonnes
      ? [
          `- Receipt capacity: ${purchaserInput.timeline.max_monthly_receipt_capacity_tonnes.toLocaleString()} tonnes/month`,
        ]
      : []),
    ...(purchaserInput.quality?.preferred_origins?.length
      ? [
          `- Preferred origins: ${purchaserInput.quality.preferred_origins.join(", ")}`,
        ]
      : []),
    ...(purchaserInput.finance?.max_credit_days !== undefined
      ? [`- Max credit days: ${purchaserInput.finance.max_credit_days}`]
      : []),
    ...(purchaserInput.logistics?.incoterm
      ? [`- Incoterm: ${purchaserInput.logistics.incoterm}`]
      : []),
  ].join("\n");
  const landedCostSection = landedCost
    ? `\n\nBANGLADESH LANDED COST CONTEXT:
${JSON.stringify(landedCost, null, 2)}

Use landed cost context in your recommendation quality where relevant.`
    : "";
  const marketForecastSection = marketForecast
    ? `\n\nFINAL MARKET FORECAST:
${JSON.stringify(
  {
    current_price: marketForecast.current_price,
    current_date: marketForecast.current_date,
    primary_forecast: marketForecast.forecasts[0],
    model: marketForecast.model,
    confidence: marketForecast.confidence,
    reasoning: marketForecast.reasoning,
    risk: marketForecast.risk,
    key_factors: marketForecast.key_factors,
    forecast_evidence: marketForecast.forecast_evidence,
    evidence_assessment: marketForecast.evidence_assessment,
  },
  null,
  2
)}

Use this final market forecast as the primary price-direction view for timing and pacing. If you recommend a different procurement signal than the forecast implies, explicitly explain the operational constraint or risk reason.`
    : "";

  return `CURRENT MARKET DATA (Cotton #2 Futures):
${JSON.stringify(benchmarks, null, 2)}

RECENT NEWS HEADLINES:
${JSON.stringify(headlineSummary, null, 2)}

CLIENT REQUIREMENT:
${purchaserHighlights}

PURCHASER INPUT (canonical schema):
${JSON.stringify(purchaserInput, null, 2)}

Treat the purchaser input as operational constraints that must shape timing, pacing, origin flexibility, supplier concentration, logistics, and credit risk.

Analyze the market and generate a procurement strategy for this client.${marketForecastSection}${landedCostSection}`;
}

function resolveProvider(): StrategyProvider {
  const explicit = (process.env.STRATEGY_MODEL_PROVIDER ?? "auto")
    .toLowerCase()
    .trim();
  const hasHf = Boolean(process.env.HF_TOKEN);

  if (explicit === "huggingface") return hasHf ? "huggingface" : "heuristic";
  if (explicit === "heuristic") return "heuristic";

  // Auto mode: HF if token present, else heuristic
  if (hasHf) return "huggingface";
  return "heuristic";
}

function buildStrategyCacheInput({
  provider,
  benchmarks,
  headlines,
  landedCost,
  marketForecast,
  purchaserInput,
}: {
  provider: StrategyProvider;
  benchmarks: Benchmarks;
  headlines: Headline[];
  landedCost?: LandedCostResponse | null;
  marketForecast?: AnalystMarketForecast | null;
  purchaserInput: PurchaserInput;
}) {
  return {
    version: 1,
    provider,
    strategy_input_version: 2,
    purchaser_input: purchaserInput,
    benchmarks,
    headlines,
    landedCost: landedCost ?? null,
    marketForecast: marketForecast ?? null,
  };
}

function isStrategyPayload(value: unknown): value is Strategy {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<Strategy>;
  return (
    typeof payload.signal === "string" &&
    typeof payload.confidence === "number" &&
    typeof payload.executive_summary === "string" &&
    Array.isArray(payload.monthly_plan) &&
    Array.isArray(payload.risk_factors) &&
    Array.isArray(payload.next_actions)
  );
}

async function readCachedStrategy(
  supabase: SupabaseClientInstance,
  key: string
): Promise<Strategy | null> {
  try {
    const { data, error } = await supabase
      .from("strategies")
      .select("response_payload")
      .eq("cache_key", key)
      .maybeSingle();

    if (error || !data) return null;
    const payload = (data as { response_payload?: unknown }).response_payload;
    return isStrategyPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function writeStrategyCache({
  supabase,
  key,
  requestPayload,
  responsePayload,
  provider,
  benchmarks,
  marketForecast,
}: {
  supabase: SupabaseClientInstance | null;
  key: string;
  requestPayload: unknown;
  responsePayload: Strategy;
  provider: StrategyProvider;
  benchmarks: Benchmarks;
  marketForecast?: AnalystMarketForecast | null;
}): Promise<void> {
  if (!supabase) return;
  try {
    const primaryForecast = marketForecast?.forecasts?.[0] ?? null;
    await supabase.from("strategies").upsert(
      {
        strategy_date: benchmarks.price_date,
        cache_key: key,
        request_payload: requestPayload,
        response_payload: responsePayload,
        provider: responsePayload.provider ?? provider,
        source: responsePayload.source,
        signal: responsePayload.signal,
        confidence: responsePayload.confidence,
        prediction_date: marketForecast?.current_date ?? benchmarks.price_date,
        horizon: primaryForecast?.horizon ?? null,
      },
      { onConflict: "cache_key" }
    );
  } catch { /* Strategy cache writes are non-fatal. */ }
}

async function runHuggingFaceStrategy(userMsg: string): Promise<Strategy | null> {
  const { hfChatCompletion, parseJsonResponse } = await import("@/lib/hf/client");

  const text = await hfChatCompletion({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    max_tokens: 900,
    temperature: 0.2,
  });

  if (!text) return null;

  const parsed = parseJsonResponse(text);
  if (!parsed) return null;
  return {
    ...(parsed as Omit<Strategy, "source" | "provider">),
    source: "ai",
    provider: "huggingface",
  };
}

export async function POST(req: Request) {
  const abuse = checkAbuse(req);
  if (abuse.blocked) return abuseBlockedResponse(abuse);

  const rateLimit = evaluateRequestRateLimit(req, "strategy");
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit);
  }

  try {
    const bodyOrError = await safeParseBody(req);
    if (bodyOrError instanceof NextResponse) {
      return applyRateLimitHeaders(bodyOrError, rateLimit.headers);
    }
    const parsed = parseStrategyRequest(bodyOrError);

    if (!parsed.ok) {
      return applyRateLimitHeaders(
        NextResponse.json({ errors: parsed.errors }, { status: 422 }),
        rateLimit.headers
      );
    }

    const {
      purchaserInput,
      benchmarks,
      headlines,
      landedCost,
      marketForecast,
    } = parsed.data;
    const provider = resolveProvider();
    const strategyCacheInput = buildStrategyCacheInput({
      provider,
      benchmarks,
      headlines,
      landedCost,
      marketForecast,
      purchaserInput,
    });
    const strategyCacheKey = cacheKey(strategyCacheInput);
    const supabase = getSupabase();
    const cachedStrategy = supabase
      ? await readCachedStrategy(supabase, strategyCacheKey)
      : null;
    if (cachedStrategy) {
      const response = NextResponse.json(cachedStrategy);
      response.headers.set("X-CMI-Cache", "HIT");
      return applyRateLimitHeaders(response, rateLimit.headers);
    }

    const heuristicBaseResult = heuristicStrategyV2(
      purchaserInput,
      benchmarks,
      landedCost
    );

    const userMsg = buildUserMessage(
      benchmarks,
      headlines,
      purchaserInput,
      landedCost,
      marketForecast
    );

    // --- Compute unified signal (non-blocking) ---
    let unifiedSignal: UnifiedSignal | null = null;
    try {
      const heuristicReturn = mapSignalToReturn(heuristicBaseResult.signal);
      const primaryForecast = marketForecast?.forecasts?.[0] ?? null;
      const primaryReturn =
        primaryForecast && Number.isFinite(primaryForecast.predicted_return)
          ? primaryForecast.predicted_return
          : null;
      const marketForecastConfidence = confidence01(marketForecast?.confidence);
      const modelKind = marketForecast?.model?.kind;

      // `/api/prediction` already performs the expensive sentiment/news/LLM
      // synthesis. Reusing that evidence keeps strategy generation fast and
      // prevents roadmap calls from timing out on duplicate HF analysis.
      const forecastSentimentScore = sentimentScoreFromForecast(marketForecast);
      const shouldRunFallbackHeadlineAnalysis = !marketForecast;
      const [sentimentResult] = shouldRunFallbackHeadlineAnalysis
        ? await Promise.allSettled([
            analyzeHeadlineSentiment(
              headlines.slice(0, 10).map(h => ({ title: h.title, summary: h.summary ?? "" }))
            ),
          ])
        : [];

      const sentiment =
        sentimentResult?.status === "fulfilled" ? sentimentResult.value : null;
      const newsAnalysis = null;

      unifiedSignal = computeUnifiedSignal({
        model_return: modelKind === "model_stack" ? primaryReturn : null,
        model_confidence: modelKind === "model_stack" ? marketForecastConfidence : null,
        llm_return:
          modelKind === "llm_synthesis" || modelKind === "llm_fallback"
            ? primaryReturn
            : null,
        llm_confidence:
          modelKind === "llm_synthesis" || modelKind === "llm_fallback"
            ? marketForecastConfidence
            : null,
        llm_reasoning: marketForecast?.reasoning ?? null,
        heuristic_return: heuristicReturn,
        heuristic_signal: heuristicBaseResult.signal,
        sentiment_score: forecastSentimentScore ?? sentiment?.aggregate_score ?? null,
        news_analysis: newsAnalysis,
      });
    } catch { /* non-fatal */ }

    const quota = checkAiQuota(req);
    const allHeaders = { ...rateLimit.headers, ...quota.headers };

    // If quota exhausted, skip AI and go straight to heuristic
    if (provider !== "heuristic" && quota.degraded_to_heuristic) {
      console.warn(`[strategy] Quota exceeded for request — degrading to heuristic. Reason: ${quota.reason}`);
      const result = { ...heuristicBaseResult };
      result.risk_factors = [
        "Strategy AI quota exceeded — using deterministic strategy generation with the latest market forecast overlay.",
        ...result.risk_factors,
      ];
      const responsePayload = attachUnifiedSignalFields(
        attachConstraintFields(result, heuristicBaseResult),
        unifiedSignal
      );
      return applyRateLimitHeaders(
        NextResponse.json(responsePayload),
        allHeaders
      );
    }

    if (provider === "huggingface" && process.env.HF_TOKEN) {
      const strategy = await runHuggingFaceStrategy(userMsg);
      if (strategy) {
        recordAiUsage(req);
        const responsePayload = attachUnifiedSignalFields(
          attachConstraintFields(strategy, heuristicBaseResult),
          unifiedSignal
        );
        await writeStrategyCache({
          supabase,
          key: strategyCacheKey,
          requestPayload: strategyCacheInput,
          responsePayload,
          provider,
          benchmarks,
          marketForecast,
        });
        return applyRateLimitHeaders(
          NextResponse.json(responsePayload),
          allHeaders
        );
      }
    }

    const heuristicResult = { ...heuristicBaseResult };
    if (unifiedSignal) {
      heuristicResult.signal = unifiedSignal.signal;
      heuristicResult.confidence = Math.round(unifiedSignal.confidence * 100);
      (heuristicResult as unknown as Record<string, unknown>).decision_drivers = unifiedSignal.decision_drivers;
      (heuristicResult as unknown as Record<string, unknown>).predicted_return = unifiedSignal.predicted_return;
      (heuristicResult as unknown as Record<string, unknown>).news_override = unifiedSignal.news_override;
    }
    const responsePayload = attachUnifiedSignalFields(
      attachConstraintFields(heuristicResult, heuristicBaseResult),
      unifiedSignal
    );
    if (provider === "heuristic") {
      await writeStrategyCache({
        supabase,
        key: strategyCacheKey,
        requestPayload: strategyCacheInput,
        responsePayload,
        provider,
        benchmarks,
        marketForecast,
      });
    }
    return applyRateLimitHeaders(
      NextResponse.json(responsePayload),
      allHeaders
    );
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "strategy"),
      rateLimit.headers
    );
  }
}
