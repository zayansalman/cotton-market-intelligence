/**
 * V2 heuristic strategy — wraps the existing heuristic logic and layers
 * constraint-aware pacing adjustments on top.
 *
 * Pure functions.  No React/Next imports.
 */

import type { PurchaserInput } from "@/lib/schemas/purchaser-input";
import type { Benchmarks, LandedCostResponse, MonthlyPlan } from "@/lib/types";
import type { StrategyV2 } from "./types";
import { evaluateConstraints } from "./constraints";
import { scoreFeasibility } from "./feasibility";

/**
 * Generate a constraint-aware heuristic strategy.
 *
 * When no advanced constraints are present (legacy input), this produces
 * output identical to the V1 heuristic.
 */
export function heuristicStrategyV2(
  input: PurchaserInput,
  benchmarks: Benchmarks,
  landedCost?: LandedCostResponse | null
): StrategyV2 {
  const tonnage = input.demand.required_tonnes;
  const months = input.demand.planning_horizon_months;
  const rank = benchmarks.pct_rank_1y;
  const z = benchmarks.z_score_1y;
  const vol = benchmarks.vol_30d_ann;

  // Signal determination (unchanged from V1)
  let signal: StrategyV2["signal"];
  let confidence: number;

  if (rank < 0.15 && z < -1) {
    signal = "STRONG_BUY";
    confidence = 80;
  } else if (rank < 0.3) {
    signal = "BUY";
    confidence = 65;
  } else if (rank > 0.8) {
    signal = "AVOID";
    confidence = 70;
  } else {
    signal = "HOLD";
    confidence = 50;
  }

  // Base allocation weights (V1 logic)
  const base = Array.from({ length: months }, (_, i) => {
    if (signal === "STRONG_BUY" || signal === "BUY")
      return Math.exp(-0.3 * i);
    if (signal === "AVOID") return Math.exp(0.3 * i);
    return 1;
  });

  // Volatility dampening (V1 logic)
  if (vol > 30) {
    for (let i = 0; i < base.length; i++) {
      base[i] = 0.7 * base[i] + 0.3;
    }
  }

  // V2: evaluate constraints and apply pacing multipliers
  const constraints = evaluateConstraints(input, benchmarks, months);
  for (let i = 0; i < months; i++) {
    base[i] *= constraints.pacing_multipliers[i];
  }

  // Normalize
  const sum = base.reduce((a, b) => a + b, 0);
  const weights = base.map((b) => b / sum);

  const signalText: Record<string, string> = {
    STRONG_BUY: "Front-loaded — price is historically cheap",
    BUY: "Moderately front-loaded — attractive entry",
    AVOID: "Back-loaded — price is expensive, defer",
    HOLD: "Uniform — no strong directional signal",
  };

  const plan: MonthlyPlan[] = weights.map((w, i) => ({
    month: i + 1,
    pct: Math.round(w * 1000) / 10,
    tonnes: Math.round(tonnage * w),
    rationale: signalText[signal],
  }));
  const lastPlan = plan[plan.length - 1];
  if (lastPlan) {
    const pctDrift =
      Math.round((100 - plan.reduce((total, p) => total + p.pct, 0)) * 10) /
      10;
    const tonneDrift =
      tonnage - plan.reduce((total, p) => total + p.tonnes, 0);
    lastPlan.pct = Math.round((lastPlan.pct + pctDrift) * 10) / 10;
    lastPlan.tonnes += tonneDrift;
  }

  // FIX #1: enforce an ABSOLUTE monthly receipt-capacity cap (tonnes/month) on
  // the final tonnage plan, AFTER normalization. Only runs when a cap is
  // configured, so the legacy / no-cap path above is left byte-for-byte
  // unchanged. Peaks are clipped and overflow redistributed to months with
  // headroom, preserving the front/back-loading order rather than inverting it.
  const receiptCap = input.timeline?.max_monthly_receipt_capacity_tonnes;
  if (receiptCap && receiptCap > 0) {
    const capacity = enforceReceiptCapacity(
      plan,
      weights,
      tonnage,
      receiptCap,
      months
    );
    if (capacity.feasible && capacity.clipped) {
      // Feasible but the cap clips peak pacing — flag it honestly (constraints.ts
      // only flags the infeasible case). No false "extended timeline" claim.
      constraints.binding_constraints.push(
        `Receipt capacity: ${receiptCap}t/month clips peak pacing`
      );
      constraints.constraint_risks.push(
        `Monthly receipts capped at ${receiptCap}t — peak-month volume is redistributed across the horizon to fit warehouse intake (front/back-loading flattened, not extended).`
      );
    }
  }

  // Summary text
  const above50 = benchmarks.above_ma_50d ? "above" : "below";
  const above200 = benchmarks.above_ma_200d ? "above" : "below";
  const px = benchmarks.current_price;
  const landedBdtKg = landedCost?.breakdown.effective_bdt_kg ?? null;
  const landedUsdT = landedCost?.breakdown.effective_usd_t ?? null;

  const summaries: Record<string, string> = {
    STRONG_BUY: `Price at $${px.toFixed(4)}/lb is historically cheap (${(rank * 100).toFixed(0)}% of 1Y range). Prioritise building inventory now.`,
    BUY: `Price at $${px.toFixed(4)}/lb is moderately attractive (${(rank * 100).toFixed(0)}% of 1Y range). Increase procurement pacing.`,
    AVOID: `Price at $${px.toFixed(4)}/lb is elevated (${(rank * 100).toFixed(0)}% of 1Y range). Minimise new exposure and defer.`,
    HOLD: `Price at $${px.toFixed(4)}/lb is mid-range (${(rank * 100).toFixed(0)}% of 1Y range). Maintain baseline procurement cadence.`,
  };

  const landedSummary =
    landedBdtKg != null && landedUsdT != null
      ? ` Current landed cost estimate is Tk ${landedBdtKg.toFixed(2)}/kg (~$${landedUsdT.toFixed(0)}/t effective).`
      : "";

  const feasibilityScore = scoreFeasibility(input, constraints);

  return {
    signal,
    confidence,
    executive_summary: summaries[signal] + landedSummary,
    market_analysis:
      `**Price context**: $${px.toFixed(4)}/lb sits at the ${(rank * 100).toFixed(0)}% percentile of its ` +
      `1-year range ($${benchmarks.low_1y.toFixed(4)} – $${benchmarks.high_1y.toFixed(4)}). ` +
      `Z-score: ${z.toFixed(2)}. Currently ${above50} 50d MA ($${benchmarks.ma_50d.toFixed(4)}) ` +
      `and ${above200} 200d MA ($${benchmarks.ma_200d.toFixed(4)}).\n\n` +
      `**Momentum**: 30-day change ${benchmarks.change_30d_pct > 0 ? "+" : ""}${benchmarks.change_30d_pct.toFixed(1)}%, ` +
      `90-day change ${benchmarks.change_90d_pct > 0 ? "+" : ""}${benchmarks.change_90d_pct.toFixed(1)}%.\n\n` +
      `**Volatility**: ${vol.toFixed(1)}% annualized (30d). ` +
      `${vol > 30 ? "Elevated — spread purchases to reduce execution risk." : "Normal regime."}\n\n` +
      (landedBdtKg != null && landedUsdT != null
        ? `**Bangladesh landed cost**: Effective cotton cost is approximately Tk ${landedBdtKg.toFixed(2)}/kg ` +
          `(~$${landedUsdT.toFixed(0)}/t) under current basis, freight, FX, insurance, duty, and wastage assumptions.\n\n`
        : "") +
      (constraints.binding_constraints.length > 0
        ? `**Binding constraints**: ${constraints.binding_constraints.join("; ")}.\n\n`
        : "") +
      `*Statistical heuristic. Connect a configured AI provider (Hugging Face-first) for richer news interpretation and strategic depth.*`,
    monthly_plan: plan,
    risk_factors: [
      "Statistical heuristic only — no news or fundamental analysis.",
      ...(vol > 30
        ? ["Elevated volatility increases execution risk on large orders."]
        : []),
      ...(rank > 0.8
        ? ["Price is near 1Y highs — basis risk is elevated."]
        : []),
      ...constraints.constraint_risks,
    ],
    next_actions: [
      "Set HF_TOKEN to enable AI-powered analysis (Hugging Face-first).",
      ...(landedBdtKg != null
        ? [
            `Run margin check versus yarn realization using Tk ${landedBdtKg.toFixed(2)}/kg landed cotton.`,
          ]
        : []),
      "Verify quality/count mix and wastage assumptions.",
      "Align roadmap with credit limits and warehouse capacity.",
    ],
    key_levels: {
      support: benchmarks.low_1y,
      resistance: benchmarks.high_1y,
      fair_value:
        Math.round(((benchmarks.ma_50d + benchmarks.ma_200d) / 2) * 10000) /
        10000,
    },
    source: "heuristic",
    provider: "heuristic",
    // V2 fields
    binding_constraints: constraints.binding_constraints,
    assumption_set: constraints.assumption_set,
    constraint_risks: constraints.constraint_risks,
    plan_feasibility_score: feasibilityScore,
  };
}

