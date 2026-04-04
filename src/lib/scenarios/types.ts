import type { PurchaserInput } from "@/lib/schemas/purchaser-input";
import type { Strategy, Benchmarks } from "@/lib/types";

export interface Scenario {
  id: string;
  name: string;
  created_at: string;
  inputs: PurchaserInput;
  market_snapshot: {
    benchmarks: Benchmarks;
    headlines_count: number;
    price_date: string;
  };
  strategy: Strategy;
  version: 1;
}
