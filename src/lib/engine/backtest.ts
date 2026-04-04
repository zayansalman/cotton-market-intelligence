/**
 * Backtesting engine for strategy confidence calibration (#6).
 *
 * Replays heuristic strategy decisions at monthly intervals over
 * historical price data using walk-forward methodology (no leakage).
 *
 * Each step:
 * 1. Compute benchmarks using only data available at that point
 * 2. Generate heuristic signal + allocation
 * 3. Record "execution price" as average of next month's closes
 * 4. Compare to benchmark (equal-weight monthly buying)
 */

import type { Benchmarks } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BacktestConfig {
  /** Total tonnes to procure in each simulated window. */
  tonnage: number;
  /** Months in each procurement window. */
  months: number;
  /** How many months between each replay step. Default 1. */
  step_months?: number;
  /** Minimum history required before first signal (trading days). */
  min_history?: number;
}

export interface BacktestStep {
  decision_date: string;
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "AVOID";
  confidence: number;
  price_at_decision: number;
  pct_rank_1y: number;
  z_score_1y: number;
  vol_30d_ann: number;
  /** Weighted avg execution price using heuristic allocation. */
  weighted_exec_price: number;
  /** Equal-weight benchmark execution price. */
  benchmark_exec_price: number;
  /** Savings vs benchmark in $/lb. Positive = outperformed. */
  savings_per_lb: number;
  /** Savings as % of benchmark price. */
  savings_pct: number;
}

export interface BacktestResult {
  steps: BacktestStep[];
  summary: BacktestSummary;
}

