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
import { getSupabase } from "@/lib/supabase";
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

function baseUrlFrom(req: Request): string {
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

async function fetchInternalJson<T>(
  baseUrl: string,
  path: string,
  headers: HeadersInit
): Promise<T | null> {
  const res = await fetch(`${baseUrl}${path}`, { headers }).catch(() => null);
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
    const baseUrl = baseUrlFrom(req);
    const headers = {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
      "Accept-Language": "en",
    };
    const supabase = getSupabase();

    const result = await generateMarketPrediction({
      horizon,
      deps: {
        cache: supabase ? createSupabasePredictionCache(supabase) : null,
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

    const response = NextResponse.json(result.response);
    if (result.cacheHit) response.headers.set("X-CMI-Cache", "HIT");
    return applyRateLimitHeaders(response, rateLimit.headers);
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
