/**
 * Converts V1 legacy input {tonnage, months} to PurchaserInput.
 *
 * Enables backward compatibility — existing clients that send the old
 * payload get silently upgraded to the new schema shape.
 */

import type { PurchaserInput } from "./purchaser-input";

export interface LegacyStrategyInput {
  tonnage: number;
  months: number;
}

export function isLegacyInput(
  body: Record<string, unknown>
): body is Record<string, unknown> & LegacyStrategyInput {
  return (
    typeof body.tonnage === "number" &&
    typeof body.months === "number" &&
    !("strategy_input_version" in body) &&
    !("demand" in body)
  );
}

export function legacyToPurchaserInput(input: LegacyStrategyInput): PurchaserInput {
  return {
    demand: {
      required_tonnes: input.tonnage,
      planning_horizon_months: input.months,
    },
  };
}
