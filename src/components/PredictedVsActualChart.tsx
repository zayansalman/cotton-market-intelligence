"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LabelList,
  Cell,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  Predicted vs actual — resolved prediction track record             */
/* ------------------------------------------------------------------ */

/**
 * One stored prediction. These come from the forecast-history table: real
 * predictions the system emitted live, plus point-in-time "as-of" forecasts it
 * WOULD have generated from price history alone (model_id "historical_heuristic").
 * Both are honest walk-forward values — never backtests with lookahead.
 */
export interface PredictionHistoryEntry {
  target_date: string;
  prediction_date: string;
  predicted_price: number;
  actual_price: number | null;
  direction_correct: boolean | null;
  error_pct: number | null;
  model_id: string;
  model_name: string | null;
}

const RECONSTRUCTED_MODEL_ID = "historical_heuristic";

/** Recharts LabelList hands the formatter `string | number | undefined`. */
function moneyLabel(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(3)}` : "";
}

export interface BarDatum {
  key: string;
  label: string;
  predicted: number;
  actual: number;
  directionCorrect: boolean | null;
  errorPct: number | null;
  modelName: string;
  reconstructed: boolean;
}

const PREDICTED_COLOR = "#2979ff";
const ACTUAL_COLOR = "#22c55e";
const ACTUAL_COLOR_RECON = "#64748b"; // muted — reconstructed "would have" actuals

/** Resolved entries only (actual known), oldest→newest, capped to the most recent N. */
export function toBarData(entries: PredictionHistoryEntry[], maxBars: number): BarDatum[] {
  return entries
    .filter((e) => e.actual_price != null && Number.isFinite(e.predicted_price))
    .sort((a, b) => a.target_date.localeCompare(b.target_date))
    .slice(-maxBars)
    .map((e) => ({
      key: `${e.model_id}-${e.prediction_date}-${e.target_date}`,
      label: e.target_date.slice(5), // MM-DD
      predicted: e.predicted_price,
      actual: e.actual_price as number,
      directionCorrect: e.direction_correct,
      errorPct: e.error_pct,
      modelName: e.model_name ?? e.model_id,
      reconstructed: e.model_id === RECONSTRUCTED_MODEL_ID,
    }));
}

/** Padded, non-zero y-domain so a narrow price band stays readable. Bars carry
 *  their exact dollar value as a label, so the zoomed axis cannot mislead. */
export function paddedDomain(data: BarDatum[]): [number, number] {
  const values = data.flatMap((d) => [d.predicted, d.actual]);
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.25, max * 0.02);
  return [Math.max(0, min - pad), max + pad];
}

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: BarDatum;
}

function PvaTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;
  return (
    <div className="rounded-lg border border-zinc-700 bg-[#1a1a2e] px-3 py-2 text-xs">
      <div className="mb-1 font-medium text-zinc-200">
        Target {datum.label}
        {datum.reconstructed && (
          <span className="ml-1 text-zinc-500">· reconstructed as-of</span>
        )}
      </div>
      <div className="text-zinc-400">Predicted: ${datum.predicted.toFixed(4)}</div>
      <div className="text-zinc-400">Actual: ${datum.actual.toFixed(4)}</div>
      {datum.errorPct != null && (
        <div className="text-zinc-400">
          Error: {Math.abs(datum.errorPct).toFixed(2)}%
        </div>
      )}
      {datum.directionCorrect != null && (
        <div className={datum.directionCorrect ? "text-emerald-400" : "text-red-400"}>
          Direction {datum.directionCorrect ? "correct" : "missed"}
        </div>
      )}
      <div className="mt-1 text-[10px] text-zinc-500">{datum.modelName}</div>
    </div>
  );
}

export default function PredictedVsActualChart({
  entries,
  maxBars = 10,
}: {
  entries: PredictionHistoryEntry[];
  maxBars?: number;
}) {
  const data = toBarData(entries, maxBars);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
        No resolved predictions yet. Once a forecast&apos;s target date passes and the
        actual Cotton #2 price is known, its predicted-vs-actual bars appear here.
      </div>
    );
  }

  const [yMin, yMax] = paddedDomain(data);
  const hasReconstructed = data.some((d) => d.reconstructed);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-1 flex items-center gap-2 text-sm text-zinc-300">
        <span>Predicted vs actual</span>
        <span className="text-zinc-600">|</span>
        <span className="text-xs text-zinc-500">
          {data.length} resolved prediction{data.length === 1 ? "" : "s"}, most recent
        </span>
      </div>
      <div className="mb-2 text-xs text-zinc-500">
        Each pair is one prediction we made — or, for reconstructed rows, would have
        generated from price history as of that date — against the price that actually
        printed. Not a backtest. Y-axis is zoomed to the value range; exact prices are
        labelled on every bar.
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} barCategoryGap="22%" barGap={2}>
          <XAxis
            dataKey="label"
            tick={{ fill: "#888", fontSize: 11 }}
            axisLine={{ stroke: "#333" }}
            tickLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            axisLine={{ stroke: "#333" }}
            width={65}
          />
          <Tooltip content={<PvaTooltip />} cursor={{ fill: "#ffffff08" }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="predicted" name="Predicted" fill={PREDICTED_COLOR} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey="predicted"
              position="top"
              formatter={moneyLabel}
              style={{ fill: "#9ca3af", fontSize: 9 }}
            />
          </Bar>
          <Bar dataKey="actual" name="Actual" radius={[3, 3, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={d.key}
                fill={d.reconstructed ? ACTUAL_COLOR_RECON : ACTUAL_COLOR}
              />
            ))}
            <LabelList
              dataKey="actual"
              position="top"
              formatter={moneyLabel}
              style={{ fill: "#9ca3af", fontSize: 9 }}
            />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PREDICTED_COLOR }} />
          Predicted
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ACTUAL_COLOR }} />
          Actual
        </span>
        {hasReconstructed && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: ACTUAL_COLOR_RECON }}
            />
            Actual (reconstructed as-of, not a live prediction)
          </span>
        )}
      </div>
    </div>
  );
}
