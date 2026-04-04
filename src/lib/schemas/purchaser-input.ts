/**
 * PurchaserInput — canonical schema for Bangladesh spinning-mill procurement.
 *
 * Six field groups covering demand, timeline, quality, commercial, logistics,
 * and finance constraints.  Only `required_tonnes` and `planning_horizon_months`
 * are required; everything else defaults to sensible Bangladesh-market values.
 *
 * Zod is the single source of truth — TypeScript types are inferred, never
 * hand-maintained separately.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Inclusive numeric range tuple [min, max]. */
const numericRange = z
  .object({ min: z.number(), max: z.number() })
  .refine((r) => r.min <= r.max, {
    message: "min must be ≤ max",
  });

/** ISO-8601 date string (YYYY-MM-DD). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date format");

/* ------------------------------------------------------------------ */
/*  1. Demand & production context                                    */
/* ------------------------------------------------------------------ */

const demandSchema = z.object({
  required_tonnes: z
    .number()
    .min(1, "Minimum 1 tonne")
    .describe("Total cotton tonnage to procure"),
  planning_horizon_months: z
    .number()
    .int()
    .min(1)
    .max(24)
    .describe("Planning window in months"),
  required_by_date: isoDate
    .optional()
    .describe("Hard deadline for full delivery"),
  monthly_consumption_tonnes: z
    .number()
    .positive()
    .optional()
    .describe("Mill's average monthly cotton consumption"),
  current_inventory_tonnes: z
    .number()
    .min(0)
    .optional()
    .describe("On-hand cotton inventory at mill"),
  in_transit_tonnes: z
    .number()
    .min(0)
    .optional()
    .describe("Cotton currently in transit / on order"),
  min_safety_stock_days: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Minimum days of safety stock to maintain"),
  yarn_count_or_end_use_mix: z
    .string()
    .max(500)
    .optional()
    .describe("Target yarn count / end-use mix (e.g. 'Ne 30-40 combed')"),
});

/* ------------------------------------------------------------------ */
/*  2. Timeline & execution window                                    */
/* ------------------------------------------------------------------ */

const deliveryCadence = z.enum(["monthly", "biweekly", "custom"]);
const urgencyLevel = z.enum(["standard", "urgent", "emergency"]);

const timelineSchema = z
  .object({
    first_arrival_earliest: isoDate
      .optional()
      .describe("Earliest acceptable first shipment arrival"),
    latest_arrival_date: isoDate
      .optional()
      .describe("Latest acceptable final arrival"),
    preferred_delivery_cadence: deliveryCadence
      .optional()
      .describe("Preferred delivery rhythm"),
    max_monthly_receipt_capacity_tonnes: z
      .number()
      .positive()
      .optional()
      .describe("Maximum tonnes the mill can receive per month"),
    urgency_level: urgencyLevel
      .optional()
      .describe("Urgency of procurement need"),
  })
  .refine(
    (t) => {
      if (t.first_arrival_earliest && t.latest_arrival_date) {
        return t.first_arrival_earliest <= t.latest_arrival_date;
      }
      return true;
    },
    {
      message: "first_arrival_earliest must be ≤ latest_arrival_date",
      path: ["latest_arrival_date"],
    }
  );

/* ------------------------------------------------------------------ */
/*  3. Quality & technical specs                                      */
/* ------------------------------------------------------------------ */

const ginningPreference = z.enum(["roller", "saw", "any"]);

const qualitySchema = z.object({
  preferred_origins: z
    .array(z.string().max(100))
    .max(20)
    .optional()
    .describe("Origins in priority order (e.g. ['US', 'Brazil', 'India'])"),
  staple_length_range: numericRange
    .optional()
    .describe("Staple length range in mm (e.g. {min: 28, max: 32})"),
  micronaire_range: numericRange
    .optional()
    .describe("Micronaire range (e.g. {min: 3.5, max: 4.9})"),
  strength_min_gpt: z
    .number()
    .positive()
    .optional()
    .describe("Minimum fiber strength in g/tex"),
  length_uniformity_min: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Minimum length uniformity index (%)"),
  color_grade_range: z
    .string()
    .max(50)
    .optional()
    .describe("Acceptable color grade range (e.g. '11-31')"),
  leaf_trash_max: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe("Maximum leaf/trash grade (1=cleanest, 8=most trash)"),
  moisture_max: z
    .number()
    .min(0)
    .max(20)
    .optional()
    .describe("Maximum moisture content (%)"),
  contamination_tolerance: z
    .string()
    .max(500)
    .optional()
    .describe("Contamination/foreign-matter policy (e.g. 'zero plastic')"),
  ginning_preference: ginningPreference
    .optional()
    .describe("Ginning method preference"),
  hvi_required: z
    .boolean()
    .optional()
    .describe("Whether HVI/instrument classing is required"),
});

