/**
 * /api/backtest — Run walk-forward backtest of heuristic strategy
 * against historical Cotton #2 prices.
 *
 * GET ?tonnage=2000&months=6&step_months=1
 */

import { NextResponse } from "next/server";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { safeErrorResponse, fetchWithTimeout } from "@/lib/api-security";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";
import { runBacktest } from "@/lib/engine/backtest";

interface YFQuote {
  timestamp: number[];
  indicators: {
    quote: Array<{ close: (number | null)[] }>;
  };
}

function toNum(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(req: Request) {
  const abuse = checkAbuse(req);
  if (abuse.blocked) return abuseBlockedResponse(abuse);

  const rateLimit = evaluateRequestRateLimit(req, "backtest");
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

  try {
    const { searchParams } = new URL(req.url);
    const tonnage = toNum(searchParams.get("tonnage"), 2000, 100, 100_000);
    const months = toNum(searchParams.get("months"), 6, 1, 12);
    const stepMonths = toNum(searchParams.get("step_months"), 1, 1, 6);

    // Fetch 5 years of price history (same as /api/prices)
    const now = Math.floor(Date.now() / 1000);
    const fiveYearsAgo = now - 5 * 365 * 24 * 3600;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/CT%3DF?period1=${fiveYearsAgo}&period2=${now}&interval=1d`;

    const res = await fetchWithTimeout(url, {
      timeout: 15_000,
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Price data unavailable" }, { status: 502 }),
        rateLimit.headers
      );
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0] as YFQuote | undefined;
    if (!result) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "No price data returned" }, { status: 502 }),
        rateLimit.headers
      );
    }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;

    const prices: number[] = [];
    const dates: string[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      prices.push(c > 5 ? c / 100 : c);
      dates.push(new Date(timestamps[i] * 1000).toISOString().slice(0, 10));
    }

    if (prices.length < 300) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Insufficient history for backtest" }, { status: 502 }),
        rateLimit.headers
      );
    }

    const backtestResult = runBacktest(prices, dates, {
      tonnage,
      months,
      step_months: stepMonths,
    });

    return applyRateLimitHeaders(
      NextResponse.json(backtestResult),
      rateLimit.headers
    );
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "backtest"),
      rateLimit.headers
    );
  }
}
