/**
 * /api/previous-forecast — Generates prior market forecast paths.
 *
 * This is not a procurement backtest. It simulates the forecast line the market
 * model would have drawn using only price data available as of ~N months ago.
 *
 * GET ?months_ago=1&horizon=21d
 */

import { NextResponse } from "next/server";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/api-security";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";
import type { PricePoint, Benchmarks } from "@/lib/types";

type Horizon = "5d" | "21d" | "63d";

const VALID_HORIZONS: Horizon[] = ["5d", "21d", "63d"];

interface PricesResponse {
  prices: PricePoint[];
}

function horizonDaysFor(horizon: Horizon): number {
  return horizon === "5d" ? 5 : horizon === "21d" ? 21 : 63;
}

function directionFromReturn(value: number): "up" | "down" | "flat" {
  if (value > 0.003) return "up";
  if (value < -0.003) return "down";
  return "flat";
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length
  );
}

function ma(values: number[], window: number, idx: number): number | null {
  if (idx < window - 1) return null;
  let sum = 0;
  for (let i = idx - window + 1; i <= idx; i++) sum += values[i];
  return sum / window;
}

function pctRank(values: number[], value: number): number {
  return values.filter((x) => x < value).length / values.length;
}

function buildBenchmarks(prices: PricePoint[]): Benchmarks {
  const closes = prices.map((point) => point.close);
  const n = closes.length;
  const current = closes[n - 1];
  const y1 = closes.slice(-Math.min(252, n));
  const y5 = closes.slice(-Math.min(1260, n));
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(closes[i] / closes[i - 1] - 1);
  }

  const change = (lookback: number) =>
    n >= lookback ? ((current / closes[n - lookback]) - 1) * 100 : 0;
  const vol = (rets: number[]) => std(rets) * Math.sqrt(252) * 100;
  const ma50 = ma(closes, 50, n - 1) ?? current;
  const ma200 = ma(closes, 200, n - 1) ?? current;
  const y1Std = std(y1);

  return {
    current_price: round(current, 4),
    price_date: prices[n - 1].date,
    change_30d_pct: round(change(22), 2),
    change_90d_pct: round(change(66), 2),
    pct_rank_1y: round(pctRank(y1, current), 4),
    pct_rank_5y: round(pctRank(y5, current), 4),
    z_score_1y: y1Std > 0 ? round((current - mean(y1)) / y1Std, 2) : 0,
    vol_30d_ann: round(vol(returns.slice(-Math.min(22, returns.length))), 1),
    vol_90d_ann: round(vol(returns.slice(-Math.min(66, returns.length))), 1),
    ma_50d: round(ma50, 4),
    ma_200d: round(ma200, 4),
    above_ma_50d: current > ma50,
    above_ma_200d: current > ma200,
    high_1y: round(Math.max(...y1), 4),
    low_1y: round(Math.min(...y1), 4),
  };
}

