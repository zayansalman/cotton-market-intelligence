import { afterEach, describe, expect, it } from "vitest";
import {
  apiRateLimiter,
  InMemoryRateLimiter,
  evaluateRequestRateLimit,
  getRateLimitConfig,
} from "./rate-limit";

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/strategy", {
    headers: new Headers(headers),
  });
}

describe("InMemoryRateLimiter", () => {
  it("allows requests within normal window and decrements remaining", () => {
    const limiter = new InMemoryRateLimiter();
    const cfg = {
      endpoint: "strategy",
      windowMs: 60_000,
      maxRequests: 3,
      burstWindowMs: 5_000,
      burstMax: 3,
      cooldownMs: 10_000,
    };

    const one = limiter.check("k", cfg, 0);
    const two = limiter.check("k", cfg, 1000);
    const three = limiter.check("k", cfg, 2000);

    expect(one.allowed).toBe(true);
    expect(two.allowed).toBe(true);
    expect(three.allowed).toBe(true);
    expect(three.remaining).toBe(0);
  });

  it("blocks when burst threshold is exceeded", () => {
    const limiter = new InMemoryRateLimiter();
    const cfg = {
      endpoint: "strategy",
      windowMs: 60_000,
      maxRequests: 100,
      burstWindowMs: 5_000,
      burstMax: 2,
      cooldownMs: 10_000,
    };

    limiter.check("burst", cfg, 0);
    limiter.check("burst", cfg, 100);
    const denied = limiter.check("burst", cfg, 200);

    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("burst_limit");
    expect(denied.retryAfterMs).toBe(10_000);
  });

  it("enforces cooldown and allows again after cooldown elapsed", () => {
    const limiter = new InMemoryRateLimiter();
    const cfg = {
      endpoint: "strategy",
      windowMs: 60_000,
      maxRequests: 1,
      burstWindowMs: 5_000,
      burstMax: 5,
      cooldownMs: 3_000,
    };

    limiter.check("cool", cfg, 0);
    const denied = limiter.check("cool", cfg, 10);
    const stillDenied = limiter.check("cool", cfg, 1000);
    const allowedAgain = limiter.check("cool", cfg, 61_000);

    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("window_limit");
    expect(stillDenied.allowed).toBe(false);
    expect(stillDenied.reason).toBe("cooldown");
    expect(allowedAgain.allowed).toBe(true);
  });
});

describe("evaluateRequestRateLimit", () => {
  afterEach(() => {
    apiRateLimiter.reset();
    delete process.env.RATE_LIMIT_STRATEGY_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_STRATEGY_WINDOW_MS;
    delete process.env.RATE_LIMIT_STRATEGY_BURST_MAX;
    delete process.env.RATE_LIMIT_STRATEGY_BURST_WINDOW_MS;
    delete process.env.RATE_LIMIT_STRATEGY_COOLDOWN_MS;
  });

  it("supports env-configured limits", () => {
    process.env.RATE_LIMIT_STRATEGY_MAX_REQUESTS = "7";
    process.env.RATE_LIMIT_STRATEGY_WINDOW_MS = "15000";
    process.env.RATE_LIMIT_STRATEGY_BURST_MAX = "3";
    process.env.RATE_LIMIT_STRATEGY_BURST_WINDOW_MS = "2000";
    process.env.RATE_LIMIT_STRATEGY_COOLDOWN_MS = "9000";

    const cfg = getRateLimitConfig("strategy");
    expect(cfg.maxRequests).toBe(7);
    expect(cfg.windowMs).toBe(15000);
    expect(cfg.burstMax).toBe(3);
    expect(cfg.burstWindowMs).toBe(2000);
    expect(cfg.cooldownMs).toBe(9000);
  });

  it("uses per-user scope when user identity header is present", () => {
    process.env.RATE_LIMIT_STRATEGY_MAX_REQUESTS = "1";
    process.env.RATE_LIMIT_STRATEGY_BURST_MAX = "10";

    const reqA = buildRequest({
      "x-forwarded-for": "1.1.1.1",
      "x-user-id": "alice",
    });
    const reqB = buildRequest({
      "x-forwarded-for": "2.2.2.2",
      "x-user-id": "alice",
    });
    const first = evaluateRequestRateLimit(reqA, "strategy", 0);
    const second = evaluateRequestRateLimit(reqB, "strategy", 1);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.scope).toBe("user");
    expect(Number(second.headers.retryAfter)).toBeGreaterThan(0);
  });
});
