/**
 * Plan feasibility scoring — 0 (infeasible) to 100 (easily achievable).
 *
 * Pure function.  No React/Next imports.
 */

import type { PurchaserInput } from "@/lib/schemas/purchaser-input";
import type { ConstraintResult } from "./constraints";

/**
 * Score feasibility based on constraint tension.
 *
 * Deductions:
 * - Each binding constraint: -5
 * - Each constraint risk: -8
 * - Urgency: -10 (urgent), -20 (emergency)
 * - Single origin: -10
 * - Receipt capacity < avg monthly need: -15
 * - Credit days <= 60: -10
 * - Too many binding constraints (>5): -10
 */
export function scoreFeasibility(
  input: PurchaserInput,
  constraints: ConstraintResult
): number {
  let score = 100;

  // Binding constraints
  score -= constraints.binding_constraints.length * 5;
  score -= constraints.constraint_risks.length * 8;

  // Urgency
  if (input.timeline?.urgency_level === "urgent") score -= 10;
  if (input.timeline?.urgency_level === "emergency") score -= 20;

  // Single origin
  if (
    input.quality?.preferred_origins &&
    input.quality.preferred_origins.length === 1
  ) {
    score -= 10;
  }

  // Receipt capacity pressure
  if (input.timeline?.max_monthly_receipt_capacity_tonnes) {
    const avgMonthly =
      input.demand.required_tonnes / input.demand.planning_horizon_months;
    if (input.timeline.max_monthly_receipt_capacity_tonnes < avgMonthly) {
      score -= 15;
    }
  }

  // Credit stress
  if (input.finance?.max_credit_days !== undefined) {
    if (input.finance.max_credit_days <= 60) score -= 10;
  }

  // Complexity penalty
  if (constraints.binding_constraints.length > 5) score -= 10;

  return Math.max(0, Math.min(100, score));
}