function addBusinessDays(startDate: string, days: number): string[] {
  const dates: string[] = [];
  const d = new Date(startDate + "T00:00:00Z");
  while (dates.length < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function forecastReturn(benchmarks: Benchmarks, horizon: Horizon): number {
  const momentum = benchmarks.change_30d_pct / 100;
  const meanReversion = (0.5 - benchmarks.pct_rank_1y) * 0.03;
  const trend =
    (benchmarks.above_ma_50d ? 0.008 : -0.008) +
    (benchmarks.above_ma_200d ? 0.006 : -0.006);
  const horizonScale = horizon === "5d" ? 0.45 : horizon === "63d" ? 1.35 : 1;
  const raw = (momentum * 0.58 + meanReversion * 0.32 + trend * 0.1) * horizonScale;
  const cap = horizon === "5d" ? 0.04 : horizon === "63d" ? 0.12 : 0.08;
  return Math.max(-cap, Math.min(cap, raw));
}

export async function GET(req: Request) {
  const abuse = checkAbuse(req);
  if (abuse.blocked) return abuseBlockedResponse(abuse);

  const rateLimit = evaluateRequestRateLimit(req, "prediction");
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

  try {
    const { searchParams } = new URL(req.url);
    const horizonParam = searchParams.get("horizon") ?? "21d";
    const horizon: Horizon = VALID_HORIZONS.includes(horizonParam as Horizon)
      ? (horizonParam as Horizon)
      : "21d";
    const monthsAgo = Math.min(
      Math.max(Number(searchParams.get("months_ago")) || 1, 1),
      6
    );

    const host = req.headers.get("host") ?? "localhost:3000";
    const proto =
      req.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https");
    const pricesRes = await fetch(`${proto}://${host}/api/prices`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        "Accept-Language": "en",
      },
    });

    if (!pricesRes.ok) {
      return applyRateLimitHeaders(
        NextResponse.json({ error: "Market data unavailable" }, { status: 502 }),
        rateLimit.headers
      );
    }

    const { prices } = (await pricesRes.json()) as PricesResponse;
    const horizonDays = horizonDaysFor(horizon);
    const cutoffOffset = 21 * monthsAgo;
    const cutoffIndex = prices.length - 1 - cutoffOffset;
    if (cutoffIndex < 252 || prices.length < cutoffIndex + horizonDays + 1) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "Insufficient history for previous forecast" },
          { status: 502 }
        ),
        rateLimit.headers
      );
    }

    const asOfPrices = prices.slice(0, cutoffIndex + 1);
    const benchmarks = buildBenchmarks(asOfPrices);
    const startPrice = benchmarks.current_price;
    const predictedReturn = forecastReturn(benchmarks, horizon);
    const predictedPrice = round(startPrice * (1 + predictedReturn), 4);
    const realizedVolInterval =
      startPrice *
      (benchmarks.vol_30d_ann / 100) *
      Math.sqrt(horizonDays / 252) *
      1.96;
    const lowerPrice = round(Math.max(0.01, predictedPrice - realizedVolInterval), 4);
    const upperPrice = round(predictedPrice + realizedVolInterval, 4);
    const futureDates =
      prices
        .slice(cutoffIndex + 1, cutoffIndex + 1 + horizonDays)
        .map((point) => point.date)
        .concat(addBusinessDays(prices[prices.length - 1].date, horizonDays))
        .slice(0, horizonDays);
    const targetDate = futureDates[futureDates.length - 1];
    const targetActual = prices.find((point) => point.date === targetDate)?.close ?? null;
    const direction = directionFromReturn(predictedReturn);
    const actualReturn =
      targetActual == null ? null : (targetActual - startPrice) / startPrice;
    const directionCorrect =
      actualReturn == null ? null : directionFromReturn(actualReturn) === direction;
    const errorPct =
      targetActual == null ? null : round(((predictedPrice - targetActual) / targetActual) * 100, 3);

    const pathDates = [benchmarks.price_date, ...futureDates];
    const points = pathDates.map((date, index) => {
      const t = index / (pathDates.length - 1);
      const eased = 1 - Math.pow(1 - t, 1.5);
      return {
        date,
        predicted_price: round(startPrice + (predictedPrice - startPrice) * eased, 4),
        lower_price: round(startPrice + (lowerPrice - startPrice) * eased, 4),
        upper_price: round(startPrice + (upperPrice - startPrice) * eased, 4),
        horizon,
      };
    });

    return applyRateLimitHeaders(
      NextResponse.json({
        forecasts: [
          {
            id: `as-of-${benchmarks.price_date}-${horizon}`,
            label: `As-of ${benchmarks.price_date}`,
            as_of_date: benchmarks.price_date,
            target_date: targetDate,
            model_name: "As-of market forecast",
            direction,
            predicted_price: predictedPrice,
            actual_price: targetActual == null ? null : round(targetActual, 4),
            error_pct: errorPct,
            direction_correct: directionCorrect,
            reasoning:
              `Generated using only Cotton #2 price history through ${benchmarks.price_date}. ` +
              `Signals: ${benchmarks.change_30d_pct.toFixed(1)}% 30d momentum, ` +
              `${(benchmarks.pct_rank_1y * 100).toFixed(0)}th percentile 1Y rank, ` +
              `${benchmarks.vol_30d_ann.toFixed(1)}% annualized 30d volatility.`,
            points,
          },
        ],
      }),
      rateLimit.headers
    );
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "prediction"),
      rateLimit.headers
    );
  }
}
