/**
 * /api/forecast-history — Returns stored predictions and performance metrics.
 *
 * On each request:
 * 1. Lazy-resolve any predictions whose target_date has passed but actual_price is NULL
 * 2. Return pending + resolved predictions for chart overlays
 * 3. Return aggregate accuracy metrics for the resolved subset
 *
 * GET ?limit=100&current_date=YYYY-MM-DD
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
import {
  normalizeForecastPoints,
  selectNonOverlappingPreviousForecasts,
} from "@/lib/forecast-history";

export const maxDuration = 30;

type PredictionDirection = "up" | "down" | "flat";

interface PredictionToResolve {
  id: string;
  target_date: string;
  predicted_price: number | string;
  direction: PredictionDirection;
  current_price: number | string;
}

interface PredictionHistoryRow {
  created_at: string;
  prediction_date: string;
  current_price: number | string;
  horizon: string;
  target_date: string;
  predicted_price: number | string;
  forecast_points: unknown;
  direction: PredictionDirection;
  actual_price: number | string | null;
  direction_correct: boolean | null;
  error_pct: number | string | null;
  model_id: string;
  model_name: string | null;
}

interface PredictionPerformanceMetrics {
  total: number;
  resolved: number;
  pending: number;
  direction_accuracy: number | null;
  mean_absolute_error_pct: number | null;
  latest_absolute_error_pct: number | null;
}

const emptyMetrics: PredictionPerformanceMetrics = {
  total: 0,
  resolved: 0,
  pending: 0,
  direction_accuracy: null,
  mean_absolute_error_pct: null,
  latest_absolute_error_pct: null,
};

function toFiniteNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function buildMetrics(rows: PredictionHistoryRow[]): PredictionPerformanceMetrics {
  const resolved = rows.filter((row) => toFiniteNumber(row.actual_price) !== null);
  const directionRows = resolved.filter((row) => row.direction_correct !== null);
  const correct = directionRows.filter((row) => row.direction_correct).length;
  const absoluteErrors = resolved
    .map((row) => {
      const error = toFiniteNumber(row.error_pct);
      return error === null ? null : Math.abs(error);
    })
    .filter((error): error is number => error !== null);
  const latestResolved = [...resolved].sort((a, b) =>
    b.target_date.localeCompare(a.target_date)
  )[0];
  const latestError = latestResolved
    ? toFiniteNumber(latestResolved.error_pct)
    : null;

  return {
    total: rows.length,
    resolved: resolved.length,
    pending: rows.length - resolved.length,
    direction_accuracy: directionRows.length
      ? round(correct / directionRows.length, 4)
      : null,
    mean_absolute_error_pct: absoluteErrors.length
      ? round(
          absoluteErrors.reduce((sum, error) => sum + error, 0) /
            absoluteErrors.length,
          3
        )
      : null,
    latest_absolute_error_pct:
      latestError === null ? null : round(Math.abs(latestError), 3),
  };
}

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

    // Find the closest trading day around target_date.
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
        NextResponse.json({
          configured: false,
          predictions: [],
          metrics: emptyMetrics,
          message: "Supabase not configured",
        }),
        rateLimit.headers
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 500);
    const requestedCurrentDate = searchParams.get("current_date");

    // Step 1: Lazy-resolve unresolved predictions whose target_date has passed
    const today = new Date().toISOString().slice(0, 10);
    const { data: unresolved } = await supabase
      .from("predictions")
      .select("id, target_date, predicted_price, direction, current_price")
      .is("actual_price", null)
      .lte("target_date", today)
      .limit(20); // Batch limit to avoid long Yahoo Finance calls

    const rowsToResolve = (unresolved ?? []) as PredictionToResolve[];
    if (rowsToResolve.length > 0) {
      // Fetch actual prices in parallel (max 20 concurrent)
      const updates = await Promise.all(
        rowsToResolve.map(async (row) => {
          const actual = await fetchActualPrice(row.target_date);
          if (actual === null) return null;

          const currentPrice = toFiniteNumber(row.current_price);
          const predictedPrice = toFiniteNumber(row.predicted_price);
          if (currentPrice === null || predictedPrice === null || currentPrice <= 0) {
            return null;
          }

          const directionCorrect =
            (row.direction === "up" && actual > currentPrice) ||
            (row.direction === "down" && actual < currentPrice) ||
            (row.direction === "flat" &&
              Math.abs(actual - currentPrice) / currentPrice < 0.003);

          const errorPct =
            ((predictedPrice - actual) / actual) * 100;

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

    // Step 2: Return latest stored predictions, including pending future targets.
    const { data: history, error } = await supabase
      .from("predictions")
      .select(
        "created_at, prediction_date, current_price, horizon, target_date, predicted_price, forecast_points, direction, actual_price, direction_correct, error_pct, model_id, model_name"
      )
      .order("target_date", { ascending: false })
      .limit(limit);

    if (error) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Failed to fetch predictions" }, { status: 500 }),
        rateLimit.headers
      );
    }

    const rows = ((history ?? []) as PredictionHistoryRow[]).reverse();
    const metrics = buildMetrics(rows);
    const predictions = rows.map((row) => ({
      date: row.target_date,
      target_date: row.target_date,
      prediction_date: row.prediction_date,
      created_at: row.created_at,
      horizon: row.horizon,
      current_price: toFiniteNumber(row.current_price),
      predicted_price: toFiniteNumber(row.predicted_price) ?? 0,
      actual_price: toFiniteNumber(row.actual_price),
      direction_correct: row.direction_correct,
      error_pct: toFiniteNumber(row.error_pct),
      model_id: row.model_id,
      model_name: row.model_name,
    }));
    const currentMarketDate =
      requestedCurrentDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedCurrentDate)
        ? requestedCurrentDate
        : today;
    const previousForecasts = selectNonOverlappingPreviousForecasts(rows, {
      currentMarketDate,
      maxCount: 2,
    })
      .map((row) => {
        const points = normalizeForecastPoints(row.forecast_points);
        const predictedPrice =
          toFiniteNumber(row.predicted_price) ?? points.at(-1)?.predicted_price ?? 0;
        return {
          id: `${row.model_id}-${row.horizon}-${row.prediction_date}`,
          label: `Saved ${row.prediction_date}`,
          as_of_date: row.prediction_date,
          target_date: row.target_date,
          model_name: row.model_name ?? row.model_id,
          direction: row.direction,
          predicted_price: predictedPrice,
          actual_price: toFiniteNumber(row.actual_price),
          error_pct: toFiniteNumber(row.error_pct),
          direction_correct: row.direction_correct,
          reasoning: `${row.model_name ?? row.model_id} forecast generated on ${row.prediction_date}.`,
          points,
        };
      });

    return applyRateLimitHeaders(
      NextResponse.json({
        configured: true,
        predictions,
        previousForecasts,
        metrics,
      }),
      rateLimit.headers
    );
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "prices"),
      rateLimit.headers
    );
  }
}
