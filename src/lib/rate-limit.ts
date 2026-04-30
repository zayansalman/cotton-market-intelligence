import { NextResponse } from "next/server";

export interface RateLimitConfig {
  endpoint: string;
  windowMs: number;
  maxRequests: number;
  burstWindowMs: number;
  burstMax: number;
  cooldownMs: number;
}

interface BucketState {
  windowStartMs: number;
  requestCount: number;
  burstWindowStartMs: number;
  burstCount: number;
  blockedUntilMs: number;
}

interface InternalDecision {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
  retryAfterMs: number;
  reason: "ok" | "window_limit" | "burst_limit" | "cooldown";
}

export interface RateLimitHeaders {
  limit: string;
  remaining: string;
  reset: string;
  policy: string;
  retryAfter?: string;
}

export interface RequestRateLimitResult {
  allowed: boolean;
  headers: RateLimitHeaders;
  scope: "ip" | "user";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseIntEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function endpointKey(endpoint: string): string {
  return endpoint.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function buildConfig(
  endpoint: string,
  defaults: Omit<RateLimitConfig, "endpoint">
): RateLimitConfig {
  const key = endpointKey(endpoint);
  return {
    endpoint,
    windowMs: parseIntEnv(
      process.env[`RATE_LIMIT_${key}_WINDOW_MS`],
      defaults.windowMs,
      1000,
      24 * 60 * 60 * 1000
    ),
    maxRequests: parseIntEnv(
      process.env[`RATE_LIMIT_${key}_MAX_REQUESTS`],
      defaults.maxRequests,
      1,
      100_000
    ),
    burstWindowMs: parseIntEnv(
      process.env[`RATE_LIMIT_${key}_BURST_WINDOW_MS`],
      defaults.burstWindowMs,
      500,
      10 * 60 * 1000
    ),
    burstMax: parseIntEnv(
      process.env[`RATE_LIMIT_${key}_BURST_MAX`],
      defaults.burstMax,
      1,
      10_000
    ),
    cooldownMs: parseIntEnv(
      process.env[`RATE_LIMIT_${key}_COOLDOWN_MS`],
      defaults.cooldownMs,
      1000,
      60 * 60 * 1000
    ),
  };
}

export function getRateLimitConfig(endpoint: string): RateLimitConfig {
  const isProd = process.env.NODE_ENV === "production";
  const baseline = isProd
    ? {
        windowMs: 60_000,
        maxRequests: 100,
        burstWindowMs: 10_000,
        burstMax: 20,
        cooldownMs: 30_000,
      }
    : {
        windowMs: 60_000,
        maxRequests: 300,
        burstWindowMs: 10_000,
        burstMax: 60,
        cooldownMs: 5_000,
      };

  if (
    endpoint === "strategy" ||
    endpoint === "prediction" ||
    endpoint === "pipeline" ||
    endpoint === "backtest"
  ) {
    return buildConfig(endpoint, {
      ...baseline,
      maxRequests: isProd ? 20 : 120,
      burstMax: isProd ? 5 : 25,
      cooldownMs: isProd ? 60_000 : 5_000,
    });
  }

  if (endpoint === "headlines") {
    return buildConfig(endpoint, {
      ...baseline,
      maxRequests: isProd ? 90 : 240,
      burstMax: isProd ? 20 : 50,
      cooldownMs: isProd ? 20_000 : 5_000,
    });
  }

  if (endpoint === "prices") {
    return buildConfig(endpoint, {
      ...baseline,
      maxRequests: isProd ? 90 : 240,
      burstMax: isProd ? 20 : 50,
      cooldownMs: isProd ? 20_000 : 5_000,
    });
  }

  if (endpoint === "landed_cost") {
    return buildConfig(endpoint, {
      ...baseline,
      maxRequests: isProd ? 90 : 240,
      burstMax: isProd ? 20 : 50,
      cooldownMs: isProd ? 20_000 : 5_000,
    });
  }

  return buildConfig(endpoint, baseline);
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, BucketState>();

  reset(): void {
    this.buckets.clear();
  }

  check(
    key: string,
    config: RateLimitConfig,
    nowMs: number = Date.now()
  ): InternalDecision {
    const existing = this.buckets.get(key);
    const bucket: BucketState = existing ?? {
      windowStartMs: nowMs,
      requestCount: 0,
      burstWindowStartMs: nowMs,
      burstCount: 0,
      blockedUntilMs: 0,
    };

    if (nowMs < bucket.blockedUntilMs) {
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: bucket.blockedUntilMs,
        retryAfterMs: bucket.blockedUntilMs - nowMs,
        reason: "cooldown",
      };
    }

    if (nowMs - bucket.windowStartMs >= config.windowMs) {
      bucket.windowStartMs = nowMs;
      bucket.requestCount = 0;
    }

    if (nowMs - bucket.burstWindowStartMs >= config.burstWindowMs) {
      bucket.burstWindowStartMs = nowMs;
      bucket.burstCount = 0;
    }

    bucket.requestCount += 1;
    bucket.burstCount += 1;

    const windowExceeded = bucket.requestCount > config.maxRequests;
    const burstExceeded = bucket.burstCount > config.burstMax;

    if (windowExceeded || burstExceeded) {
      bucket.blockedUntilMs = nowMs + config.cooldownMs;
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: bucket.blockedUntilMs,
        retryAfterMs: config.cooldownMs,
        reason: windowExceeded ? "window_limit" : "burst_limit",
      };
    }

    this.buckets.set(key, bucket);
    return {
      allowed: true,
      remaining: Math.max(0, config.maxRequests - bucket.requestCount),
      resetAtMs: bucket.windowStartMs + config.windowMs,
      retryAfterMs: 0,
      reason: "ok",
    };
  }
}