/* ------------------------------------------------------------------ */
/*  Receipt-capacity enforcement (fix #1)                              */
/* ------------------------------------------------------------------ */

interface CapacityStatus {
  /** Whether the required tonnage fits within cap × months over the horizon. */
  feasible: boolean;
  /** Whether the cap actually clipped one or more months' desired tonnage. */
  clipped: boolean;
  /** Tonnes that cannot be received within the horizon (0 when feasible). */
  shortfall: number;
}

/**
 * Enforce an absolute monthly receipt-capacity cap on the plan's tonnage,
 * mutating `plan[i].tonnes` and `plan[i].pct` in place.
 *
 * - Feasible (required ≤ cap × months): peaks are clipped to the cap and the
 *   overflow redistributed to months with headroom by descending desired
 *   priority, so the front/back-loading order survives and the plan still sums
 *   to the required tonnage.
 * - Infeasible (required > cap × months): every month is pinned at the cap
 *   (the maximum receivable) and the shortfall reported; no month exceeds the
 *   cap and the plan does not pretend to deliver the full required volume.
 */
function enforceReceiptCapacity(
  plan: MonthlyPlan[],
  weights: number[],
  requiredTonnes: number,
  cap: number,
  months: number
): CapacityStatus {
  const capCeil = Math.max(0, Math.floor(cap));
  const totalCapacity = capCeil * months;
  const feasible = requiredTonnes <= totalCapacity;
  const targetTotal = feasible ? requiredTonnes : totalCapacity;

  // Desired shape (exponential front/back-loading) expressed in tonnes.
  const desired = weights.map((w) => requiredTonnes * w);
  const clipped = desired.some((t) => t > capCeil + 1e-9);

  const capped = capAndRedistribute(desired, capCeil, targetTotal);
  const intTonnes = roundToSum(capped, targetTotal, capCeil);

  for (let i = 0; i < plan.length; i++) {
    plan[i].tonnes = intTonnes[i] ?? 0;
    plan[i].pct =
      requiredTonnes > 0
        ? Math.round((plan[i].tonnes / requiredTonnes) * 1000) / 10
        : 0;
  }

  return {
    feasible,
    clipped,
    shortfall: feasible ? 0 : requiredTonnes - totalCapacity,
  };
}

