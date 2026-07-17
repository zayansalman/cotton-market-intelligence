/**
 * HF financial sentiment analysis on cotton/commodity headlines.
 *
 * Uses mrm8488/distilroberta-finetuned-financial-news-sentiment-analysis
 * (262K downloads, fine-tuned on financial_phrasebank).
 *
 * Returns positive/negative/neutral scores per headline,
 * plus an aggregate market sentiment score.
 */

import { fetchWithTimeout } from "../fetch-with-timeout";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HeadlineSentiment {
  title: string;
  label: "positive" | "negative" | "neutral";
  score: number;
  positive: number;
  negative: number;
  neutral: number;
}

export interface MarketSentiment {
  /** Aggregate score: -1 (bearish) to +1 (bullish). */
  aggregate_score: number;
  /** Human-readable label. */
  label: "bullish" | "bearish" | "neutral";
  /** Confidence in the label (0-1). */
  confidence: number;
  /** Number of headlines analyzed. */
  n_headlines: number;
  positive_pct: number;
  negative_pct: number;
  neutral_pct: number;
  /** Per-headline breakdowns (top 10 most impactful). */
  top_headlines: HeadlineSentiment[];
}

/* ------------------------------------------------------------------ */
/*  HF Inference API call                                              */
/* ------------------------------------------------------------------ */

const MODEL = "mrm8488/distilroberta-finetuned-financial-news-sentiment-analysis";

interface HFClassificationResult {
  label: string;
  score: number;
}

const SENTIMENT_PER_BATCH_TIMEOUT_MS = 15_000;
const SENTIMENT_DEFAULT_BUDGET_MS = 20_000;
const SENTIMENT_MIN_BATCH_MS = 2_000;

async function classifyBatch(
  texts: string[],
  token: string,
  timeoutMs: number = SENTIMENT_PER_BATCH_TIMEOUT_MS
): Promise<HFClassificationResult[][]> {
  const res = await fetchWithTimeout(
    `https://router.huggingface.co/hf-inference/models/${MODEL}`,
    {
      method: "POST",
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: texts,
        options: { wait_for_model: true },
      }),
    }
  );

  if (!res.ok) {
    console.error(`[hf-sentiment] API error: ${res.status}`);
    return [];
  }

  const data = await res.json();
  // Response is array of arrays: [[{label, score}, ...], ...]
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return data as HFClassificationResult[][];
  }
  // Single input returns flat array
  if (Array.isArray(data) && data[0]?.label) {
    return [data as HFClassificationResult[]];
  }
  return [];
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Analyze sentiment of cotton/commodity headlines using HF model.
 * Falls back gracefully if HF_TOKEN is missing.
 */
export async function analyzeHeadlineSentiment(
  headlines: { title: string; summary: string }[],
  opts: { deadlineAt?: number; budgetMs?: number } = {}
): Promise<MarketSentiment | null> {
  const token = process.env.HF_TOKEN;
  if (!token) {
    console.warn("[hf-sentiment] HF_TOKEN not set, skipping sentiment analysis");
    return null;
  }

  if (headlines.length === 0) return null;

  const deadlineAt =
    opts.deadlineAt ?? Date.now() + (opts.budgetMs ?? SENTIMENT_DEFAULT_BUDGET_MS);

  // Combine title + summary for richer context, limit to 25 headlines
  const texts = headlines
    .slice(0, 25)
    .map((h) => `${h.title}. ${h.summary}`.slice(0, 300));

  try {
    // Batch in groups of 10 (API limit)
    const allResults: HeadlineSentiment[] = [];
    for (let i = 0; i < texts.length; i += 10) {
      const remaining = deadlineAt - Date.now();
      // Stop starting new batches once the shared budget is nearly gone, so
      // sentiment never eats the time the strategy/heuristic fallback needs.
      if (remaining < SENTIMENT_MIN_BATCH_MS) {
        console.warn("[hf-sentiment] budget exhausted — returning partial/none");
        break;
      }
      const batch = texts.slice(i, i + 10);
      const batchTitles = headlines.slice(i, i + 10);
      const results = await classifyBatch(
        batch,
        token,
        Math.min(SENTIMENT_PER_BATCH_TIMEOUT_MS, remaining)
      );

      for (let j = 0; j < results.length; j++) {
        const scores = results[j];
        if (!scores || scores.length === 0) continue;

        const positive = scores.find((s) => s.label === "positive")?.score ?? 0;
        const negative = scores.find((s) => s.label === "negative")?.score ?? 0;
        const neutral = scores.find((s) => s.label === "neutral")?.score ?? 0;

        const topLabel = scores.reduce((a, b) => (a.score > b.score ? a : b));

        allResults.push({
          title: batchTitles[j].title,
          label: topLabel.label as "positive" | "negative" | "neutral",
          score: topLabel.score,
          positive,
          negative,
          neutral,
        });
      }
    }

    if (allResults.length === 0) return null;

    // Compute aggregate
    const posCount = allResults.filter((r) => r.label === "positive").length;
    const negCount = allResults.filter((r) => r.label === "negative").length;
    const neuCount = allResults.filter((r) => r.label === "neutral").length;
    const total = allResults.length;

    // Weighted score: positive=+1, neutral=0, negative=-1
    const aggScore =
      allResults.reduce((sum, r) => sum + r.positive - r.negative, 0) / total;

    const label: MarketSentiment["label"] =
      aggScore > 0.1 ? "bullish" : aggScore < -0.1 ? "bearish" : "neutral";

    // Sort by magnitude of sentiment (most opinionated first)
    const sorted = [...allResults].sort(
      (a, b) => Math.abs(b.positive - b.negative) - Math.abs(a.positive - a.negative)
    );

    return {
      aggregate_score: Math.round(aggScore * 1000) / 1000,
      label,
      confidence: Math.abs(aggScore),
      n_headlines: total,
      positive_pct: Math.round((posCount / total) * 100),
      negative_pct: Math.round((negCount / total) * 100),
      neutral_pct: Math.round((neuCount / total) * 100),
      top_headlines: sorted.slice(0, 10),
    };
  } catch (e) {
    console.error("[hf-sentiment] Analysis failed:", e);
    return null;
  }
}
