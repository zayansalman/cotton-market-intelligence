import { describe, expect, it } from "vitest";
import {
  COTTON_ANALYST_PROMPT_REGISTRY,
  COTTON_NEWS_ANALYSIS_SYSTEM_PROMPT,
  COTTON_PRICE_PREDICTION_SYSTEM_PROMPT,
  COTTON_PROCUREMENT_STRATEGY_SYSTEM_PROMPT,
  COTTON_QUANT_FORECAST_SYSTEM_PROMPT,
} from "./prompts";

describe("cotton analyst prompt registry", () => {
  it("exposes the runtime cotton analyst system prompts in one place", () => {
    expect(Object.keys(COTTON_ANALYST_PROMPT_REGISTRY).sort()).toEqual([
      "newsAnalysis",
      "pricePrediction",
      "procurementStrategy",
      "quantForecast",
    ]);
  });

  it("keeps analyst prompts focused on cotton-market decisions", () => {
    for (const prompt of Object.values(COTTON_ANALYST_PROMPT_REGISTRY)) {
      expect(prompt.toLowerCase()).toContain("cotton");
      expect(prompt.toLowerCase()).not.toContain("pull request");
      expect(prompt.toLowerCase()).not.toContain("code reviewer");
    }
  });

  it("requires structured JSON outputs from each analyst prompt", () => {
    expect(COTTON_PRICE_PREDICTION_SYSTEM_PROMPT).toContain("Return ONLY valid JSON");
    expect(COTTON_PROCUREMENT_STRATEGY_SYSTEM_PROMPT).toContain("Return ONLY a JSON object");
    expect(COTTON_NEWS_ANALYSIS_SYSTEM_PROMPT).toContain("Return ONLY a JSON object");
    expect(COTTON_QUANT_FORECAST_SYSTEM_PROMPT).toContain("Return ONLY a JSON object");
  });
});
