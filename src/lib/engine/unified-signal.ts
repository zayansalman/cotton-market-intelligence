/**
 * Unified prediction signal helper for the target all-source ensemble (#40).
 *
 * The live strategy route currently calls this with the available heuristic,
 * sentiment, and news-analysis inputs. Model and LLM forecast inputs are
 * supported here but not yet fully wired into `/api/strategy`.
 *
 * Target ensemble weighting:
 * - Model forecast: 40% (walk-forward validated, most data)
 * - LLM analyst: 20% (qualitative context, news interpretation)
 * - Benchmarks/heuristic: 25% (simple, robust baseline)
 * - Sentiment: 15% (weakest signal but adds non-price information)
 */

import type { Strategy } from "@/lib/types";
import type { NewsAnalysis } from "@/lib/hf/news-analysis";

export interface UnifiedSignal {
  /** Ensemble direction. */
  direction: "up" | "down" | "flat";
  /** Ensemble predicted return. */
  predicted_return: number;
  /** Ensemble confidence (0-1). */
  confidence: number;
  /** Whether news analysis overrode the statistical signal. */
  news_override: boolean;
  /** What each source contributed. */
  decision_drivers: DecisionDriver[];
  /** Final signal mapped to strategy signal. */
  signal: Strategy["signal"];
}

export interface DecisionDriver {
  source: string;
  weight: number;
  direction: "up" | "down" | "flat";
  magnitude: number;
  reasoning: string;
}

const WEIGHTS = {
  model: 0.40,
  llm: 0.20,
  heuristic: 0.25,
  sentiment: 0.15,
};

interface SignalInput {
  /** Model forecast return (from walk-forward champion). null if unavailable. */
  model_return: number | null;
  model_confidence: number | null;
  /** LLM forecast return. null if unavailable. */
  llm_return: number | null;
  llm_confidence: number | null;
  llm_reasoning: string | null;
  /** Heuristic signal from benchmarks. */
  heuristic_return: number;
  heuristic_signal: Strategy["signal"];
  /** Sentiment score (-1 to +1). null if unavailable. */
  sentiment_score: number | null;
  /** Deep LLM news analysis with forward-looking reasoning. null if unavailable. */
  news_analysis: NewsAnalysis | null;
}