export const apiRateLimiter = new InMemoryRateLimiter();

function policyHeader(config: RateLimitConfig): string {
  return `requests=${config.maxRequests};window=${Math.ceil(config.windowMs / 1000)};burst=${config.burstMax};burst_window=${Math.ceil(config.burstWindowMs / 1000)};cooldown=${Math.ceil(config.cooldownMs / 1000)}`;
}

function decisionToHeaders(
  config: RateLimitConfig,
  decision: InternalDecision
): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    limit: String(config.maxRequests),
    remaining: String(decision.remaining),
    reset: String(Math.ceil(decision.resetAtMs / 1000)),
    policy: policyHeader(config),
  };
  if (!decision.allowed) {
    headers.retryAfter = String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000)));
  }
  return headers;
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

function userIdentity(req: Request): string | null {
  return (
    req.headers.get("x-user-id") ??
    req.headers.get("x-user-email") ??
    req.headers.get("x-auth-sub")
  );
}

export function evaluateRequestRateLimit(
  req: Request,
  endpoint: string,
  nowMs?: number
): RequestRateLimitResult {
  const config = getRateLimitConfig(endpoint);
  const ip = clientIp(req);
  const ipDecision = apiRateLimiter.check(
    `${endpoint}:ip:${ip}`,
    config,
    nowMs
  );

  if (!ipDecision.allowed) {
    return {
      allowed: false,
      headers: decisionToHeaders(config, ipDecision),
      scope: "ip",
    };
  }

  const user = userIdentity(req);
  if (user) {
    const userDecision = apiRateLimiter.check(
      `${endpoint}:user:${user}`,
      config,
      nowMs
    );
    if (!userDecision.allowed) {
      return {
        allowed: false,
        headers: decisionToHeaders(config, userDecision),
        scope: "user",
      };
    }

    return {
      allowed: true,
      headers: {
        limit: String(config.maxRequests),
        remaining: String(
          Math.min(
            Number(ipDecision.remaining),
            Number(userDecision.remaining)
          )
        ),
        reset: String(
          Math.ceil(Math.min(ipDecision.resetAtMs, userDecision.resetAtMs) / 1000)
        ),
        policy: policyHeader(config),
      },
      scope: "user",
    };
  }

  return {
    allowed: true,
    headers: decisionToHeaders(config, ipDecision),
    scope: "ip",
  };
}

export function applyRateLimitHeaders(
  response: NextResponse,
  headers: RateLimitHeaders
): NextResponse {
  response.headers.set("X-RateLimit-Limit", headers.limit);
  response.headers.set("X-RateLimit-Remaining", headers.remaining);
  response.headers.set("X-RateLimit-Reset", headers.reset);
  response.headers.set("X-RateLimit-Policy", headers.policy);
  if (headers.retryAfter) {
    response.headers.set("Retry-After", headers.retryAfter);
  }
  return response;
}

export function rateLimitExceededResponse(result: RequestRateLimitResult): NextResponse {
  const response = NextResponse.json(
    {
      error: "Too many requests",
      code: "RATE_LIMITED",
      scope: result.scope,
      retry_after_seconds: Number(result.headers.retryAfter ?? "1"),
    },
    { status: 429 }
  );
  return applyRateLimitHeaders(response, result.headers);
}
