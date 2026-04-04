/**
 * V2 strategy request schema — wraps PurchaserInput + market data.
 *
 * Auto-detects legacy vs V2 payloads.  Legacy payloads are silently upgraded
 * via the legacy adapter.
 */

import { z } from "zod";
import { purchaserInputSchema } from "./purchaser-input";
import { isLegacyInput, legacyToPurchaserInput } from "./legacy-adapter";
import type { PurchaserInput } from "./purchaser-input";
import type { Benchmarks, Headline, LandedCostResponse } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Strict sub-schemas (replaces z.any())                              */
/* ------------------------------------------------------------------ */

const benchmarksSchema = z.object({
  current_price: z.number().finite(),
  price_date: z.string().max(20),
  change_30d_pct: z.number().finite(),
  change_90d_pct: z.number().finite(),
  pct_rank_1y: z.number().finite().min(0).max(1),
  pct_rank_5y: z.number().finite().min(0).max(1),
  z_score_1y: z.number().finite(),
  vol_30d_ann: z.number().finite().min(0),
  vol_90d_ann: z.number().finite().min(0),
  ma_50d: z.number().finite(),
  ma_200d: z.number().finite(),
  above_ma_50d: z.boolean(),
  above_ma_200d: z.boolean(),
  high_1y: z.number().finite(),
  low_1y: z.number().finite(),
}).strict();

const headlineSchema = z.object({
  title: z.string().max(500),
  summary: z.string().max(500),
  link: z.string().max(2000),
  published: z.string().max(100),
}).strict();

const landedCostPointSchema = z.object({
  futures_usd_lb: z.number().finite(),
  effective_usd_t: z.number().finite(),
  effective_bdt_kg: z.number().finite(),
});

const landedCostSchema = z.object({
  assumptions: z.object({
    futures_usd_lb: z.number().finite(),
    basis_cents_lb: z.number().finite(),
    freight_usd_t: z.number().finite(),
    insurance_pct: z.number().finite(),
    duty_pct: z.number().finite(),
    fx_bdt_usd: z.number().finite(),
    wastage_pct: z.number().finite(),
  }),
  breakdown: z.object({
    cotton_usd_t: z.number().finite(),
    freight_usd_t: z.number().finite(),
    insurance_usd_t: z.number().finite(),
    duty_usd_t: z.number().finite(),
    pre_wastage_usd_t: z.number().finite(),
    effective_usd_t: z.number().finite(),
    effective_bdt_kg: z.number().finite(),
  }),
  sensitivity: z.object({
    low_1y: landedCostPointSchema,
    current: landedCostPointSchema,
    high_1y: landedCostPointSchema,
  }),
});

/* ------------------------------------------------------------------ */
/*  V2 request body schema                                            */
/* ------------------------------------------------------------------ */

export const strategyRequestV2Schema = z.object({
  strategy_input_version: z.literal(2),
  purchaser_input: purchaserInputSchema,
  benchmarks: benchmarksSchema,
  headlines: z.array(headlineSchema).max(50),
  landedCost: landedCostSchema.optional(),
});

export type StrategyRequestV2 = z.infer<typeof strategyRequestV2Schema>;

/* ------------------------------------------------------------------ */
/*  Parsed output (always V2 shape regardless of input version)       */
/* ------------------------------------------------------------------ */

export interface ParsedStrategyRequest {
  purchaserInput: PurchaserInput;
  benchmarks: Benchmarks;
  headlines: Headline[];
  landedCost: LandedCostResponse | null;
}

/* ------------------------------------------------------------------ */
/*  Structured validation error                                       */
/* ------------------------------------------------------------------ */

export interface ValidationError {
  field: string;
  reason: string;
  suggested_fix?: string;
}

/* ------------------------------------------------------------------ */
/*  Parse & validate request body (auto-detects version)              */
/* ------------------------------------------------------------------ */

export function parseStrategyRequest(
  body: Record<string, unknown>
):
  | { ok: true; data: ParsedStrategyRequest }
  | { ok: false; errors: ValidationError[] } {
  // V2 path
  if (body.strategy_input_version === 2 || "purchaser_input" in body) {
    const result = strategyRequestV2Schema.safeParse(body);
    if (!result.success) {
      return {
        ok: false,
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          reason: issue.message,
          suggested_fix: suggestedFix(issue),
        })),
      };
    }
    return {
      ok: true,
      data: {
        purchaserInput: result.data.purchaser_input,
        benchmarks: result.data.benchmarks as unknown as Benchmarks,
        headlines: result.data.headlines as unknown as Headline[],
        landedCost: (result.data.landedCost as unknown as LandedCostResponse) ?? null,
      },
    };
  }

  // Legacy path
  if (isLegacyInput(body)) {
    // Validate benchmarks/headlines/landedCost even on legacy path
    const bmResult = benchmarksSchema.safeParse(body.benchmarks);
    if (!bmResult.success) {
      return {
        ok: false,
        errors: bmResult.error.issues.map((issue) => ({
          field: `benchmarks.${issue.path.join(".")}`,
          reason: issue.message,
          suggested_fix: suggestedFix(issue),
        })),
      };
    }
    const hlResult = z.array(headlineSchema).max(50).safeParse(body.headlines ?? []);
    if (!hlResult.success) {
      return {
        ok: false,
        errors: hlResult.error.issues.map((issue) => ({
          field: `headlines.${issue.path.join(".")}`,
          reason: issue.message,
          suggested_fix: suggestedFix(issue),
        })),
      };
    }
    const lcResult = body.landedCost
      ? landedCostSchema.safeParse(body.landedCost)
      : { success: true as const, data: undefined };
    if (!lcResult.success) {
      return {
        ok: false,
        errors: (lcResult as { success: false; error: z.ZodError }).error.issues.map((issue) => ({
          field: `landedCost.${issue.path.join(".")}`,
          reason: issue.message,
          suggested_fix: suggestedFix(issue),
        })),
      };
    }

    const purchaserInput = legacyToPurchaserInput({
      tonnage: body.tonnage as number,
      months: body.months as number,
    });
    return {
      ok: true,
      data: {
        purchaserInput,
        benchmarks: bmResult.data as unknown as Benchmarks,
        headlines: hlResult.data as unknown as Headline[],
        landedCost: (lcResult.data as unknown as LandedCostResponse) ?? null,
      },
    };
  }

  return {
    ok: false,
    errors: [
      {
        field: "body",
        reason:
          "Unrecognized request format. Send either legacy {tonnage, months, benchmarks, headlines} or V2 {strategy_input_version: 2, purchaser_input, benchmarks, headlines}.",
        suggested_fix:
          "Add strategy_input_version: 2 and purchaser_input to your request body.",
      },
    ],
  };
}

function suggestedFix(issue: z.ZodIssue): string | undefined {
  const iss = issue as unknown as Record<string, unknown>;
  if ("expected" in iss && "received" in iss) {
    return `Expected ${iss.expected}, received ${iss.received}`;
  }
  if ("minimum" in iss) {
    return `Value must be at least ${iss.minimum}`;
  }
  if ("options" in iss && Array.isArray(iss.options)) {
    return `Valid options: ${iss.options.join(", ")}`;
  }
  return undefined;
}