export function computeUnifiedSignal(input: SignalInput): UnifiedSignal {
  const drivers: DecisionDriver[] = [];
  let weightedReturn = 0;
  let totalWeight = 0;

  // Model forecast
  if (input.model_return != null) {
    const dir = input.model_return > 0.005 ? "up" : input.model_return < -0.005 ? "down" : "flat";
    drivers.push({
      source: "Quantitative Model",
      weight: WEIGHTS.model,
      direction: dir as "up" | "down" | "flat",
      magnitude: input.model_return,
      reasoning: `Walk-forward champion predicts ${(input.model_return * 100).toFixed(2)}% return (confidence: ${((input.model_confidence ?? 0.5) * 100).toFixed(0)}%)`,
    });
    weightedReturn += WEIGHTS.model * input.model_return;
    totalWeight += WEIGHTS.model;
  }

  // LLM analyst
  if (input.llm_return != null) {
    const dir = input.llm_return > 0.005 ? "up" : input.llm_return < -0.005 ? "down" : "flat";
    drivers.push({
      source: "AI Analyst (LLM)",
      weight: WEIGHTS.llm,
      direction: dir as "up" | "down" | "flat",
      magnitude: input.llm_return,
      reasoning: input.llm_reasoning ?? `LLM predicts ${(input.llm_return * 100).toFixed(2)}% return`,
    });
    weightedReturn += WEIGHTS.llm * input.llm_return;
    totalWeight += WEIGHTS.llm;
  }

  // Heuristic
  const heuristicReturn = input.heuristic_return;
  const hDir = heuristicReturn > 0.005 ? "up" : heuristicReturn < -0.005 ? "down" : "flat";
  drivers.push({
    source: "Statistical Heuristic",
    weight: WEIGHTS.heuristic,
    direction: hDir as "up" | "down" | "flat",
    magnitude: heuristicReturn,
    reasoning: `Percentile/z-score heuristic: ${input.heuristic_signal}`,
  });
  weightedReturn += WEIGHTS.heuristic * heuristicReturn;
  totalWeight += WEIGHTS.heuristic;

  // Sentiment
  if (input.sentiment_score != null) {
    const sentReturn = input.sentiment_score * 0.02; // Scale sentiment to ~±2% max influence
    const sDir = sentReturn > 0.005 ? "up" : sentReturn < -0.005 ? "down" : "flat";
    drivers.push({
      source: "News Sentiment",
      weight: WEIGHTS.sentiment,
      direction: sDir as "up" | "down" | "flat",
      magnitude: sentReturn,
      reasoning: `Headline sentiment: ${input.sentiment_score > 0.1 ? "bullish" : input.sentiment_score < -0.1 ? "bearish" : "neutral"} (${input.sentiment_score.toFixed(2)})`,
    });
    weightedReturn += WEIGHTS.sentiment * sentReturn;
    totalWeight += WEIGHTS.sentiment;
  }

  // News analysis — deep LLM reasoning about geopolitical/supply/demand context
  // This has override power: if the LLM identifies a strong forward-looking
  // reason that contradicts statistical signals, it can override them.
  let newsOverride = false;
  const newsAnalysis = input.news_analysis;

  if (newsAnalysis) {
    const newsDir = newsAnalysis.outlook === "bullish" ? "up"
      : newsAnalysis.outlook === "bearish" ? "down" : "flat";

    // News analysis gets 20% weight in the ensemble (taken from heuristic and sentiment)
    const newsWeight = 0.20;
    drivers.push({
      source: "News Analysis (LLM)",
      weight: newsWeight,
      direction: newsDir as "up" | "down" | "flat",
      magnitude: newsAnalysis.implied_return,
      reasoning: newsAnalysis.reasoning
        + (newsAnalysis.key_events.length > 0
          ? ` Key events: ${newsAnalysis.key_events.map(e => e.event).join("; ")}`
          : ""),
    });
    weightedReturn += newsWeight * newsAnalysis.implied_return;
    totalWeight += newsWeight;

    // OVERRIDE LOGIC: If LLM says news should override statistical signals
    // and confidence is high enough, shift the ensemble strongly toward news view
    if (newsAnalysis.override_statistical && newsAnalysis.confidence >= 0.6) {
      newsOverride = true;
      // Add extra weight to news direction (effectively 40% total news influence)
      weightedReturn += 0.20 * newsAnalysis.implied_return;
      totalWeight += 0.20;
      drivers.push({
        source: "News Override",
        weight: 0.20,
        direction: newsDir as "up" | "down" | "flat",
        magnitude: newsAnalysis.implied_return,
        reasoning: `Statistical signal overridden: ${newsAnalysis.override_reasoning}`,
      });
    }
  }

  // Normalize
  const ensembleReturn = totalWeight > 0 ? weightedReturn / totalWeight : 0;
  const direction: UnifiedSignal["direction"] =
    ensembleReturn > 0.005 ? "up" : ensembleReturn < -0.005 ? "down" : "flat";

  // Map to strategy signal
  let signal: Strategy["signal"];
  if (ensembleReturn > 0.02) signal = "STRONG_BUY";
  else if (ensembleReturn > 0.005) signal = "BUY";
  else if (ensembleReturn < -0.02) signal = "AVOID";
  else if (ensembleReturn < -0.005) signal = "AVOID";
  else signal = "HOLD";

  // Confidence from agreement of sources
  const directions = drivers.map((d) => d.direction);
  const agreement = directions.filter((d) => d === direction).length / directions.length;
  let confidence = Math.min(0.95, agreement * 0.7 + 0.3);

  // News override boosts or reduces confidence
  if (newsOverride && newsAnalysis) {
    confidence = Math.min(0.95, confidence + 0.1 * newsAnalysis.confidence);
  }

  return {
    direction,
    predicted_return: Math.round(ensembleReturn * 100000) / 100000,
    confidence: Math.round(confidence * 100) / 100,
    news_override: newsOverride,
    decision_drivers: drivers,
    signal,
  };
}
