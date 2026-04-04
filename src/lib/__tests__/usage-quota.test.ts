/**
 * Usage quota and inference cost guardrail tests (#20).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkAiQuota,
  recordAiUsage,
  getUsageStats,
  _resetForTesting,
} from "../usage-quota";

function makeReq(ip = "1.2.3.4"): Request {
  return new Request("http://localhost/api/strategy", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  _resetForTesting();
  // Set tight limits for testing
  process.env.QUOTA_AI_DAILY_PER_IP = "3";
  process.env.QUOTA_AI_MONTHLY_PER_IP = "5";
  process.env.QUOTA_AI_GLOBAL_DAILY = "10";
  process.env.QUOTA_ALERT_THRESHOLD_PCT = "80";
});

describe("checkAiQuota", () => {
  it("allows first request", () => {
    const result = checkAiQuota(makeReq());
    expect(result.allowed).toBe(true);
    expect(result.degraded_to_heuristic).toBe(false);
  });

  it("enforces per-IP daily limit", () => {
    const req = makeReq("10.0.0.1");
    // Use up the quota
    for (let i = 0; i < 3; i++) {
      expect(checkAiQuota(req).allowed).toBe(true);
      recordAiUsage(req);
    }
    // 4th should be denied
    const result = checkAiQuota(req);
    expect(result.allowed).toBe(false);
    expect(result.degraded_to_heuristic).toBe(true);
    expect(result.reason).toContain("Daily AI quota exceeded");
    expect(result.remaining_daily).toBe(0);
  });

  it("enforces per-IP monthly limit", () => {
    process.env.QUOTA_AI_DAILY_PER_IP = "100"; // high daily so monthly triggers first
    const req = makeReq("10.0.0.2");
    for (let i = 0; i < 5; i++) {
      expect(checkAiQuota(req).allowed).toBe(true);
      recordAiUsage(req);
    }
    const result = checkAiQuota(req);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Monthly AI quota exceeded");
    expect(result.remaining_monthly).toBe(0);
  });

  it("enforces global daily limit", () => {
    process.env.QUOTA_AI_DAILY_PER_IP = "100";
    process.env.QUOTA_AI_MONTHLY_PER_IP = "1000";
    // 10 different IPs each make 1 request
    for (let i = 0; i < 10; i++) {
      const req = makeReq(`192.168.1.${i}`);
      expect(checkAiQuota(req).allowed).toBe(true);
      recordAiUsage(req);
    }
    // 11th request from new IP should be denied
    const result = checkAiQuota(makeReq("192.168.1.99"));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Global daily AI budget");
  });

  it("does not count across different IPs for per-IP limits", () => {
    const req1 = makeReq("10.0.0.1");
    const req2 = makeReq("10.0.0.2");
    for (let i = 0; i < 3; i++) {
      recordAiUsage(req1);
    }
    // IP 2 should still be allowed
    expect(checkAiQuota(req2).allowed).toBe(true);
  });

  it("returns quota headers", () => {
    const result = checkAiQuota(makeReq());
    expect(result.headers["X-Quota-Daily-Remaining"]).toBeDefined();
    expect(result.headers["X-Quota-Monthly-Remaining"]).toBeDefined();
  });
});

describe("getUsageStats", () => {
  it("tracks global usage and unique IPs", () => {
    recordAiUsage(makeReq("10.0.0.1"));
    recordAiUsage(makeReq("10.0.0.2"));
    recordAiUsage(makeReq("10.0.0.1"));

    const stats = getUsageStats();
    expect(stats.global_daily).toBe(3);
    expect(stats.unique_ips_today).toBe(2);
    expect(stats.config.daily_limit).toBe(3);
  });
});

describe("recordAiUsage", () => {
  it("increments counters", () => {
    const req = makeReq("10.0.0.1");
    recordAiUsage(req);
    recordAiUsage(req);
    const stats = getUsageStats();
    expect(stats.global_daily).toBe(2);
  });
});
