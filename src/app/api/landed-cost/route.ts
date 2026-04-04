import { NextResponse } from "next/server";
import type { LandedCostResponse } from "@/lib/types";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/api-security";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";

const LB_PER_TONNE = 2204.62262185;

function toNum(
  value: string | null,
  fallback: number,
  min?: number,
  max?: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}

function buildScenario({
  futuresUsdLb,
  basisCentsLb,
  freightUsdT,
  insurancePct,
  dutyPct,
  fxRate,
  wastagePct,
}: {
  futuresUsdLb: number;
  basisCentsLb: number;
  freightUsdT: number;
  insurancePct: number;
  dutyPct: number;
  fxRate: number;
  wastagePct: number;
}) {
  const landedCottonUsdLb = futuresUsdLb + basisCentsLb / 100;
  const cottonUsdT = landedCottonUsdLb * LB_PER_TONNE;
  const insuranceUsdT = (cottonUsdT + freightUsdT) * (insurancePct / 100);
  const dutyUsdT = (cottonUsdT + freightUsdT + insuranceUsdT) * (dutyPct / 100);
  const preWastageUsdT = cottonUsdT + freightUsdT + insuranceUsdT + dutyUsdT;
  const effectiveUsdT = preWastageUsdT / (1 - wastagePct / 100);
  const effectiveBdtKg = (effectiveUsdT * fxRate) / 1000;

  return {
    cotton_usd_t: Math.round(cottonUsdT * 100) / 100,
    freight_usd_t: Math.round(freightUsdT * 100) / 100,
    insurance_usd_t: Math.round(insuranceUsdT * 100) / 100,
    duty_usd_t: Math.round(dutyUsdT * 100) / 100,
    pre_wastage_usd_t: Math.round(preWastageUsdT * 100) / 100,
    effective_usd_t: Math.round(effectiveUsdT * 100) / 100,
    effective_bdt_kg: Math.round(effectiveBdtKg * 100) / 100,
  };
}

export async function GET(req: Request) {
  const abuse = checkAbuse(req);
  if (abuse.blocked) return abuseBlockedResponse(abuse);

  const rateLimit = evaluateRequestRateLimit(req, "landed_cost");
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit);
  }

  try {
    const { searchParams } = new URL(req.url);

    const futuresUsdLb = toNum(searchParams.get("futures_usd_lb"), 0.75, 0.01, 5);
    const lowFuturesUsdLb = toNum(
      searchParams.get("low_futures_usd_lb"),
      futuresUsdLb,
      0.01,
      5
    );
    const highFuturesUsdLb = toNum(
      searchParams.get("high_futures_usd_lb"),
      futuresUsdLb,
      0.01,
      5
    );
    const basisCentsLb = toNum(searchParams.get("basis_cents_lb"), 7, -25, 50);
    const freightUsdT = toNum(searchParams.get("freight_usd_t"), 85, 0, 1000);
    const insurancePct = toNum(searchParams.get("insurance_pct"), 0.5, 0, 10);
    const dutyPct = toNum(searchParams.get("duty_pct"), 1, 0, 50);
    const fxRate = toNum(searchParams.get("fx_bdt_usd"), 117, 60, 300);
    const wastagePct = toNum(searchParams.get("wastage_pct"), 1.5, 0, 15);

    const shared = {
      basisCentsLb,
      freightUsdT,
      insurancePct,
      dutyPct,
      fxRate,
      wastagePct,
    };

    const current = buildScenario({ futuresUsdLb, ...shared });
    const low = buildScenario({ futuresUsdLb: lowFuturesUsdLb, ...shared });
    const high = buildScenario({ futuresUsdLb: highFuturesUsdLb, ...shared });

    const payload: LandedCostResponse = {
      assumptions: {
        futures_usd_lb: futuresUsdLb,
        basis_cents_lb: basisCentsLb,
        freight_usd_t: freightUsdT,
        insurance_pct: insurancePct,
        duty_pct: dutyPct,
        fx_bdt_usd: fxRate,
        wastage_pct: wastagePct,
      },
      breakdown: current,
      sensitivity: {
        low_1y: {
          futures_usd_lb: lowFuturesUsdLb,
          effective_usd_t: low.effective_usd_t,
          effective_bdt_kg: low.effective_bdt_kg,
        },
        current: {
          futures_usd_lb: futuresUsdLb,
          effective_usd_t: current.effective_usd_t,
          effective_bdt_kg: current.effective_bdt_kg,
        },
        high_1y: {
          futures_usd_lb: highFuturesUsdLb,
          effective_usd_t: high.effective_usd_t,
          effective_bdt_kg: high.effective_bdt_kg,
        },
      },
    };

    return applyRateLimitHeaders(NextResponse.json(payload), rateLimit.headers);
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "landed_cost"),
      rateLimit.headers
    );
  }
}
