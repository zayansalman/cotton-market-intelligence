/**
 * Constraint evaluation — pure functions that assess how purchaser constraints
 * should modify the base strategy allocation.
 *
 * No React/Next imports.  Fully unit-testable.
 */

import type { PurchaserInput } from "@/lib/schemas/purchaser-input";
import type { Benchmarks } from "@/lib/types";
import {
  getMinLeadTimeDays,
  getMaxLeadTimeDays,
  CREDIT_STRESS,
} from "./assumptions";

export interface ConstraintResult {
  binding_constraints: string[];
  constraint_risks: string[];
  assumption_set: Record<string, string>;
  pacing_multipliers: number[];
}

/**
 * Evaluate all constraint groups and return binding constraints + pacing
 * adjustments.
 *
 * `pacing_multipliers[i]` is applied per-month to the base allocation weights.
 * Values >1 push volume into that month; <1 defer volume out of that month.
 */
export function evaluateConstraints(
  input: PurchaserInput,
  benchmarks: Benchmarks,
  months: number
): ConstraintResult {
  const binding: string[] = [];
  const risks: string[] = [];
  const assumptions: Record<string, string> = {};
  const multipliers = new Array(months).fill(1);

  // Timeline constraints
  evaluateTimeline(input, months, multipliers, binding, risks, assumptions);

  // Quality / origin constraints
  evaluateQuality(input, multipliers, binding, risks, assumptions);

  // Finance constraints
  evaluateFinance(input, benchmarks, months, multipliers, binding, risks, assumptions);

  // Logistics constraints
  evaluateLogistics(input, binding, assumptions);

  return {
    binding_constraints: binding,
    constraint_risks: risks,
    assumption_set: assumptions,
    pacing_multipliers: multipliers,
  };
}

function evaluateTimeline(
  input: PurchaserInput,
  months: number,
  multipliers: number[],
  binding: string[],
  risks: string[],
  assumptions: Record<string, string>
): void {
  const tl = input.timeline;
  if (!tl) return;

  if (tl.urgency_level === "urgent" || tl.urgency_level === "emergency") {
    binding.push(`Urgency: ${tl.urgency_level}`);
    // Front-load first third of months
    const urgentMonths = Math.max(1, Math.ceil(months / 3));
    for (let i = 0; i < urgentMonths; i++) {
      multipliers[i] *= tl.urgency_level === "emergency" ? 2.0 : 1.5;
    }
    assumptions.urgency = tl.urgency_level;
  }

  if (tl.max_monthly_receipt_capacity_tonnes) {
    const cap = tl.max_monthly_receipt_capacity_tonnes;
    const avgMonthly = input.demand.required_tonnes / months;
    if (avgMonthly > cap) {
      binding.push(`Receipt capacity: ${cap}t/month caps front-loading`);
      risks.push(
        `Monthly receipt capacity (${cap}t) below average need (${Math.round(avgMonthly)}t/month) — forces extended timeline.`
      );
      // Cap high-volume months
      for (let i = 0; i < months; i++) {
        if (multipliers[i] > 1) {
          multipliers[i] = Math.min(multipliers[i], cap / avgMonthly);
        }
      }
    }
    assumptions.max_monthly_receipt = `${cap}t`;
  }
}

function evaluateQuality(
  input: PurchaserInput,
  multipliers: number[],
  binding: string[],
  risks: string[],
  assumptions: Record<string, string>
): void {
  const q = input.quality;
  if (!q) return;

  const origins = q.preferred_origins ?? [];
  if (origins.length > 0) {
    const minLead = getMinLeadTimeDays(origins);
    const maxLead = getMaxLeadTimeDays(origins);
    assumptions.min_lead_time = `${minLead}d (${origins[0]})`;
    assumptions.max_lead_time = `${maxLead}d`;

    if (minLead > 30) {
      binding.push(`Long-haul origins only (min ${minLead}d transit)`);
      risks.push(
        "All preferred origins have >30d transit — limits emergency replenishment."
      );
    }
  }

  if (origins.length === 1) {
    binding.push(`Single origin: ${origins[0]}`);
    risks.push(
      `Single-origin constraint (${origins[0]}) creates supply concentration risk.`
    );
  }

  if (q.hvi_required) {
    binding.push("HVI/instrument classing required");
    assumptions.classing = "HVI instrument required";
  }

  if (q.contamination_tolerance) {
    binding.push(`Contamination policy: ${q.contamination_tolerance}`);
  }

  // Strict quality narrows supply → slightly defer to reduce execution pressure
  const strictness = [
    q.strength_min_gpt && q.strength_min_gpt >= 30,
    q.staple_length_range && q.staple_length_range.min >= 30,
    q.micronaire_range &&
      q.micronaire_range.max - q.micronaire_range.min <= 1.0,
    q.leaf_trash_max && q.leaf_trash_max <= 3,
  ].filter(Boolean).length;

  if (strictness >= 2) {
    binding.push("Tight quality specs (2+ strict parameters)");
    risks.push(
      "Narrow quality window may limit available supply and increase premiums."
    );
    // Slightly smooth out allocation to reduce execution pressure
    for (let i = 0; i < multipliers.length; i++) {
      multipliers[i] = 0.85 * multipliers[i] + 0.15;
    }
  }
}

function evaluateFinance(
  input: PurchaserInput,
  benchmarks: Benchmarks,
  months: number,
  multipliers: number[],
  binding: string[],
  risks: string[],
  assumptions: Record<string, string>
): void {
  const f = input.finance;
  if (!f) return;

  if (f.payment_term) {
    assumptions.payment_term = f.payment_term.replace(/_/g, " ");
  }

  if (f.max_credit_days !== undefined) {
    assumptions.max_credit_days = `${f.max_credit_days}d`;
    if (f.max_credit_days <= CREDIT_STRESS.soft_limit_days) {
      binding.push(`Credit limit: ${f.max_credit_days}d`);
      // Short credit → can't stack too much in early months
      const creditFactor = f.max_credit_days / CREDIT_STRESS.soft_limit_days;
      for (let i = 0; i < Math.min(2, months); i++) {
        multipliers[i] *= Math.max(0.6, creditFactor);
      }
    }
  }

  if (f.max_supplier_concentration_pct !== undefined && f.max_supplier_concentration_pct < 50) {
    binding.push(`Supplier concentration cap: ${f.max_supplier_concentration_pct}%`);
    risks.push(
      "Low supplier concentration limit may require splitting orders across multiple suppliers, increasing coordination costs."
    );
  }

  if (f.fx_assumption) {
    assumptions.fx_rate = `BDT ${f.fx_assumption}/USD`;
  }
}

function evaluateLogistics(
  input: PurchaserInput,
  binding: string[],
  assumptions: Record<string, string>
): void {
  const l = input.logistics;
  if (!l) return;

  if (l.incoterm) {
    assumptions.incoterm = l.incoterm;
    binding.push(`Incoterm: ${l.incoterm}`);
  }

  if (l.discharge_port) {
    assumptions.discharge_port = l.discharge_port;
  }

  if (l.inland_delivery?.required) {
    binding.push(
      `Inland delivery to ${l.inland_delivery.mill_location ?? "mill"}`
    );
    assumptions.inland_delivery = l.inland_delivery.mill_location ?? "yes";
  }
}
