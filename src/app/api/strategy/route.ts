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
import { analyzeNewsForStrategy } from "@/lib/hf/news-analysis";
import { heuristicStrategyV2 } from "@/lib/engine/heuristic-v2";

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
    const provider = resolveProvider();

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

      // Run sentiment analysis and deep news analysis in parallel
      const [sentimentResult, newsAnalysisResult] = await Promise.allSettled([
        analyzeHeadlineSentiment(
          headlines.map(h => ({ title: h.title, summary: h.summary ?? "" }))
        ),
        analyzeNewsForStrategy(headlines, benchmarks,  null),
      ]);

      const sentiment = sentimentResult.status === "fulfilled" ? sentimentResult.value : null;
      const newsAnalysis = newsAnalysisResult.status === "fulfilled" ? newsAnalysisResult.value : null;

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
        sentiment_score: sentiment?.aggregate_score ?? null,
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
      return applyRateLimitHeaders(
        NextResponse.json(
          attachUnifiedSignalFields(
            attachConstraintFields(result, heuristicBaseResult),
            unifiedSignal
          )
        ),
        allHeaders
      );
    }

    if (provider === "huggingface" && process.env.HF_TOKEN) {
      const strategy = await runHuggingFaceStrategy(userMsg);
      if (strategy) {
        recordAiUsage(req);
        return applyRateLimitHeaders(
          NextResponse.json(
            attachUnifiedSignalFields(
              attachConstraintFields(strategy, heuristicBaseResult),
              unifiedSignal
            )
          ),
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
    return applyRateLimitHeaders(
      NextResponse.json(
        attachUnifiedSignalFields(
          attachConstraintFields(heuristicResult, heuristicBaseResult),
          unifiedSignal
        )
      ),
      allHeaders
    );
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "strategy"),
      rateLimit.headers
    );
  }
}
