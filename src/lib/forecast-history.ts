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
  return a.start <= b.end && b.start <= a.end;
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
    .filter((row) => !currentMarketDate || row.target_date < currentMarketDate)
    .sort(
      (a, b) =>
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
