import { NextResponse } from "next/server";
import type {
  Benchmarks,
  Headline,
  Strategy,
  MonthlyPlan,
  LandedCostResponse,
} from "@/lib/types";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { parseStrategyRequest } from "@/lib/schemas/strategy-request";
import { safeParseBody, safeErrorResponse, fetchWithTimeout } from "@/lib/api-security";
import { checkAiQuota, recordAiUsage } from "@/lib/usage-quota";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";
import { computeUnifiedSignal } from "@/lib/engine/unified-signal";
import type { UnifiedSignal } from "@/lib/engine/unified-signal";
import { analyzeHeadlineSentiment } from "@/lib/hf/sentiment";

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

interface StrategyRequest {
  benchmarks: Benchmarks;
  headlines: Headline[];
  tonnage: number;
  months: number;
  landedCost?: LandedCostResponse | null;
}

type StrategyProvider = "huggingface" | "openai" | "heuristic";

function heuristicStrategy(
  bm: Benchmarks,
  tonnage: number,
  months: number,
  landedCost?: LandedCostResponse | null
): Strategy {
  const rank = bm.pct_rank_1y;
  const z = bm.z_score_1y;
  const vol = bm.vol_30d_ann;

  let signal: Strategy["signal"];
  let confidence: number;

  if (rank < 0.15 && z < -1) {
    signal = "STRONG_BUY";
    confidence = 80;
  } else if (rank < 0.3) {
    signal = "BUY";
    confidence = 65;
  } else if (rank > 0.8) {
    signal = "AVOID";
    confidence = 70;
  } else {
    signal = "HOLD";
    confidence = 50;
  }

  const base = Array.from({ length: months }, (_, i) => {
    if (signal === "STRONG_BUY" || signal === "BUY")
      return Math.exp(-0.3 * i);
    if (signal === "AVOID") return Math.exp(0.3 * i);
    return 1;
  });

  if (vol > 30) {
    for (let i = 0; i < base.length; i++) {
      base[i] = 0.7 * base[i] + 0.3;
    }
  }

  const sum = base.reduce((a, b) => a + b, 0);
  const weights = base.map((b) => b / sum);

  const signalText: Record<string, string> = {
    STRONG_BUY: "Front-loaded — price is historically cheap",
    BUY: "Moderately front-loaded — attractive entry",
    AVOID: "Back-loaded — price is expensive, defer",
    HOLD: "Uniform — no strong directional signal",
  };

  const plan: MonthlyPlan[] = weights.map((w, i) => ({
    month: i + 1,
    pct: Math.round(w * 1000) / 10,
    tonnes: Math.round(tonnage * w),
    rationale: signalText[signal],
  }));

  const above50 = bm.above_ma_50d ? "above" : "below";
  const above200 = bm.above_ma_200d ? "above" : "below";
  const px = bm.current_price;
  const landedBdtKg = landedCost?.breakdown.effective_bdt_kg ?? null;
  const landedUsdT = landedCost?.breakdown.effective_usd_t ?? null;

  const summaries: Record<string, string> = {
    STRONG_BUY: `Price at $${px.toFixed(4)}/lb is historically cheap (${(rank * 100).toFixed(0)}% of 1Y range). Prioritise building inventory now.`,
    BUY: `Price at $${px.toFixed(4)}/lb is moderately attractive (${(rank * 100).toFixed(0)}% of 1Y range). Increase procurement pacing.`,
    AVOID: `Price at $${px.toFixed(4)}/lb is elevated (${(rank * 100).toFixed(0)}% of 1Y range). Minimise new exposure and defer.`,
    HOLD: `Price at $${px.toFixed(4)}/lb is mid-range (${(rank * 100).toFixed(0)}% of 1Y range). Maintain baseline procurement cadence.`,
  };

  const landedSummary =
    landedBdtKg != null && landedUsdT != null
      ? ` Current landed cost estimate is Tk ${landedBdtKg.toFixed(2)}/kg (~$${landedUsdT.toFixed(0)}/t effective).`
      : "";

  return {
    signal,
    confidence,
    executive_summary: summaries[signal] + landedSummary,
    market_analysis:
      `**Price context**: $${px.toFixed(4)}/lb sits at the ${(rank * 100).toFixed(0)}% percentile of its ` +
      `1-year range ($${bm.low_1y.toFixed(4)} – $${bm.high_1y.toFixed(4)}). ` +
      `Z-score: ${z.toFixed(2)}. Currently ${above50} 50d MA ($${bm.ma_50d.toFixed(4)}) ` +
      `and ${above200} 200d MA ($${bm.ma_200d.toFixed(4)}).\n\n` +
      `**Momentum**: 30-day change ${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}%, ` +
      `90-day change ${bm.change_90d_pct > 0 ? "+" : ""}${bm.change_90d_pct.toFixed(1)}%.\n\n` +
      `**Volatility**: ${vol.toFixed(1)}% annualized (30d). ` +
      `${vol > 30 ? "Elevated — spread purchases to reduce execution risk." : "Normal regime."}\n\n` +
      (landedBdtKg != null && landedUsdT != null
        ? `**Bangladesh landed cost**: Effective cotton cost is approximately Tk ${landedBdtKg.toFixed(2)}/kg ` +
          `(~$${landedUsdT.toFixed(0)}/t) under current basis, freight, FX, insurance, duty, and wastage assumptions.\n\n`
        : "") +
      `*Statistical heuristic. Connect a configured AI provider (Hugging Face-first) for richer news interpretation and strategic depth.*`,
    monthly_plan: plan,
    risk_factors: [
      "Statistical heuristic only — no news or fundamental analysis.",
      ...(vol > 30
        ? ["Elevated volatility increases execution risk on large orders."]
        : []),
      ...(rank > 0.8
        ? ["Price is near 1Y highs — basis risk is elevated."]
        : []),
    ],
    next_actions: [
      "Set HF_TOKEN to enable AI-powered analysis (Hugging Face-first).",
      ...(landedBdtKg != null
        ? [
            `Run margin check versus yarn realization using Tk ${landedBdtKg.toFixed(2)}/kg landed cotton.`,
          ]
        : []),
      "Verify quality/count mix and wastage assumptions.",
      "Align roadmap with credit limits and warehouse capacity.",
    ],
    key_levels: {
      support: bm.low_1y,
      resistance: bm.high_1y,
      fair_value: Math.round(((bm.ma_50d + bm.ma_200d) / 2) * 10000) / 10000,
    },
    source: "heuristic",
    provider: "heuristic",
  };
}

