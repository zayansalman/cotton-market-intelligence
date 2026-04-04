import { NextResponse } from "next/server";
import type { PricePoint, Benchmarks, PricesResponse } from "@/lib/types";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { safeErrorResponse, fetchWithTimeout } from "@/lib/api-security";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";

interface YFQuote {
  timestamp: number[];
  indicators: {
    quote: Array<{ close: (number | null)[] }>;
  };
}

export async function GET(req: Request) {
  const abuse = checkAbuse(req);
  if (abuse.blocked) return abuseBlockedResponse(abuse);

  const rateLimit = evaluateRequestRateLimit(req, "prices");
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit);
  }

  try {
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
        NextResponse.json(
          { error: "Yahoo Finance API unavailable" },
          { status: 502 }
        ),
        rateLimit.headers
      );
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0] as YFQuote | undefined;
    if (!result) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "No data returned" }, { status: 502 }),
        rateLimit.headers
      );
    }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;

    const rawPrices: number[] = [];
    const dates: string[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      const price = c > 5 ? c / 100 : c;
      rawPrices.push(price);
      dates.push(new Date(timestamps[i] * 1000).toISOString().slice(0, 10));
    }

    const n = rawPrices.length;
    if (n < 10) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Insufficient data" }, { status: 502 }),
        rateLimit.headers
      );
    }

    const ma = (arr: number[], window: number, idx: number): number | null => {
      if (idx < window - 1) return null;
      let sum = 0;
      for (let j = idx - window + 1; j <= idx; j++) sum += arr[j];
      return sum / window;
    };

    const prices: PricePoint[] = rawPrices.map((close, i) => ({
      date: dates[i],
      close: Math.round(close * 10000) / 10000,
      ma50: ma(rawPrices, 50, i)
        ? Math.round(ma(rawPrices, 50, i)! * 10000) / 10000
        : null,
      ma200: ma(rawPrices, 200, i)
        ? Math.round(ma(rawPrices, 200, i)! * 10000) / 10000
        : null,
    }));

    const current = rawPrices[n - 1];
    const y1 = rawPrices.slice(-Math.min(252, n));
    const y5 = rawPrices.slice(-Math.min(1260, n));

    const pctRank = (arr: number[], val: number) =>
      arr.filter((x) => x < val).length / arr.length;

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = (arr: number[]) => {
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
    };

    const returns: number[] = [];
    for (let i = 1; i < rawPrices.length; i++) {
      returns.push(rawPrices[i] / rawPrices[i - 1] - 1);
    }

    const vol = (rets: number[]) => std(rets) * Math.sqrt(252) * 100;

    const change = (lookback: number) =>
      n >= lookback
        ? ((current / rawPrices[n - lookback]) - 1) * 100
        : 0;

    const benchmarks: Benchmarks = {
      current_price: Math.round(current * 10000) / 10000,
      price_date: dates[n - 1],
      change_30d_pct: Math.round(change(22) * 100) / 100,
      change_90d_pct: Math.round(change(66) * 100) / 100,
      pct_rank_1y: Math.round(pctRank(y1, current) * 10000) / 10000,
      pct_rank_5y: Math.round(pctRank(y5, current) * 10000) / 10000,
      z_score_1y:
        std(y1) > 0
          ? Math.round(((current - mean(y1)) / std(y1)) * 100) / 100
          : 0,
      vol_30d_ann:
        Math.round(vol(returns.slice(-Math.min(22, returns.length))) * 10) / 10,
      vol_90d_ann:
        Math.round(vol(returns.slice(-Math.min(66, returns.length))) * 10) / 10,
      ma_50d: prices[n - 1].ma50 ?? current,
      ma_200d: prices[n - 1].ma200 ?? current,
      above_ma_50d: current > (prices[n - 1].ma50 ?? current),
      above_ma_200d: current > (prices[n - 1].ma200 ?? current),
      high_1y: Math.round(Math.max(...y1) * 10000) / 10000,
      low_1y: Math.round(Math.min(...y1) * 10000) / 10000,
    };

    const response: PricesResponse = {
      // Keep ~5 years so UI can offer buyer-friendly time windows.
      prices: prices.slice(-1260),
      benchmarks,
    };

    return applyRateLimitHeaders(NextResponse.json(response), rateLimit.headers);
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "prices"),
      rateLimit.headers
    );
  }
}