/* ------------------------------------------------------------------ */
/*  4. Commercial structure                                           */
/* ------------------------------------------------------------------ */

const pricingMode = z.enum(["fixed", "on-call", "basis-fixed"]);

const splitLotRules = z.object({
  allow_partials: z.boolean().optional(),
  min_lot_tonnes: z.number().positive().optional(),
});

const commercialSchema = z.object({
  pricing_mode: pricingMode
    .optional()
    .describe("Pricing mechanism (fixed / on-call / basis-fixed)"),
  reference_contract_month: z
    .string()
    .optional()
    .describe("ICE reference contract month (e.g. 'Dec 2026')"),
  basis_diff_target: z
    .number()
    .optional()
    .describe("Target basis/differential in cents/lb"),
  target_price_walkaway: z
    .object({
      target_cents_lb: z.number().optional(),
      walkaway_cents_lb: z.number().optional(),
    })
    .optional()
    .describe("Target and walkaway price levels in cents/lb"),
  quantity_tolerance_pct: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Acceptable quantity tolerance (± %)"),
  split_lot_rules: splitLotRules
    .optional()
    .describe("Whether partial lots are accepted"),
});

/* ------------------------------------------------------------------ */
/*  5. Logistics & delivery                                           */
/* ------------------------------------------------------------------ */

const incoterm = z.enum([
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
]);

const logisticsSchema = z.object({
  incoterm: incoterm
    .optional()
    .describe("Trade term (e.g. CFR, CIF, FOB)"),
  load_port_preferences: z
    .array(z.string().max(100))
    .max(20)
    .optional()
    .describe("Preferred load ports (e.g. ['Houston', 'Santos'])"),
  discharge_port: z
    .string()
    .max(200)
    .optional()
    .describe("Destination port (e.g. 'Chattogram')"),
  inland_delivery: z
    .object({
      required: z.boolean(),
      mill_location: z.string().max(300).optional(),
    })
    .optional()
    .describe("Whether inland delivery to mill is needed"),
  shipment_window: z
    .object({ earliest: isoDate, latest: isoDate })
    .optional()
    .describe("Acceptable shipment date window"),
  vessel_route_constraints: z
    .string()
    .max(500)
    .optional()
    .describe("Vessel size / route restrictions"),
});

/* ------------------------------------------------------------------ */
/*  6. Finance & risk                                                 */
/* ------------------------------------------------------------------ */

const paymentTerm = z.enum([
  "lc_at_sight",
  "lc_usance",
  "dp",
  "da",
  "tt_advance",
  "open_account",
]);

const financeSchema = z.object({
  payment_term: paymentTerm
    .optional()
    .describe("Payment mechanism"),
  max_credit_days: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Maximum credit days allowed by bank / policy"),
  bank_lc_constraints: z
    .string()
    .max(500)
    .optional()
    .describe("Bank or L/C facility constraints (free text)"),
  fx_assumption: z
    .number()
    .positive()
    .optional()
    .describe("Budget FX rate (BDT per USD)"),
  approved_suppliers: z
    .array(z.string().max(200))
    .max(50)
    .optional()
    .describe("Whitelisted supplier names"),
  max_supplier_concentration_pct: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Max % of total volume from a single supplier"),
  traceability_requirements: z
    .array(z.string().max(100))
    .max(20)
    .optional()
    .describe("Certifications required (e.g. ['BCI', 'organic', 'GOTS'])"),
});

/* ------------------------------------------------------------------ */
/*  Composite PurchaserInput schema                                   */
/* ------------------------------------------------------------------ */

export const purchaserInputSchema = z.object({
  /** Demand & production context (required_tonnes and planning_horizon_months are mandatory). */
  demand: demandSchema,
  /** Timeline & execution window. */
  timeline: timelineSchema.optional(),
  /** Quality & technical specifications. */
  quality: qualitySchema.optional(),
  /** Commercial structure. */
  commercial: commercialSchema.optional(),
  /** Logistics & delivery. */
  logistics: logisticsSchema.optional(),
  /** Finance & risk. */
  finance: financeSchema.optional(),
});

