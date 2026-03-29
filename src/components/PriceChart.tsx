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
} from "recharts";
import type { PricePoint, Benchmarks } from "@/lib/types";

export default function PriceChart({
  prices,
  benchmarks,
}: {
  prices: PricePoint[];
  benchmarks: Benchmarks;
}) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={prices}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2979ff" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#2979ff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={(v: string) => v.slice(5)}
            interval={Math.floor(prices.length / 8)}
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
          <Area
            type="monotone"
            dataKey="close"
            name="Cotton #2"
            stroke="#2979ff"
            fill="url(#priceGrad)"
            strokeWidth={2}
            dot={false}
          />
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
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
