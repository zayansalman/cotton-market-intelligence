import type { Benchmarks, PricePoint } from "@/lib/types";

export type ForecastHorizon = "5d" | "21d" | "63d";

export interface StoredForecastPoint {
  date: string;
  predicted_price: number;
  lower_price: number;
  upper_price: number;
  horizon: string;
}

export interface ForecastHistoryCandidate {
  created_at: string;
  prediction_date: string;
  target_date: string;
  forecast_points: unknown;
}

export interface HistoricalForecastSnapshot {
  prediction_date: string;
  current_price: number;
  horizon: ForecastHorizon;
  target_date: string;
  predicted_price: number;
  lower_price: number;
  upper_price: number;
  forecast_points: StoredForecastPoint[];
  direction: "up" | "down" | "flat";
  confidence: number;
  model_id: string;
  model_name: string;
  reasoning: string;
  actual_price: number | null;
  direction_correct: boolean | null;
  error_pct: number | null;
}

export function isStoredForecastPoint(value: unknown): value is StoredForecastPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<StoredForecastPoint>;
  return (
    typeof point.date === "string" &&
    typeof point.horizon === "string" &&
    typeof point.predicted_price === "number" &&
    typeof point.lower_price === "number" &&
    typeof point.upper_price === "number"
  );
}

export function normalizeForecastPoints(value: unknown): StoredForecastPoint[] {
  return Array.isArray(value) ? value.filter(isStoredForecastPoint) : [];
}

function overlaps(
  a: { start: string; end: string },
  b: { start: string; end: string }
): boolean {
  return a.start < b.end && b.start < a.end;
}

export function selectNonOverlappingPreviousForecasts<
  T extends ForecastHistoryCandidate,
>(
  rows: T[],
  options: { currentMarketDate?: string | null; maxCount?: number } = {}
): T[] {
  const maxCount = options.maxCount ?? 2;
  const currentMarketDate = options.currentMarketDate ?? null;
  const selected: T[] = [];

  const candidates = [...rows]
    .filter((row) => normalizeForecastPoints(row.forecast_points).length >= 2)
    .filter((row) => !currentMarketDate || row.prediction_date < currentMarketDate)
    .filter((row) => !currentMarketDate || row.target_date <= currentMarketDate)
    .sort(
      (a, b) =>
        b.target_date.localeCompare(a.target_date) ||
        b.prediction_date.localeCompare(a.prediction_date) ||
        b.created_at.localeCompare(a.created_at)
    );

  for (const row of candidates) {
    if (selected.length >= maxCount) break;
    if (row.target_date < row.prediction_date) continue;

    const range = { start: row.prediction_date, end: row.target_date };
    const conflicts = selected.some((selectedRow) =>
      overlaps(range, {
        start: selectedRow.prediction_date,
        end: selectedRow.target_date,
      })
    );

    if (!conflicts) selected.push(row);
  }

  return selected;
}

function horizonDaysFor(horizon: ForecastHorizon): number {
  return horizon === "5d" ? 5 : horizon === "21d" ? 21 : 63;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length
  );
}

function ma(values: number[], window: number, idx: number): number | null {
  if (idx < window - 1) return null;
  let sum = 0;
  for (let i = idx - window + 1; i <= idx; i++) sum += values[i];
  return sum / window;
}

function pctRank(values: number[], value: number): number {
  return values.filter((x) => x < value).length / values.length;
}

function directionFromReturn(value: number): "up" | "down" | "flat" {
  if (value > 0.003) return "up";
  if (value < -0.003) return "down";
  return "flat";
}

function buildBenchmarks(prices: PricePoint[]): Benchmarks | null {
  if (prices.length < 253) return null;

  const closes = prices.map((point) => point.close);
  const n = closes.length;
  const current = closes[n - 1];
  const y1 = closes.slice(-Math.min(252, n));
  const y5 = closes.slice(-Math.min(1260, n));
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(closes[i] / closes[i - 1] - 1);
  }

  const change = (lookback: number) =>
    n >= lookback ? ((current / closes[n - lookback]) - 1) * 100 : 0;
  const vol = (rets: number[]) => std(rets) * Math.sqrt(252) * 100;
  const ma50 = ma(closes, 50, n - 1) ?? current;
  const ma200 = ma(closes, 200, n - 1) ?? current;
  const y1Std = std(y1);

  return {
    current_price: round(current, 4),
    price_date: prices[n - 1].date,
    change_30d_pct: round(change(22), 2),
    change_90d_pct: round(change(66), 2),
    pct_rank_1y: round(pctRank(y1, current), 4),
    pct_rank_5y: round(pctRank(y5, current), 4),
    z_score_1y: y1Std > 0 ? round((current - mean(y1)) / y1Std, 2) : 0,
    vol_30d_ann: round(vol(returns.slice(-Math.min(22, returns.length))), 1),
    vol_90d_ann: round(vol(returns.slice(-Math.min(66, returns.length))), 1),
    ma_50d: round(ma50, 4),
    ma_200d: round(ma200, 4),
    above_ma_50d: current > ma50,
    above_ma_200d: current > ma200,
    high_1y: round(Math.max(...y1), 4),
    low_1y: round(Math.min(...y1), 4),
  };
}