export interface BacktestSummary {
  total_steps: number;
  /** Hit rate: % of steps where strategy beat benchmark. */
  hit_rate_pct: number;
  /** Average savings per lb across all steps. */
  avg_savings_per_lb: number;
  /** Average savings as %. */
  avg_savings_pct: number;
  /** Worst single step savings (most negative = worst underperformance). */
  worst_savings_pct: number;
  /** Best single step savings. */
  best_savings_pct: number;
  /** Signal distribution. */
  signal_counts: Record<string, number>;
  /** Average savings by signal type. */
  avg_savings_by_signal: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/*  Statistics helpers (mirror prices/route.ts logic)                   */
/* ------------------------------------------------------------------ */

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

function pctRank(arr: number[], val: number): number {
  return arr.filter((x) => x < val).length / arr.length;
}

function vol(rets: number[]): number {
  return std(rets) * Math.sqrt(252) * 100;
}

function maAt(prices: number[], window: number, idx: number): number {
  if (idx < window - 1) return prices[idx];
  let sum = 0;
  for (let j = idx - window + 1; j <= idx; j++) sum += prices[j];
  return sum / window;
}

/* ------------------------------------------------------------------ */
/*  Build benchmarks at a point in time (walk-forward, no leakage)     */
/* ------------------------------------------------------------------ */

function buildBenchmarksAt(
  prices: number[],
  dates: string[],
  idx: number
): Benchmarks | null {
  if (idx < 252) return null; // Need at least 1 year of history

  const current = prices[idx];
  const y1 = prices.slice(idx - 252 + 1, idx + 1);

  const returns: number[] = [];
  for (let i = Math.max(1, idx - 252); i <= idx; i++) {
    returns.push(prices[i] / prices[i - 1] - 1);
  }

  const r30 = returns.slice(-Math.min(22, returns.length));
  const r90 = returns.slice(-Math.min(66, returns.length));

  const change = (lookback: number) =>
    idx >= lookback ? ((current / prices[idx - lookback]) - 1) * 100 : 0;

  const ma50 = maAt(prices, 50, idx);
  const ma200 = maAt(prices, 200, idx);

  return {
    current_price: current,
    price_date: dates[idx],
    change_30d_pct: Math.round(change(22) * 100) / 100,
    change_90d_pct: Math.round(change(66) * 100) / 100,
    pct_rank_1y: Math.round(pctRank(y1, current) * 10000) / 10000,
    pct_rank_5y: Math.round(pctRank(y1, current) * 10000) / 10000, // use 1Y for simplicity
    z_score_1y: std(y1) > 0 ? Math.round(((current - mean(y1)) / std(y1)) * 100) / 100 : 0,
    vol_30d_ann: Math.round(vol(r30) * 10) / 10,
    vol_90d_ann: Math.round(vol(r90) * 10) / 10,
    ma_50d: Math.round(ma50 * 10000) / 10000,
    ma_200d: Math.round(ma200 * 10000) / 10000,
    above_ma_50d: current > ma50,
    above_ma_200d: current > ma200,
    high_1y: Math.round(Math.max(...y1) * 10000) / 10000,
    low_1y: Math.round(Math.min(...y1) * 10000) / 10000,
  };
}

/* ------------------------------------------------------------------ */
/*  Heuristic signal (same logic as strategy route)                    */
/* ------------------------------------------------------------------ */

function heuristicSignal(bm: Benchmarks): {
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "AVOID";
  confidence: number;
} {
  const rank = bm.pct_rank_1y;
  const z = bm.z_score_1y;

  if (rank < 0.15 && z < -1) return { signal: "STRONG_BUY", confidence: 80 };
  if (rank < 0.3) return { signal: "BUY", confidence: 65 };
  if (rank > 0.8) return { signal: "AVOID", confidence: 70 };
  return { signal: "HOLD", confidence: 50 };
}

/** Generate monthly allocation weights (same as strategy route). */
function monthlyWeights(
  signal: string,
  months: number,
  volAnn: number
): number[] {
  const base = Array.from({ length: months }, (_, i) => {
    if (signal === "STRONG_BUY" || signal === "BUY") return Math.exp(-0.3 * i);
    if (signal === "AVOID") return Math.exp(0.3 * i);
    return 1;
  });

  if (volAnn > 30) {
    for (let i = 0; i < base.length; i++) {
      base[i] = 0.7 * base[i] + 0.3;
    }
  }

  const sum = base.reduce((a, b) => a + b, 0);
  return base.map((b) => b / sum);
}

/* ------------------------------------------------------------------ */
/*  Core backtest runner                                                */
/* ------------------------------------------------------------------ */

/**
 * Run walk-forward backtest over historical prices.
 *
 * @param prices - Daily close prices ($/lb), oldest first
 * @param dates  - Corresponding ISO date strings
 * @param config - Backtest parameters
 */
export function runBacktest(
  prices: number[],
  dates: string[],
  config: BacktestConfig
): BacktestResult {
  const { tonnage, months } = config;
  const stepMonths = config.step_months ?? 1;
  const tradingDaysPerMonth = 21;
  const minHistory = config.min_history ?? 252;

  const steps: BacktestStep[] = [];

  // Walk through the price series at monthly intervals
  for (let idx = minHistory; idx < prices.length; idx += tradingDaysPerMonth * stepMonths) {
    // Need enough forward data to simulate execution
    const forwardEnd = idx + tradingDaysPerMonth * months;
    if (forwardEnd > prices.length) break;

    const bm = buildBenchmarksAt(prices, dates, idx);
    if (!bm) continue;

    const { signal, confidence } = heuristicSignal(bm);
    const weights = monthlyWeights(signal, months, bm.vol_30d_ann);

    // Compute weighted execution price (strategy allocation)
    let weightedExecPrice = 0;
    let benchmarkExecPrice = 0;
    const equalWeight = 1 / months;

    for (let m = 0; m < months; m++) {
      const monthStart = idx + tradingDaysPerMonth * m;
      const monthEnd = Math.min(idx + tradingDaysPerMonth * (m + 1), prices.length);
      const monthPrices = prices.slice(monthStart, monthEnd);
      if (monthPrices.length === 0) continue;
      const monthAvg = mean(monthPrices);

      weightedExecPrice += weights[m] * monthAvg;
      benchmarkExecPrice += equalWeight * monthAvg;
    }

    const savingsPerLb = benchmarkExecPrice - weightedExecPrice;
    const savingsPct = benchmarkExecPrice > 0
      ? (savingsPerLb / benchmarkExecPrice) * 100
      : 0;

    steps.push({
      decision_date: dates[idx],
      signal,
      confidence,
      price_at_decision: Math.round(prices[idx] * 10000) / 10000,
      pct_rank_1y: bm.pct_rank_1y,
      z_score_1y: bm.z_score_1y,
      vol_30d_ann: bm.vol_30d_ann,
      weighted_exec_price: Math.round(weightedExecPrice * 10000) / 10000,
      benchmark_exec_price: Math.round(benchmarkExecPrice * 10000) / 10000,
      savings_per_lb: Math.round(savingsPerLb * 10000) / 10000,
      savings_pct: Math.round(savingsPct * 100) / 100,
    });
  }

  return { steps, summary: computeSummary(steps) };
}

/* ------------------------------------------------------------------ */
/*  Summary statistics                                                 */
/* ------------------------------------------------------------------ */

function computeSummary(steps: BacktestStep[]): BacktestSummary {
  if (steps.length === 0) {
    return {
      total_steps: 0,
      hit_rate_pct: 0,
      avg_savings_per_lb: 0,
      avg_savings_pct: 0,
      worst_savings_pct: 0,
      best_savings_pct: 0,
      signal_counts: {},
      avg_savings_by_signal: {},
    };
  }

  const hits = steps.filter((s) => s.savings_pct > 0).length;

  const signalCounts: Record<string, number> = {};
  const signalSavingsSum: Record<string, number> = {};

  for (const s of steps) {
    signalCounts[s.signal] = (signalCounts[s.signal] ?? 0) + 1;
    signalSavingsSum[s.signal] = (signalSavingsSum[s.signal] ?? 0) + s.savings_pct;
  }

  const avgSavingsBySignal: Record<string, number> = {};
  for (const sig of Object.keys(signalCounts)) {
    avgSavingsBySignal[sig] = Math.round((signalSavingsSum[sig] / signalCounts[sig]) * 100) / 100;
  }

  return {
    total_steps: steps.length,
    hit_rate_pct: Math.round((hits / steps.length) * 10000) / 100,
    avg_savings_per_lb: Math.round(mean(steps.map((s) => s.savings_per_lb)) * 10000) / 10000,
    avg_savings_pct: Math.round(mean(steps.map((s) => s.savings_pct)) * 100) / 100,
    worst_savings_pct: Math.round(Math.min(...steps.map((s) => s.savings_pct)) * 100) / 100,
    best_savings_pct: Math.round(Math.max(...steps.map((s) => s.savings_pct)) * 100) / 100,
    signal_counts: signalCounts,
    avg_savings_by_signal: avgSavingsBySignal,
  };
}