/**
 * Clip each value to `cap` and redistribute the overflow into months that still
 * have headroom, in descending desired-priority order so the shape's ordering
 * is preserved (peaks clipped, never inverted). When `targetTotal` needs the
 * full capacity, every month is pinned at the cap.
 */
function capAndRedistribute(
  desired: number[],
  cap: number,
  targetTotal: number
): number[] {
  const n = desired.length;
  if (n === 0) return [];
  if (cap <= 0) return new Array(n).fill(0);
  // Full capacity required → every month sits at the cap.
  if (targetTotal >= cap * n - 1e-9) return new Array(n).fill(cap);

  const t = desired.slice();
  for (let iter = 0; iter < n + 2; iter++) {
    let overflow = 0;
    for (let i = 0; i < n; i++) {
      if (t[i] > cap) {
        overflow += t[i] - cap;
        t[i] = cap;
      }
    }
    if (overflow <= 1e-9) break;

    // Under-cap months, highest desired first — keeps the front/back-loading
    // order when placing the redistributed overflow.
    const order: number[] = [];
    for (let i = 0; i < n; i++) if (t[i] < cap - 1e-9) order.push(i);
    order.sort((a, b) => desired[b] - desired[a] || a - b);

    let remaining = overflow;
    for (const i of order) {
      const room = cap - t[i];
      const add = Math.min(room, remaining);
      t[i] += add;
      remaining -= add;
      if (remaining <= 1e-9) break;
    }
    if (remaining > 1e-9) break; // no headroom left (only when infeasible)
  }
  return t;
}

/**
 * Round real tonnages to integers that sum exactly to `targetTotal` without any
 * month exceeding `cap`. Positive drift is added to the month with the most
 * headroom under the cap; negative drift is removed from the largest month.
 */
function roundToSum(values: number[], targetTotal: number, cap: number): number[] {
  const rounded = values.map((v) => Math.round(v));
  const capCeil = Number.isFinite(cap) ? cap : Infinity;
  let drift = Math.round(targetTotal) - rounded.reduce((a, b) => a + b, 0);

  let guard = 0;
  const maxIter = rounded.length * (Math.abs(drift) + 1) + rounded.length + 10;
  while (drift > 0 && guard++ < maxIter) {
    let best = -1;
    let bestRoom = 0;
    for (let i = 0; i < rounded.length; i++) {
      const room = capCeil - rounded[i];
      if (room > bestRoom) {
        bestRoom = room;
        best = i;
      }
    }
    if (best < 0) break; // no headroom under the cap
    rounded[best] += 1;
    drift -= 1;
  }
  while (drift < 0 && guard++ < maxIter) {
    let best = -1;
    let bestVol = 0;
    for (let i = 0; i < rounded.length; i++) {
      if (rounded[i] > bestVol) {
        bestVol = rounded[i];
        best = i;
      }
    }
    if (best < 0) break;
    rounded[best] -= 1;
    drift += 1;
  }
  return rounded;
}
