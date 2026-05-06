"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  Brush,
} from "recharts";
import type { PricePoint, Benchmarks } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Forecast data shape                                                */
/* ------------------------------------------------------------------ */

export interface ForecastPoint {
  date: string;
  predicted_price: number;
  lower_price: number;
  upper_price: number;
  horizon: string;
  provider?: string;
}

export interface ForecastOverlayData {
  points: ForecastPoint[];
  model_name: string;
  direction: "up" | "down" | "flat";
}

/* ------------------------------------------------------------------ */
/*  Chart data: merged historical + forecast                           */
/* ------------------------------------------------------------------ */

interface ChartPoint {
  date: string;
  close: number | null;
  ma50: number | null;
  ma200: number | null;
  forecast: number | null;
  forecast_upper: number | null;
  forecast_lower: number | null;
  backtest_pred?: number | null;
  prediction_history?: number | null;
}

function mergeData(
  prices: PricePoint[],
  forecast: ForecastOverlayData | undefined,
  predictionHistory: PredictionHistoryPoint[] | undefined
): ChartPoint[] {
  const points: ChartPoint[] = prices.map((p) => ({
    date: p.date,
    close: p.close,
    ma50: p.ma50,
    ma200: p.ma200,
    forecast: null,
    forecast_upper: null,
    forecast_lower: null,
  }));
  const pointByDate = new Map(points.map((point) => [point.date, point]));

  if (forecast && forecast.points.length > 0) {
    // Add a bridge point: last historical price = first forecast point
    const lastPrice = prices[prices.length - 1];
    if (lastPrice) {
      points[points.length - 1].forecast = lastPrice.close;
      points[points.length - 1].forecast_upper = lastPrice.close;
      points[points.length - 1].forecast_lower = lastPrice.close;
    }

    // Append forecast points beyond historical data
    for (const fp of forecast.points) {
      // Skip if date already exists in historical
      if (pointByDate.has(fp.date)) continue;

      const point: ChartPoint = {
        date: fp.date,
        close: null,
        ma50: null,
        ma200: null,
        forecast: fp.predicted_price,
        forecast_upper: fp.upper_price,
        forecast_lower: fp.lower_price,
      };
      points.push(point);
      pointByDate.set(fp.date, point);
    }
  }

  if (predictionHistory?.length) {
    for (const prediction of predictionHistory) {
      let point = pointByDate.get(prediction.date);
      if (!point) {
        point = {
          date: prediction.date,
          close: null,
          ma50: null,
          ma200: null,
          forecast: null,
          forecast_upper: null,
          forecast_lower: null,
        };
        points.push(point);
        pointByDate.set(prediction.date, point);
      }
      point.prediction_history = prediction.predicted_price;
    }
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/** Backtest prediction point — model's historical prediction at a given date. */
export interface BacktestPrediction {
  date: string;
  predicted_price: number;
  actual_price: number;
  direction_correct: boolean;
}

/** Stored forecast made by the live prediction API and later compared to actual market prices. */
export interface PredictionHistoryPoint {
  date: string;
  target_date?: string;
  prediction_date?: string;
  created_at?: string;
  horizon?: string;
  current_price?: number | null;
  predicted_price: number;
  actual_price: number | null;
  direction_correct: boolean | null;
  error_pct: number | null;
  model_id?: string;
  model_name?: string | null;
}

export interface PredictionPerformanceMetrics {
  total: number;
  resolved: number;
  pending: number;
  direction_accuracy: number | null;
  mean_absolute_error_pct: number | null;
  latest_absolute_error_pct: number | null;
}

export default function PriceChart({
  prices,
  benchmarks,
  forecast,
  backtestPredictions,
  predictionHistory,
  predictionPerformance,
}: {
  prices: PricePoint[];
  benchmarks: Benchmarks;
  forecast?: ForecastOverlayData;
  backtestPredictions?: BacktestPrediction[];
  predictionHistory?: PredictionHistoryPoint[];
  predictionPerformance?: PredictionPerformanceMetrics | null;
}) {
  const [showMA50, setShowMA50] = useState(true);
  const [showMA200, setShowMA200] = useState(true);
  const [showForecast, setShowForecast] = useState(true);
  const [showPredictionHistory, setShowPredictionHistory] = useState(true);
  const [showBacktest, setShowBacktest] = useState(false);

  const hasForecast = forecast && forecast.points.length > 0 && showForecast;
  const hasPredictionHistory =
    predictionHistory && predictionHistory.length > 0 && showPredictionHistory;
  const data = mergeData(
    prices,
    forecast,
    hasPredictionHistory ? predictionHistory : undefined
  );
  const hasBacktest = backtestPredictions && backtestPredictions.length > 0 && showBacktest;

  // Merge backtest predictions into chart data
  if (hasBacktest) {
    const btMap = new Map(backtestPredictions!.map((p) => [p.date, p]));
    for (const point of data) {
      const bt = btMap.get(point.date);
      if (bt) {
        point.backtest_pred = bt.predicted_price;
      }
    }
  }

  // Color for forecast line based on direction
  const forecastColor =
    forecast?.direction === "up"
      ? "#22c55e"
      : forecast?.direction === "down"
        ? "#ef4444"
        : "#a78bfa";
  const performanceSummary =
    predictionPerformance && predictionPerformance.total > 0
      ? [
          `${predictionPerformance.resolved} resolved`,
          `${predictionPerformance.pending} pending`,
          predictionPerformance.direction_accuracy != null
            ? `${(predictionPerformance.direction_accuracy * 100).toFixed(0)}% direction hit rate`
            : null,
          predictionPerformance.mean_absolute_error_pct != null
            ? `${predictionPerformance.mean_absolute_error_pct.toFixed(2)}% mean abs error`
            : null,
        ].filter(Boolean).join(" | ")
      : null;

  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      {/* Toggle controls */}
      <div className="flex flex-wrap gap-2 mb-3">
        {[
          { label: "50d MA", active: showMA50, toggle: () => setShowMA50(!showMA50), color: "#ff9100" },
          { label: "200d MA", active: showMA200, toggle: () => setShowMA200(!showMA200), color: "#ff1744" },
          ...(forecast?.points.length ? [{ label: "Forecast", active: showForecast, toggle: () => setShowForecast(!showForecast), color: forecastColor }] : []),
          ...(predictionHistory?.length ? [{ label: "Previous Forecasts", active: showPredictionHistory, toggle: () => setShowPredictionHistory(!showPredictionHistory), color: "#38bdf8" }] : []),
          ...(backtestPredictions?.length ? [{ label: "Strategy Backtest", active: showBacktest, toggle: () => setShowBacktest(!showBacktest), color: "#a78bfa" }] : []),
        ].map((t) => (
          <button
            key={t.label}
            onClick={t.toggle}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              t.active
                ? "border-current opacity-100"
                : "border-zinc-700 opacity-40"
            }`}
            style={{ color: t.color }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {hasForecast && (
        <div className="flex items-center gap-2 mb-2 text-xs text-zinc-400">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: forecastColor }}
          />
          <span>
            Forecast: {forecast.model_name} ({forecast.points.length} days ahead)
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-500">Shaded area = 95% confidence interval</span>
        </div>
      )}
      {performanceSummary && (
        <div className="flex items-center gap-2 mb-2 text-xs text-zinc-400">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
          <span>Previous forecasts: {performanceSummary}</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={data}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2979ff" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#2979ff" stopOpacity={0} />
            </linearGradient>
            {hasForecast && (
              <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={forecastColor} stopOpacity={0.15} />
                <stop offset="95%" stopColor={forecastColor} stopOpacity={0.02} />
              </linearGradient>
            )}
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={(v: string) => v.slice(5)}
            interval={Math.floor(data.length / 8)}
            axisLine={{ stroke: "#333" }}
          />
          <YAxis
            tick={{ fill: "#888", fontSize: 11 }}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            axisLine={{ stroke: "#333" }}
            width={65}
          />
          <Tooltip
            contentStyle={{
              background: "#1a1a2e",
              border: "1px solid #333",
              borderRadius: 8,
              fontSize: 13,
            }}
            labelStyle={{ color: "#aaa" }}
            formatter={(val) => {
              const n = Number(val);
              return Number.isFinite(n) ? `$${n.toFixed(4)}` : "n/a";
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <ReferenceLine
            y={benchmarks.current_price}
            stroke="#ffffff33"
            strokeDasharray="3 3"
            label={{
              value: `Current: $${benchmarks.current_price.toFixed(4)}`,
              fill: "#aaa",
              fontSize: 11,
              position: "right",
            }}
          />

          {/* Historical price */}
          <Area
            type="monotone"
            dataKey="close"
            name="Cotton #2"
            stroke="#2979ff"
            fill="url(#priceGrad)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />

          {/* Moving averages (toggleable) */}
          {showMA50 && (
            <Line
              type="monotone"
              dataKey="ma50"
              name="50d MA"
              stroke="#ff9100"
              strokeWidth={1}
              strokeDasharray="5 5"
              dot={false}
              connectNulls
            />
          )}
          {showMA200 && (
            <Line
              type="monotone"
              dataKey="ma200"
              name="200d MA"
              stroke="#ff1744"
              strokeWidth={1}
              strokeDasharray="2 4"
              dot={false}
              connectNulls
            />
          )}

          {/* Stored forecast history (toggleable) */}
          {hasPredictionHistory && (
            <Line
              type="monotone"
              dataKey="prediction_history"
              name="Previous Forecasts"
              stroke="#38bdf8"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={{ r: 2.5, fill: "#38bdf8" }}
              connectNulls={false}
            />
          )}

          {/* Strategy backtest predictions (toggleable) */}
          {hasBacktest && (
            <Line
              type="monotone"
              dataKey="backtest_pred"
              name="Strategy Backtest"
              stroke="#a78bfa"
              strokeWidth={1.5}
              strokeDasharray="3 2"
              dot={{ r: 2, fill: "#a78bfa" }}
              connectNulls={false}
            />
          )}

          {/* Forecast confidence band */}
          {hasForecast && (
            <>
              <Area
                type="monotone"
                dataKey="forecast_upper"
                name="Upper 95%"
                stroke="none"
                fill="url(#forecastGrad)"
                dot={false}
                connectNulls={false}
                legendType="none"
              />
              <Area
                type="monotone"
                dataKey="forecast_lower"
                name="Lower 95%"
                stroke="none"
                fill="#18181b"
                dot={false}
                connectNulls={false}
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="forecast"
                name="Forecast"
                stroke={forecastColor}
                strokeWidth={2.5}
                strokeDasharray="6 3"
                dot={false}
                connectNulls={false}
              />
            </>
          )}

          <Brush
            dataKey="date"
            height={24}
            stroke="#666"
            travellerWidth={10}
            tickFormatter={(v: string) => v.slice(5)}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
