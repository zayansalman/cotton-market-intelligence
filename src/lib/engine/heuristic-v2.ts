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
