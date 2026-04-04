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
/*  V2 request body schema                                            */
/* ------------------------------------------------------------------ */

export const strategyRequestV2Schema = z.object({
  strategy_input_version: z.literal(2),
  purchaser_input: purchaserInputSchema,
  benchmarks: z.any(),
  headlines: z.array(z.any()),
  landedCost: z.any().optional(),
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
    const purchaserInput = legacyToPurchaserInput({
      tonnage: body.tonnage as number,
      months: body.months as number,
    });
    return {
      ok: true,
      data: {
        purchaserInput,
        benchmarks: body.benchmarks as unknown as Benchmarks,
        headlines: (body.headlines ?? []) as unknown as Headline[],
        landedCost: (body.landedCost as unknown as LandedCostResponse) ?? null,
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