function forecastReturn(benchmarks: Benchmarks, horizon: ForecastHorizon): number {
  const momentum = benchmarks.change_30d_pct / 100;
  const meanReversion = (0.5 - benchmarks.pct_rank_1y) * 0.03;
  const trend =
    (benchmarks.above_ma_50d ? 0.008 : -0.008) +
    (benchmarks.above_ma_200d ? 0.006 : -0.006);
  const horizonScale = horizon === "5d" ? 0.45 : horizon === "63d" ? 1.35 : 1;
  const raw = (momentum * 0.58 + meanReversion * 0.32 + trend * 0.1) * horizonScale;
  const cap = horizon === "5d" ? 0.04 : horizon === "63d" ? 0.12 : 0.08;
  return Math.max(-cap, Math.min(cap, raw));
}

function latestIndexOnOrBefore(prices: PricePoint[], date: string): number {
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].date <= date) return i;
  }
  return -1;
}

export function buildHistoricalPreviousForecasts(
  prices: PricePoint[],
  currentMarketDate: string,
  options: { horizon?: ForecastHorizon; count?: number } = {}
): HistoricalForecastSnapshot[] {
  const horizon = options.horizon ?? "21d";
  const count = options.count ?? 2;
  const horizonDays = horizonDaysFor(horizon);
  const currentIndex = latestIndexOnOrBefore(prices, currentMarketDate);
  if (currentIndex < 0) return [];

  const forecasts: HistoricalForecastSnapshot[] = [];

  for (let slot = 0; slot < count; slot++) {
    const targetIndex = currentIndex - slot * horizonDays;
    const cutoffIndex = targetIndex - horizonDays;
    if (cutoffIndex < 252 || targetIndex <= cutoffIndex) continue;

    const asOfPrices = prices.slice(0, cutoffIndex + 1);
    const benchmarks = buildBenchmarks(asOfPrices);
    if (!benchmarks) continue;

    const startPrice = benchmarks.current_price;
    const predictedReturn = forecastReturn(benchmarks, horizon);
    const predictedPrice = round(startPrice * (1 + predictedReturn), 4);
    const realizedVolInterval =
      startPrice *
      (benchmarks.vol_30d_ann / 100) *
      Math.sqrt(horizonDays / 252) *
      1.96;
    const lowerPrice = round(Math.max(0.01, predictedPrice - realizedVolInterval), 4);
    const upperPrice = round(predictedPrice + realizedVolInterval, 4);
    const targetPoint = prices[targetIndex];
    const actualPrice = round(targetPoint.close, 4);
    const direction = directionFromReturn(predictedReturn);
    const actualReturn = (actualPrice - startPrice) / startPrice;
    const directionCorrect = directionFromReturn(actualReturn) === direction;
    const errorPct = round(((predictedPrice - actualPrice) / actualPrice) * 100, 3);
    const path = prices.slice(cutoffIndex, targetIndex + 1);
    const points = path.map((point, index) => {
      const t = path.length > 1 ? index / (path.length - 1) : 0;
      const eased = 1 - Math.pow(1 - t, 1.5);
      return {
        date: point.date,
        predicted_price: round(startPrice + (predictedPrice - startPrice) * eased, 4),
        lower_price: round(startPrice + (lowerPrice - startPrice) * eased, 4),
        upper_price: round(startPrice + (upperPrice - startPrice) * eased, 4),
        horizon,
      };
    });

    forecasts.push({
      prediction_date: benchmarks.price_date,
      current_price: startPrice,
      horizon,
      target_date: targetPoint.date,
      predicted_price: predictedPrice,
      lower_price: lowerPrice,
      upper_price: upperPrice,
      forecast_points: points,
      direction,
      confidence: 35,
      model_id: "historical_heuristic",
      model_name: "Historical as-of forecast",
      reasoning:
        `Backfilled once using only Cotton #2 price history through ${benchmarks.price_date}. ` +
        `Signals: ${benchmarks.change_30d_pct.toFixed(1)}% 30d momentum, ` +
        `${(benchmarks.pct_rank_1y * 100).toFixed(0)}th percentile 1Y rank, ` +
        `${benchmarks.vol_30d_ann.toFixed(1)}% annualized 30d volatility.`,
      actual_price: actualPrice,
      direction_correct: directionCorrect,
      error_pct: errorPct,
    });
  }

  return forecasts;
}
