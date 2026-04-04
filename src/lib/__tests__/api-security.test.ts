/**
 * Abuse-oriented security tests for API hardening (#22).
 */

import { describe, it, expect } from "vitest";
import { safeParseBody, safeErrorResponse } from "../api-security";
import { parseStrategyRequest } from "../schemas/strategy-request";

/* ------------------------------------------------------------------ */
/*  safeParseBody                                                      */
/* ------------------------------------------------------------------ */

describe("safeParseBody", () => {
  const makeRequest = (body: string, contentLength?: string): Request => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (contentLength) headers["content-length"] = contentLength;
    return new Request("http://localhost/api/strategy", {
      method: "POST",
      headers,
      body,
    });
  };

  it("rejects oversized content-length header", async () => {
    const req = makeRequest("{}", "999999");
    const result = await safeParseBody(req);
    expect(result).toHaveProperty("status", 413);
  });

  it("rejects oversized body even without content-length", async () => {
    const huge = JSON.stringify({ data: "x".repeat(600_000) });
    const req = makeRequest(huge);
    const result = await safeParseBody(req);
    expect(result).toHaveProperty("status", 413);
  });

  it("rejects invalid JSON", async () => {
    const req = makeRequest("not json at all");
    const result = await safeParseBody(req);
    expect(result).toHaveProperty("status", 400);
  });

  it("rejects array body", async () => {
    const req = makeRequest("[1, 2, 3]");
    const result = await safeParseBody(req);
    expect(result).toHaveProperty("status", 400);
  });

  it("rejects null body", async () => {
    const req = makeRequest("null");
    const result = await safeParseBody(req);
    expect(result).toHaveProperty("status", 400);
  });

  it("accepts valid JSON object", async () => {
    const req = makeRequest('{"tonnage": 2000}');
    const result = await safeParseBody(req);
    expect(result).not.toHaveProperty("status");
    expect(result).toHaveProperty("tonnage", 2000);
  });
});

/* ------------------------------------------------------------------ */
/*  safeErrorResponse                                                  */
/* ------------------------------------------------------------------ */

describe("safeErrorResponse", () => {
  it("does not leak error messages", async () => {
    const err = new Error("OPENAI_API_KEY is invalid: sk-abc123...");
    const res = safeErrorResponse(err, "strategy");
    const body = await res.json();
    expect(body.error).not.toContain("OPENAI_API_KEY");
    expect(body.error).not.toContain("sk-abc");
    expect(body.error).toBe("Strategy generation failed. Please try again.");
  });

  it("returns 500 status", () => {
    const res = safeErrorResponse(new Error("boom"), "prices");
    expect(res.status).toBe(500);
  });

  it("handles non-Error throws", async () => {
    const res = safeErrorResponse("random string", "headlines");
    const body = await res.json();
    expect(body.error).toBe("News feed temporarily unavailable.");
  });
});

/* ------------------------------------------------------------------ */
/*  Schema validation: malformed benchmarks                            */
/* ------------------------------------------------------------------ */

describe("strategy-request schema rejects malformed benchmarks", () => {
  const validBenchmarks = {
    current_price: 0.72,
    price_date: "2026-04-01",
    change_30d_pct: -2.1,
    change_90d_pct: 5.3,
    pct_rank_1y: 0.45,
    pct_rank_5y: 0.38,
    z_score_1y: -0.5,
    vol_30d_ann: 22.5,
    vol_90d_ann: 25.1,
    ma_50d: 0.73,
    ma_200d: 0.71,
    above_ma_50d: false,
    above_ma_200d: true,
    high_1y: 0.85,
    low_1y: 0.62,
  };

  const validHeadline = {
    title: "Cotton prices steady",
    summary: "Markets remain calm",
    link: "https://example.com/article",
    published: "2026-04-01",
  };

  it("rejects NaN in benchmarks", () => {
    const result = parseStrategyRequest({
      tonnage: 2000,
      months: 6,
      benchmarks: { ...validBenchmarks, current_price: NaN },
      headlines: [validHeadline],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects Infinity in benchmarks", () => {
    const result = parseStrategyRequest({
      tonnage: 2000,
      months: 6,
      benchmarks: { ...validBenchmarks, vol_30d_ann: Infinity },
      headlines: [validHeadline],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects pct_rank_1y outside 0-1", () => {
    const result = parseStrategyRequest({
      tonnage: 2000,
      months: 6,
      benchmarks: { ...validBenchmarks, pct_rank_1y: 1.5 },
      headlines: [validHeadline],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing benchmarks fields", () => {
    const result = parseStrategyRequest({
      tonnage: 2000,
      months: 6,
      benchmarks: { current_price: 0.72 },
      headlines: [validHeadline],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects extra fields in benchmarks (strict mode)", () => {
    const result = parseStrategyRequest({
      tonnage: 2000,
      months: 6,
      benchmarks: { ...validBenchmarks, malicious_field: "drop table" },
      headlines: [validHeadline],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects headline arrays > 50 items", () => {
    const tooMany = Array.from({ length: 51 }, () => validHeadline);
    const result = parseStrategyRequest({
      tonnage: 2000,
      months: 6,
      benchmarks: validBenchmarks,
      headlines: tooMany,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects headlines with oversized strings", () => {
    const result = parseStrategyRequest({
      tonnage: 2000,
      months: 6,
      benchmarks: validBenchmarks,
      headlines: [{ ...validHeadline, title: "x".repeat(501) }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts valid legacy request", () => {
    const result = parseStrategyRequest({
      tonnage: 2000,
      months: 6,
      benchmarks: validBenchmarks,
      headlines: [validHeadline],
    });
    expect(result.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Schema validation: purchaser-input array limits                    */
/* ------------------------------------------------------------------ */

describe("purchaser-input array and string limits", () => {
  const validBenchmarks = {
    current_price: 0.72,
    price_date: "2026-04-01",
    change_30d_pct: -2.1,
    change_90d_pct: 5.3,
    pct_rank_1y: 0.45,
    pct_rank_5y: 0.38,
    z_score_1y: -0.5,
    vol_30d_ann: 22.5,
    vol_90d_ann: 25.1,
    ma_50d: 0.73,
    ma_200d: 0.71,
    above_ma_50d: false,
    above_ma_200d: true,
    high_1y: 0.85,
    low_1y: 0.62,
  };

  it("rejects too many preferred_origins", () => {
    const result = parseStrategyRequest({
      strategy_input_version: 2,
      purchaser_input: {
        demand: { required_tonnes: 2000, planning_horizon_months: 6 },
        quality: { preferred_origins: Array.from({ length: 21 }, () => "US") },
      },
      benchmarks: validBenchmarks,
      headlines: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects too-long supplier names", () => {
    const result = parseStrategyRequest({
      strategy_input_version: 2,
      purchaser_input: {
        demand: { required_tonnes: 2000, planning_horizon_months: 6 },
        finance: { approved_suppliers: ["x".repeat(201)] },
      },
      benchmarks: validBenchmarks,
      headlines: [],
    });
    expect(result.ok).toBe(false);
  });
});
