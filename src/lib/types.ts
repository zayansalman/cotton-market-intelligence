export interface PricePoint {
  date: string;
  close: number;
  ma50: number | null;
  ma200: number | null;
}

export interface Benchmarks {
  current_price: number;
  price_date: string;
  change_30d_pct: number;
  change_90d_pct: number;
  pct_rank_1y: number;
  pct_rank_5y: number;
  z_score_1y: number;
  vol_30d_ann: number;
  vol_90d_ann: number;
  ma_50d: number;
  ma_200d: number;
  above_ma_50d: boolean;
  above_ma_200d: boolean;
  high_1y: number;
  low_1y: number;
}

export interface PricesResponse {
  prices: PricePoint[];
  benchmarks: Benchmarks;
}

export interface Headline {
  title: string;
  summary: string;
  link: string;
  published: string;
}

export interface MonthlyPlan {
  month: number;
  pct: number;
  tonnes: number;
  rationale: string;
}

export interface KeyLevels {
  support: number;
  resistance: number;
  fair_value: number;
}

export interface Strategy {
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "AVOID";
  confidence: number;
  executive_summary: string;
  market_analysis: string;
  monthly_plan: MonthlyPlan[];
  risk_factors: string[];
  next_actions: string[];
  key_levels?: KeyLevels;
  source: "ai" | "heuristic";
  provider?: "huggingface" | "heuristic";
}

export interface LandedCostAssumptions {
  futures_usd_lb: number;
  basis_cents_lb: number;
  freight_usd_t: number;
  insurance_pct: number;
  duty_pct: number;
  fx_bdt_usd: number;
  wastage_pct: number;
}

export interface LandedCostBreakdown {
  cotton_usd_t: number;
  freight_usd_t: number;
  insurance_usd_t: number;
  duty_usd_t: number;
  pre_wastage_usd_t: number;
  effective_usd_t: number;
  effective_bdt_kg: number;
}

export interface LandedCostPoint {
  futures_usd_lb: number;
  effective_usd_t: number;
  effective_bdt_kg: number;
}

/* ------------------------------------------------------------------ */
/*  V2: PurchaserInput (re-exported from zod schema)                  */
/* ------------------------------------------------------------------ */

export type {
  PurchaserInput,
  PresetName,
} from "./schemas/purchaser-input";

export {
  purchaserInputSchema,
  PRESETS,
  PRESET_BANGLADESH_SPINNER,
  PRESET_FAST_REPLENISHMENT,
  PRESET_QUALITY_CRITICAL,
} from "./schemas/purchaser-input";

export type {
  LegacyStrategyInput,
} from "./schemas/legacy-adapter";

export {
  isLegacyInput,
  legacyToPurchaserInput,
} from "./schemas/legacy-adapter";

/* ------------------------------------------------------------------ */
/*  Landed cost                                                       */
/* ------------------------------------------------------------------ */

export interface LandedCostResponse {
  assumptions: LandedCostAssumptions;
  breakdown: LandedCostBreakdown;
  sensitivity: {
    low_1y: LandedCostPoint;
    current: LandedCostPoint;
    high_1y: LandedCostPoint;
  };
}
