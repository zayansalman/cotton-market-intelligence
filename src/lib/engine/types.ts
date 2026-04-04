/**
 * V2 Strategy response type — extends V1 Strategy with constraint fields.
 */

import type { Strategy } from "@/lib/types";

export interface StrategyV2 extends Strategy {
  binding_constraints: string[];
  assumption_set: Record<string, string>;
  constraint_risks: string[];
  plan_feasibility_score: number;
}
