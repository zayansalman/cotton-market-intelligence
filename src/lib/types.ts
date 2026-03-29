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
}
