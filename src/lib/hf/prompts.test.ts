import { readFileSync } from "node:fs";
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

  it("wires runtime LLM callers to the centralized analyst prompts", () => {
    expect(readFileSync("src/lib/services/prediction-service.ts", "utf8")).toContain(
      "COTTON_PRICE_PREDICTION_SYSTEM_PROMPT"
    );
    expect(readFileSync("src/app/api/strategy/route.ts", "utf8")).toContain(
      "COTTON_PROCUREMENT_STRATEGY_SYSTEM_PROMPT"
    );
    expect(readFileSync("src/lib/hf/news-analysis.ts", "utf8")).toContain(
      "COTTON_NEWS_ANALYSIS_SYSTEM_PROMPT"
    );
    expect(readFileSync("src/lib/hf/forecast.ts", "utf8")).toContain(
      "COTTON_QUANT_FORECAST_SYSTEM_PROMPT"
    );
  });

  it("keeps the GitHub review agent off runtime analyst config", () => {
    const workflow = readFileSync(".github/workflows/ai-review.yml", "utf8");
    expect(workflow).toContain("HF_REVIEW_TOKEN");
    expect(workflow).toContain("HF_REVIEW_MODEL");
    expect(workflow).not.toContain("secrets.HF_TOKEN");
    expect(workflow).not.toContain("COTTON_");
  });
});
