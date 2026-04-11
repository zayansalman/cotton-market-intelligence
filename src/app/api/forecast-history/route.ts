/**
 * /api/forecast-history — Returns resolved predictions (forecast vs actual).
 *
 * On each request:
 * 1. Lazy-resolve any predictions whose target_date has passed but actual_price is NULL
 * 2. Return all resolved predictions as BacktestPrediction[]
 *
 * GET ?limit=100
 */

import { NextResponse } from "next/server";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { safeErrorResponse, fetchWithTimeout } from "@/lib/api-security";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";
import { getSupabase } from "@/lib/supabase";

export const maxDuration = 30;

/* ------------------------------------------------------------------ */
/*  Fetch actual cotton price for a given date from Yahoo Finance      */
/* ------------------------------------------------------------------ */

async function fetchActualPrice(targetDate: string): Promise<number | null> {
  try {
    // Fetch a small window around the target date (±5 days for weekends/holidays)
    const target = new Date(targetDate + "T00:00:00Z");
    const from = Math.floor((target.getTime() - 7 * 86400_000) / 1000);
    const to = Math.floor((target.getTime() + 7 * 86400_000) / 1000);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/CT%3DF?period1=${from}&period2=${to}&interval=1d`;
    const res = await fetchWithTimeout(url, {
      timeout: 5_000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] =
      result.indicators?.quote?.[0]?.close ?? [];

    // Find the closest trading day on or before target_date
    let bestPrice: number | null = null;
    let bestDist = Infinity;
    const targetTs = target.getTime() / 1000;

    for (let i = 0; i < timestamps.length; i++) {
      const dist = Math.abs(timestamps[i] - targetTs);
      if (closes[i] != null && dist < bestDist) {
        bestDist = dist;
        bestPrice = closes[i];
      }
    }

    return bestPrice ? Math.round(bestPrice * 10000) / 10000 : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

export async function GET(req: Request) {
  const abuse = checkAbuse(req);
  if (abuse.blocked) return abuseBlockedResponse(abuse);

  const rateLimit = evaluateRequestRateLimit(req, "prices");
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

  try {
    const supabase = getSupabase();
    if (!supabase) {
      return applyRateLimitHeaders(
        NextResponse.json({ predictions: [], message: "Supabase not configured" }),
        rateLimit.headers
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 500);

    // Step 1: Lazy-resolve unresolved predictions whose target_date has passed
    const today = new Date().toISOString().slice(0, 10);
    const { data: unresolved } = await supabase
      .from("predictions")
      .select("id, target_date, predicted_price, direction, current_price")
      .is("actual_price", null)
      .lte("target_date", today)
      .limit(20); // Batch limit to avoid long Yahoo Finance calls

    if (unresolved && unresolved.length > 0) {
      // Fetch actual prices in parallel (max 20 concurrent)
      const updates = await Promise.all(
        unresolved.map(async (row) => {
          const actual = await fetchActualPrice(row.target_date);
          if (actual === null) return null;

          const directionCorrect =
            (row.direction === "up" && actual > row.current_price) ||
            (row.direction === "down" && actual < row.current_price) ||
            (row.direction === "flat" &&
              Math.abs(actual - row.current_price) / row.current_price < 0.003);

          const errorPct =
            ((row.predicted_price - actual) / actual) * 100;

          return {
            id: row.id,
            actual_price: actual,
            direction_correct: directionCorrect,
            error_pct: Math.round(errorPct * 1000) / 1000,
          };
        })
      );

      // Batch-update resolved predictions
      for (const update of updates) {
        if (!update) continue;
        await supabase
          .from("predictions")
          .update({
            actual_price: update.actual_price,
            direction_correct: update.direction_correct,
            error_pct: update.error_pct,
          })
          .eq("id", update.id);
      }
    }

    // Step 2: Return all resolved predictions
    const { data: resolved, error } = await supabase
      .from("predictions")
      .select("target_date, predicted_price, actual_price, direction_correct")
      .not("actual_price", "is", null)
      .order("target_date", { ascending: true })
      .limit(limit);

    if (error) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Failed to fetch predictions" }, { status: 500 }),
        rateLimit.headers
      );
    }

    // Map to BacktestPrediction shape
    const predictions = (resolved ?? []).map((row) => ({
      date: row.target_date,
      predicted_price: Number(row.predicted_price),
      actual_price: Number(row.actual_price),
      direction_correct: row.direction_correct ?? false,
    }));

    return applyRateLimitHeaders(
      NextResponse.json({ predictions }),
      rateLimit.headers
    );
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "prices"),
      rateLimit.headers
    );
  }
}