function buildUserMessage(
  benchmarks: Benchmarks,
  headlines: Headline[],
  tonnage: number,
  months: number,
  landedCost?: LandedCostResponse | null
): string {
  const headlineSummary = headlines
    .slice(0, 25)
    .map((h) => ({ title: h.title, summary: h.summary.slice(0, 150) }));
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
- Total tonnage: ${tonnage.toLocaleString()} tonnes
- Horizon: ${months} months
- Implied monthly rate: ${Math.round(tonnage / months).toLocaleString()} tonnes/month

Analyze the market and generate a procurement strategy for this client.${landedCostSection}`;
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function resolveProvider(): StrategyProvider {
  const explicit = (process.env.STRATEGY_MODEL_PROVIDER ?? "auto")
    .toLowerCase()
    .trim();
  const hasHf = Boolean(process.env.HF_TOKEN);
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const allowOpenAiFallback = process.env.ALLOW_OPENAI_FALLBACK === "1";

  if (explicit === "huggingface") return hasHf ? "huggingface" : "heuristic";
  if (explicit === "openai") return hasOpenAi ? "openai" : "heuristic";
  if (explicit === "heuristic") return "heuristic";

  // Auto mode: HF-first, OpenAI only if explicitly allowed.
  if (hasHf) return "huggingface";
  if (hasOpenAi && allowOpenAiFallback) return "openai";
  return "heuristic";
}

async function runOpenAiStrategy(
  userMsg: string,
  apiKey: string
): Promise<Strategy | null> {
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    timeout: 30_000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    console.error("OpenAI error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) return null;
  const parsed = safeJsonParse(text);
  if (!parsed) return null;
  return {
    ...(parsed as Omit<Strategy, "source" | "provider">),
    source: "ai",
    provider: "openai",
  };
}

async function runHuggingFaceStrategy(
  userMsg: string,
  token: string
): Promise<Strategy | null> {
  const model =
    process.env.HF_STRATEGY_MODEL ?? "Qwen/Qwen2.5-7B-Instruct";

  const prompt =
    `${SYSTEM_PROMPT}\n\n` +
    "Return ONLY valid JSON.\n\n" +
    userMsg;

  const res = await fetchWithTimeout(
    `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
    {
      method: "POST",
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 900,
          temperature: 0.2,
          return_full_text: false,
        },
        options: { wait_for_model: true },
      }),
    }
  );

  if (!res.ok) {
    console.error("HF error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  let text = "";
  if (Array.isArray(data) && data[0]?.generated_text) {
    text = String(data[0].generated_text).trim();
  } else if (data?.generated_text) {
    text = String(data.generated_text).trim();
  } else {
    console.error("HF unexpected payload:", data);
    return null;
  }

  const parsed = safeJsonParse(text);
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
    const tonnage = purchaserInput.demand.required_tonnes;
    const months = purchaserInput.demand.planning_horizon_months;

    const userMsg = buildUserMessage(
      benchmarks,
      headlines,
      tonnage,
      months,
      landedCost
    );
    const provider = resolveProvider();

    // --- Compute unified signal (non-blocking) ---
    let unifiedSignal: UnifiedSignal | null = null;
    try {
      // Get heuristic baseline return
      const heuristicBaseResult = heuristicStrategy(benchmarks, tonnage, months);
      const heuristicReturn = heuristicBaseResult.signal === "STRONG_BUY" ? 0.03
        : heuristicBaseResult.signal === "BUY" ? 0.015
        : heuristicBaseResult.signal === "AVOID" ? -0.02
        : 0;

      // Try sentiment analysis on headlines
      const sentimentResult = await analyzeHeadlineSentiment(
        headlines.map(h => ({ title: h.title, summary: h.summary ?? "" }))
      ).catch(() => null);

      unifiedSignal = computeUnifiedSignal({
        model_return: null, // TODO: integrate prediction model when available in same request
        model_confidence: null,
        llm_return: null, // Filled by AI strategy if it runs
        llm_confidence: null,
        llm_reasoning: null,
        heuristic_return: heuristicReturn,
        heuristic_signal: heuristicBaseResult.signal,
        sentiment_score: sentimentResult?.aggregate_score ?? null,
      });
    } catch { /* non-fatal */ }

    const quota = checkAiQuota(req);
    const allHeaders = { ...rateLimit.headers, ...quota.headers };

    // If quota exhausted, skip AI and go straight to heuristic
    if (provider !== "heuristic" && quota.degraded_to_heuristic) {
      console.warn(`[strategy] Quota exceeded for request — degrading to heuristic. Reason: ${quota.reason}`);
      const result = heuristicStrategy(benchmarks, tonnage, months, landedCost);
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
        return applyRateLimitHeaders(NextResponse.json(strategy), allHeaders);
      }
    }

    if (provider === "openai" && process.env.OPENAI_API_KEY) {
      const strategy = await runOpenAiStrategy(userMsg, process.env.OPENAI_API_KEY);
      if (strategy) {
        recordAiUsage(req);
        return applyRateLimitHeaders(NextResponse.json(strategy), allHeaders);
      }
    }

    const heuristicResult = heuristicStrategy(benchmarks, tonnage, months, landedCost);
    if (unifiedSignal) {
      heuristicResult.signal = unifiedSignal.signal;
      heuristicResult.confidence = Math.round(unifiedSignal.confidence * 100);
      (heuristicResult as unknown as Record<string, unknown>).decision_drivers = unifiedSignal.decision_drivers;
      (heuristicResult as unknown as Record<string, unknown>).predicted_return = unifiedSignal.predicted_return;
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
