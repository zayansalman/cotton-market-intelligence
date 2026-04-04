/**
 * Multi-mill portfolio types (#7).
 */

import type { PurchaserInput } from "@/lib/schemas/purchaser-input";
import type { Strategy } from "@/lib/types";

export interface Mill {
  id: string;
  name: string;
  input: PurchaserInput;
  strategy?: Strategy | null;
  generatedAt?: string;
}

export interface PortfolioSummary {
  total_mills: number;
  total_tonnes: number;
  total_monthly_tonnes: number;
  /** Aggregate monthly plan across all mills. */
  aggregate_plan: AggregatePlanMonth[];
  /** Signal distribution. */
  signal_counts: Record<string, number>;
}

export interface AggregatePlanMonth {
  month: number;
  total_tonnes: number;
  by_mill: { mill_id: string; mill_name: string; tonnes: number }[];
}
