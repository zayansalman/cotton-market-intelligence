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
 * - Required tonnage > total receipt capacity (physically infeasible within the
 *   horizon): heavy penalty AND capped at 25 so it never reads as comfortably
 *   feasible
 * - Receipt capacity tight (avg intake near the cap but still feasible): -10
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
    const cap = input.timeline.max_monthly_receipt_capacity_tonnes;
    const required = input.demand.required_tonnes;
    const months = input.demand.planning_horizon_months;
    const totalCapacity = cap * months;
    const avgMonthly = required / months;
    if (required > totalCapacity) {
      // Physically cannot fit within the horizon — must not read as comfortably
      // feasible regardless of what else is set.
      score -= 40;
      score = Math.min(score, 25);
    } else if (avgMonthly > cap * 0.85) {
      // Feasible but tight — sustained intake sits near the cap.
      score -= 10;
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
