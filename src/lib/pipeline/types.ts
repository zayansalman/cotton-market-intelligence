/**
 * Data pipeline types for V3 forecasting (#24).
 */

/* ------------------------------------------------------------------ */
/*  Time-indexed data point                                            */
/* ------------------------------------------------------------------ */

export interface DataPoint {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /** Numeric value. */
  value: number;
}

/* ------------------------------------------------------------------ */
/*  Factor metadata                                                    */
/* ------------------------------------------------------------------ */

export type FactorGroup =
  | "supply"
  | "demand"
  | "macro"
  | "technical"
  | "freight"
  | "competing"
  | "sentiment";

export type Frequency = "daily" | "weekly" | "monthly" | "quarterly";

export interface FactorMeta {
  id: string;
  name: string;
  group: FactorGroup;
  frequency: Frequency;
  /** Release lag in calendar days (how stale is data when available). */
  release_lag_days: number;
  unit: string;
  source: string;
  /** Expected direction: +1 = positive correlation with cotton price, -1 = negative. */
  direction: 1 | -1;
}

/* ------------------------------------------------------------------ */
/*  Factor series (metadata + data)                                    */
/* ------------------------------------------------------------------ */

export interface FactorSeries {
  meta: FactorMeta;
  data: DataPoint[];
  /** Data quality metrics. */
  quality: DataQuality;
}

export interface DataQuality {
  total_points: number;
  missing_pct: number;
  stale_days: number;
  first_date: string;
  last_date: string;
  outlier_count: number;
}

/* ------------------------------------------------------------------ */
/*  Pipeline output                                                    */
/* ------------------------------------------------------------------ */

export interface PipelineOutput {
  fetched_at: string;
  factors: FactorSeries[];
  /** Cotton #2 close prices (target variable). */
  target: DataPoint[];
  /** Quality summary across all factors. */
  quality_summary: {
    total_factors: number;
    factors_with_data: number;
    factors_stale: number;
    avg_missing_pct: number;
  };
}
