/**
 * LLM-powered geopolitical and news-aware reasoning (#47).
 *
 * Uses HF Inference API to deeply analyze headlines for forward-looking
 * price implications — geopolitical events, supply disruptions, demand
 * shifts, policy changes. Returns structured reasoning that the strategy
 * engine uses to override or confirm statistical signals.
 *
 * Key insight: a statistical signal saying "AVOID" (price at 99th pct)
 * can be wrong if news indicates supply disruption → price will go higher.
 * The LLM bridges this gap by reasoning about causality, not just levels.
 */

import { fetchWithTimeout } from "@/lib/api-security";
import type { Benchmarks, Headline } from "@/lib/types";
import type { MarketSentiment } from "./sentiment";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface NewsAnalysis {
  /** Forward-looking outlook from news context. */
  outlook: "bullish" | "bearish" | "neutral";
  /** Confidence in the outlook (0-1). */
  confidence: number;
  /** Implied return from news analysis (-0.05 to +0.05). */
  implied_return: number;
  /** Whether news context should override statistical signals. */
  override_statistical: boolean;
  /** Why override is or isn't recommended. */
  override_reasoning: string;
  /** Key events identified and their implications. */
  key_events: NewsEvent[];
  /** Forward-looking reasoning summary. */
  reasoning: string;
}

export interface NewsEvent {
  event: string;
  category: "geopolitical" | "supply" | "demand" | "policy" | "weather" | "trade";
  price_impact: "bullish" | "bearish" | "neutral";
  time_horizon: string;
  reasoning: string;
}

/* ------------------------------------------------------------------ */
/*  Prompt                                                             */
/* ------------------------------------------------------------------ */

const NEWS_ANALYSIS_PROMPT = `You are a senior commodity analyst at a top-tier trading firm.
Analyze these cotton market headlines for FORWARD-LOOKING price implications.

CRITICAL RULES:
- Think about CAUSALITY, not just sentiment. "Price is high" is not bearish if supply disruption is coming.
- Consider second-order effects: India export ban → supply squeeze → price UP even if current price is high.
- Political instability in producing countries → supply risk → bullish for cotton.
- Trade wars/tariffs → demand disruption → direction depends on who is affected.
- Weather events in cotton regions → supply impact with 3-6 month lag.
- Look for signals that CONTRADICT the current price level — that's where the alpha is.

Return ONLY a JSON object:
{
  "outlook": "bullish" | "bearish" | "neutral",
  "confidence": <0.0-1.0>,
  "implied_return_pct": <expected % move over next 1-3 months>,
  "override_statistical": <true if news should override price-level signals>,
  "override_reasoning": "<why override is or isn't warranted>",
  "key_events": [
    {
      "event": "<what happened>",
      "category": "geopolitical" | "supply" | "demand" | "policy" | "weather" | "trade",
      "price_impact": "bullish" | "bearish" | "neutral",
      "time_horizon": "<when impact expected>",
      "reasoning": "<causal chain: event → mechanism → cotton price effect>"
    }
  ],
  "reasoning": "<2-3 sentence forward-looking summary for the procurement team>"
}`;

/* ------------------------------------------------------------------ */
/*  Analysis function                                                  */
/* ------------------------------------------------------------------ */

export async function analyzeNewsForStrategy(
  headlines: Headline[],
  benchmarks: Benchmarks,
  sentiment: MarketSentiment | null
): Promise<NewsAnalysis | null> {
  const token = process.env.HF_TOKEN;
  if (!token) return null;
  if (headlines.length === 0) return null;

  const model = process.env.HF_STRATEGY_MODEL ?? "Qwen/Qwen2.5-7B-Instruct";

  // Build context-rich prompt
  const headlineText = headlines
    .slice(0, 20)
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.summary?.slice(0, 200) ?? ""}`)
    .join("\n");

  const sentimentContext = sentiment
    ? `\nPre-computed sentiment: ${sentiment.label} (score: ${sentiment.aggregate_score.toFixed(2)}, ${sentiment.positive_pct}% positive, ${sentiment.negative_pct}% negative)`
    : "";

  const userMsg = `CURRENT MARKET STATE:
- Cotton #2: $${benchmarks.current_price.toFixed(4)}/lb
- 1Y Percentile: ${(benchmarks.pct_rank_1y * 100).toFixed(0)}% (${benchmarks.pct_rank_1y > 0.7 ? "EXPENSIVE" : benchmarks.pct_rank_1y < 0.3 ? "CHEAP" : "MID-RANGE"})
- 30d Change: ${benchmarks.change_30d_pct > 0 ? "+" : ""}${benchmarks.change_30d_pct.toFixed(1)}%
- 90d Change: ${benchmarks.change_90d_pct > 0 ? "+" : ""}${benchmarks.change_90d_pct.toFixed(1)}%
- Volatility: ${benchmarks.vol_30d_ann.toFixed(1)}% (30d ann.)
- Trend: ${benchmarks.above_ma_50d ? "above" : "below"} 50d MA, ${benchmarks.above_ma_200d ? "above" : "below"} 200d MA
${sentimentContext}

RECENT HEADLINES:
${headlineText}

Analyze these headlines for forward-looking cotton price implications. Focus on events that could MOVE prices over the next 1-3 months. Identify any reasons the statistical signals might be WRONG.`;

  try {
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
          inputs: `${NEWS_ANALYSIS_PROMPT}\n\n${userMsg}`,
          parameters: {
            max_new_tokens: 600,
            temperature: 0.2,
            return_full_text: false,
          },
          options: { wait_for_model: true },
        }),
      }
    );

    if (!res.ok) {
      console.error(`[news-analysis] HF error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    let text = "";
    if (Array.isArray(data) && data[0]?.generated_text) {
      text = String(data[0].generated_text).trim();
    } else if (data?.generated_text) {
      text = String(data.generated_text).trim();
    } else {
      return null;
    }

    // Parse JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      outlook?: string;
      confidence?: number;
      implied_return_pct?: number;
      override_statistical?: boolean;
      override_reasoning?: string;
      key_events?: NewsEvent[];
      reasoning?: string;
    };

    const outlook = (parsed.outlook === "bullish" || parsed.outlook === "bearish")
      ? parsed.outlook : "neutral";
    const impliedReturn = Number(parsed.implied_return_pct) || 0;

    return {
      outlook: outlook as NewsAnalysis["outlook"],
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      implied_return: Math.max(-0.05, Math.min(0.05, impliedReturn / 100)),
      override_statistical: Boolean(parsed.override_statistical),
      override_reasoning: String(parsed.override_reasoning ?? ""),
      key_events: Array.isArray(parsed.key_events)
        ? parsed.key_events.slice(0, 5).map((e) => ({
            event: String(e.event ?? ""),
            category: e.category ?? "trade",
            price_impact: e.price_impact ?? "neutral",
            time_horizon: String(e.time_horizon ?? "1-3 months"),
            reasoning: String(e.reasoning ?? ""),
          }))
        : [],
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch (e) {
    console.error("[news-analysis] Failed:", e);
    return null;
  }
}
