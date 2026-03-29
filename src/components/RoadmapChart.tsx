"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import type { MonthlyPlan } from "@/lib/types";

const COLORS = [
  "#2979ff",
  "#448aff",
  "#5c9aff",
  "#75aaff",
  "#8ebaff",
  "#a7caff",
  "#c0daff",
  "#d9eaff",
  "#e8f0ff",
  "#f0f5ff",
  "#f8faff",
  "#ffffff",
];

export default function RoadmapChart({ plan }: { plan: MonthlyPlan[] }) {
  const data = plan.map((p) => ({
    name: `M${p.month}`,
    tonnes: p.tonnes,
    pct: p.pct,
    rationale: p.rationale,
  }));

  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <XAxis
            dataKey="name"
            tick={{ fill: "#aaa", fontSize: 12 }}
            axisLine={{ stroke: "#333" }}
          />
          <YAxis
            tick={{ fill: "#aaa", fontSize: 11 }}
            axisLine={{ stroke: "#333" }}
            tickFormatter={(v: number) => `${v.toLocaleString()}t`}
            width={70}
          />
          <Tooltip
            contentStyle={{
              background: "#1a1a2e",
              border: "1px solid #333",
              borderRadius: 8,
              fontSize: 13,
            }}
            formatter={(val) => [`${Number(val).toLocaleString()} tonnes`]}
          />
          <Bar dataKey="tonnes" radius={[6, 6, 0, 0]}>
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={COLORS[i % COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