export type PurchaserInput = z.infer<typeof purchaserInputSchema>;

/* ------------------------------------------------------------------ */
/*  Sub-schema exports (for section-level validation in forms)        */
/* ------------------------------------------------------------------ */

export {
  demandSchema,
  timelineSchema,
  qualitySchema,
  commercialSchema,
  logisticsSchema,
  financeSchema,
};

/* ------------------------------------------------------------------ */
/*  Presets                                                           */
/* ------------------------------------------------------------------ */

/** Bangladesh mid-size spinner defaults — sensible starting point. */
export const PRESET_BANGLADESH_SPINNER: PurchaserInput = {
  demand: {
    required_tonnes: 2000,
    planning_horizon_months: 6,
    monthly_consumption_tonnes: 400,
    current_inventory_tonnes: 200,
    in_transit_tonnes: 0,
    min_safety_stock_days: 30,
  },
  timeline: {
    preferred_delivery_cadence: "monthly",
    urgency_level: "standard",
  },
  quality: {
    preferred_origins: ["US", "Brazil", "India", "West Africa"],
    staple_length_range: { min: 28, max: 32 },
    micronaire_range: { min: 3.5, max: 4.9 },
    strength_min_gpt: 28,
    ginning_preference: "any",
    hvi_required: true,
  },
  commercial: {
    pricing_mode: "on-call",
    quantity_tolerance_pct: 5,
    split_lot_rules: { allow_partials: true, min_lot_tonnes: 50 },
  },
  logistics: {
    incoterm: "CFR",
    discharge_port: "Chattogram",
  },
  finance: {
    payment_term: "lc_at_sight",
    max_credit_days: 90,
    fx_assumption: 117,
  },
};

/** Fast replenishment — urgent, short lead-time, relaxed quality. */
export const PRESET_FAST_REPLENISHMENT: PurchaserInput = {
  demand: {
    required_tonnes: 500,
    planning_horizon_months: 2,
    min_safety_stock_days: 14,
  },
  timeline: {
    urgency_level: "urgent",
    preferred_delivery_cadence: "biweekly",
  },
  quality: {
    preferred_origins: ["India"],
    staple_length_range: { min: 26, max: 32 },
    micronaire_range: { min: 3.0, max: 5.5 },
    ginning_preference: "any",
    hvi_required: false,
  },
  commercial: {
    pricing_mode: "fixed",
    quantity_tolerance_pct: 10,
  },
  logistics: {
    incoterm: "CFR",
    discharge_port: "Chattogram",
  },
  finance: {
    payment_term: "lc_at_sight",
    fx_assumption: 117,
  },
};

/** Quality-critical lot — strict HVI specs, limited origins. */
export const PRESET_QUALITY_CRITICAL: PurchaserInput = {
  demand: {
    required_tonnes: 1000,
    planning_horizon_months: 4,
    min_safety_stock_days: 45,
    yarn_count_or_end_use_mix: "Ne 40-60 combed compact",
  },
  timeline: {
    urgency_level: "standard",
    preferred_delivery_cadence: "monthly",
  },
  quality: {
    preferred_origins: ["US", "Australia"],
    staple_length_range: { min: 30, max: 34 },
    micronaire_range: { min: 3.8, max: 4.5 },
    strength_min_gpt: 31,
    length_uniformity_min: 82,
    leaf_trash_max: 3,
    moisture_max: 7.5,
    contamination_tolerance: "zero plastic, zero polypropylene",
    ginning_preference: "saw",
    hvi_required: true,
  },
  commercial: {
    pricing_mode: "on-call",
    quantity_tolerance_pct: 3,
    split_lot_rules: { allow_partials: false, min_lot_tonnes: 100 },
  },
  logistics: {
    incoterm: "CIF",
    discharge_port: "Chattogram",
    inland_delivery: { required: true, mill_location: "Gazipur" },
  },
  finance: {
    payment_term: "lc_usance",
    max_credit_days: 120,
    max_supplier_concentration_pct: 40,
    traceability_requirements: ["BCI"],
    fx_assumption: 117,
  },
};

export const PRESETS = {
  bangladesh_spinner: PRESET_BANGLADESH_SPINNER,
  fast_replenishment: PRESET_FAST_REPLENISHMENT,
  quality_critical: PRESET_QUALITY_CRITICAL,
} as const;

export type PresetName = keyof typeof PRESETS;
