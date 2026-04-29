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

function buildUserMessage(
  benchmarks: Benchmarks,
  headlines: Headline[],
  purchaserInput: PurchaserInput,
  landedCost?: LandedCostResponse | null
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

  return `CURRENT MARKET DATA (Cotton #2 Futures):
${JSON.stringify(benchmarks, null, 2)}

RECENT NEWS HEADLINES:
${JSON.stringify(headlineSummary, null, 2)}

CLIENT REQUIREMENT:
${purchaserHighlights}

PURCHASER INPUT (canonical schema):
${JSON.stringify(purchaserInput, null, 2)}

Treat the purchaser input as operational constraints that must shape timing, pacing, origin flexibility, supplier concentration, logistics, and credit risk.

Analyze the market and generate a procurement strategy for this client.${landedCostSection}`;
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

async function runHuggingFaceStrategy(
  userMsg: string,
  _token: string
): Promise<Strategy | null> {
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

    const { purchaserInput, benchmarks, headlines, landedCost } = parsed.data;
    const heuristicBaseResult = heuristicStrategyV2(
      purchaserInput,
      benchmarks,
      landedCost
    );

    const userMsg = buildUserMessage(
      benchmarks,
      headlines,
      purchaserInput,
      landedCost
    );
    const provider = resolveProvider();

    // --- Compute unified signal (non-blocking) ---
    let unifiedSignal: UnifiedSignal | null = null;
    try {
      const heuristicReturn = mapSignalToReturn(heuristicBaseResult.signal);

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
        model_return: null,
        model_confidence: null,
        llm_return: null,
        llm_confidence: null,
        llm_reasoning: null,
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
        "AI quota exceeded — using statistical heuristic. Results may lack news context.",
        ...result.risk_factors,
      ];
      return applyRateLimitHeaders(NextResponse.json(result), allHeaders);
    }

    if (provider === "huggingface" && process.env.HF_TOKEN) {
      const strategy = await runHuggingFaceStrategy(userMsg, process.env.HF_TOKEN);
      if (strategy) {
        recordAiUsage(req);
        return applyRateLimitHeaders(
          NextResponse.json(attachConstraintFields(strategy, heuristicBaseResult)),
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
      NextResponse.json(heuristicResult),
      allHeaders
    );
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "strategy"),
      rateLimit.headers
    );
  }
}
