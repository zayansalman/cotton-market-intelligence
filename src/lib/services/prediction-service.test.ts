import { describe, expect, it } from "vitest";
import type { Benchmarks } from "../types";
import {
  generateMarketPrediction,
  PredictionMarketDataUnavailableError,
  type PredictionResponse,
} from "./prediction-service";

const MOCK_BENCHMARKS: Benchmarks = {
  current_price: 0.72,
  price_date: "2026-03-28",
  change_30d_pct: -2.1,
  change_90d_pct: 5.3,
  pct_rank_1y: 0.45,
  pct_rank_5y: 0.38,
  z_score_1y: -0.3,
  vol_30d_ann: 22,
  vol_90d_ann: 25,
  ma_50d: 0.73,
  ma_200d: 0.71,
  above_ma_50d: false,
  above_ma_200d: true,
  high_1y: 0.85,
  low_1y: 0.62,
};

const CACHED_RESPONSE: PredictionResponse = {
  version: 6,
  generated_at: "2026-03-28T00:00:00.000Z",
  current_price: 0.72,
  current_date: "2026-03-28",
  forecasts: [{
    horizon: "21d",
    predicted_return: 0.01,
    predicted_price: 0.7272,
    lower_price: 0.69,
    upper_price: 0.76,
    confidence_level: 0.95,
    direction: "up",
  }],
  model: {
    id: "llm_synthesis",
    name: "LLM analyst synthesis (Qwen 2.5 7B)",
    kind: "llm_synthesis",
    train_samples: null,
    test_samples: null,
    test_mae: null,
    test_rmse: null,
    direction_accuracy: null,
    validation_note: "cached",
  },
  reasoning: "Cached analyst view.",
  confidence: 70,
  risk: "Cached risk.",
  methodology: null,
  key_factors: [],
  top_drivers: [],
  forecast_evidence: [],
  evidence_assessment: [],
  cross_market_signals: [],
  sentiment: null,
  hf_forecasts: [],
};

describe("generateMarketPrediction", () => {
  it("returns a same-day cached forecast before fetching expensive context", async () => {
    let fetchedHeadlines = false;
    let wroteCache = false;

    const result = await generateMarketPrediction({
      horizon: "21d",
      deps: {
        fetchPrices: async () => ({ benchmarks: MOCK_BENCHMARKS }),
        fetchHeadlines: async () => {
          fetchedHeadlines = true;
          return [];
        },
        fetchCrossMarketQuotes: async () => {
          throw new Error("cross-market fetch should be skipped");
        },
        cache: {
          read: async () => CACHED_RESPONSE,
          write: async () => {
            wroteCache = true;
          },
        },
      },
    });

    expect(result.cacheHit).toBe(true);
    expect(result.response).toBe(CACHED_RESPONSE);
    expect(fetchedHeadlines).toBe(false);
    expect(wroteCache).toBe(false);
  });

  it("reports market data unavailability before orchestration", async () => {
    await expect(
      generateMarketPrediction({
        horizon: "21d",
        deps: {
          fetchPrices: async () => null,
          fetchHeadlines: async () => [],
        },
      })
    ).rejects.toBeInstanceOf(PredictionMarketDataUnavailableError);
  });
});
