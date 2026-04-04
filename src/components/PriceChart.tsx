"use client";

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
}

function mergeData(
  prices: PricePoint[],
  forecast: ForecastOverlayData | undefined
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

  if (!forecast || forecast.points.length === 0) return points;

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
    if (points.some((p) => p.date === fp.date)) continue;

    points.push({
      date: fp.date,
      close: null,
      ma50: null,
      ma200: null,
      forecast: fp.predicted_price,
      forecast_upper: fp.upper_price,
      forecast_lower: fp.lower_price,
    });
  }

  return points;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PriceChart({
  prices,
  benchmarks,
  forecast,
}: {
  prices: PricePoint[];
  benchmarks: Benchmarks;
  forecast?: ForecastOverlayData;
}) {
  const data = mergeData(prices, forecast);
  const hasForecast = forecast && forecast.points.length > 0;

  // Color for forecast line based on direction
  const forecastColor =
    forecast?.direction === "up"
      ? "#22c55e"
      : forecast?.direction === "down"
        ? "#ef4444"
        : "#a78bfa";

  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
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
            formatter={(val) => [
              `$${Number(val).toFixed(4)}`,
            ]}
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

          {/* Moving averages */}
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
