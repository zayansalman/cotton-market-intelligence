/**
 * /api/prediction - HTTP adapter for the reusable market prediction service.
 *
 * GET ?horizon=21d
 */

import { NextResponse } from "next/server";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/api-security";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";
import { checkAiQuota, recordAiUsage } from "@/lib/usage-quota";
import { reserveGlobalAiBudget } from "@/lib/ai-budget";
import { getSupabase } from "@/lib/supabase";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { createSupabasePredictionCache } from "@/lib/repositories/prediction-cache";
import type { Horizon } from "@/lib/models/types";
import {
  generateMarketPrediction,
  PredictionMarketDataUnavailableError,
  VALID_HORIZONS,
  type PredictionHeadline,
  type PredictionPriceData,
} from "@/lib/services/prediction-service";

function predictionHorizonFrom(req: Request): Horizon {
  const { searchParams } = new URL(req.url);
  const horizonParam = searchParams.get("horizon") ?? "21d";
  return VALID_HORIZONS.includes(horizonParam as Horizon)
    ? (horizonParam as Horizon)
    : "21d";
}

/**
 * Resolve the origin for internal self-fetches WITHOUT trusting the client
 * Host / X-Forwarded-Proto headers — those are attacker-controllable and
 * would let a spoofed `Host: evil.com` make the server fetch (and cache) data
 * from an arbitrary origin (SSRF + prediction-cache poisoning). Trust only
 * server-set config: an explicit APP_BASE_URL, Vercel's own VERCEL_URL, or an
 * exact-match allowlist for local/known deployment hosts.
 */
function resolveBaseUrl(req: Request): string {
  const configured =
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (configured) return configured.replace(/\/+$/, "");

  const host = req.headers.get("host") ?? "localhost:3000";
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
    return `http://${host}`;
  }
  const ALLOWED_HOSTS = new Set([
    "cmi-notebooks.vercel.app",
    "cmi-notebooks-dev.vercel.app",
  ]);
  if (ALLOWED_HOSTS.has(host)) return `https://${host}`;

  // Unknown/spoofed host with no trusted config — stay on loopback rather
  // than self-fetching an attacker-controlled origin.
  return "http://localhost:3000";
}

async function fetchInternalJson<T>(
  baseUrl: string,
  path: string,
  headers: HeadersInit
): Promise<T | null> {
  const res = await fetchWithTimeout(`${baseUrl}${path}`, {
    headers,
    timeout: 10_000,
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as T;
}

export async function GET(req: Request) {
  const abuse = checkAbuse(req);
  if (abuse.blocked) return abuseBlockedResponse(abuse);

  const rateLimit = evaluateRequestRateLimit(req, "prediction");
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

  try {
    const horizon = predictionHorizonFrom(req);
    const baseUrl = resolveBaseUrl(req);
    const headers = {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
      "Accept-Language": "en",
    };
    const supabase = getSupabase();

    // The prediction endpoint drives paid HF inference (sentiment + analyst
    // synthesis). Gate that spend behind the same AI usage quota as /strategy.
    const quota = checkAiQuota(req);

    const result = await generateMarketPrediction({
      horizon,
      allowAi: !quota.degraded_to_heuristic,
      deps: {
        cache: supabase ? createSupabasePredictionCache(supabase) : null,
        // Reserve the durable global AI budget only on a cache MISS about to
        // make paid calls (invoked from inside the service).
        reserveAiBudget: async () =>
          (await reserveGlobalAiBudget(supabase)).allowed,
        fetchPrices: () =>
          fetchInternalJson<PredictionPriceData>(baseUrl, "/api/prices", headers),
        fetchHeadlines: async () =>
          (await fetchInternalJson<PredictionHeadline[]>(
            baseUrl,
            "/api/headlines",
            headers
          )) ?? [],
      },
    });

    if (result.aiUsed) recordAiUsage(req);

    const response = NextResponse.json(result.response);
    if (result.cacheHit) response.headers.set("X-CMI-Cache", "HIT");
    return applyRateLimitHeaders(response, {
      ...rateLimit.headers,
      ...quota.headers,
    });
  } catch (e) {
    if (e instanceof PredictionMarketDataUnavailableError) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Market data unavailable" }, { status: 502 }),
        rateLimit.headers
      );
    }

    return applyRateLimitHeaders(
      safeErrorResponse(e, "prediction"),
      rateLimit.headers
    );
  }
}
