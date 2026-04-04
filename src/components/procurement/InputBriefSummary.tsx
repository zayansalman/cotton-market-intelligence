"use client";

import type { PurchaserInput } from "@/lib/types";

interface InputBriefSummaryProps {
  input: PurchaserInput;
  advancedMode: boolean;
}

export default function InputBriefSummary({
  input,
  advancedMode,
}: InputBriefSummaryProps) {
  const { demand, timeline, quality, commercial, logistics, finance } = input;

  const items: Array<{ label: string; value: string }> = [
    {
      label: "Volume",
      value: `${demand.required_tonnes.toLocaleString()}t / ${demand.planning_horizon_months}mo`,
    },
  ];

  if (!advancedMode) return null;

  if (timeline?.urgency_level && timeline.urgency_level !== "standard") {
    items.push({ label: "Urgency", value: timeline.urgency_level });
  }
  if (quality?.preferred_origins?.length) {
    items.push({
      label: "Origins",
      value: quality.preferred_origins.slice(0, 3).join(", "),
    });
  }
  if (commercial?.pricing_mode) {
    items.push({ label: "Pricing", value: commercial.pricing_mode });
  }
  if (logistics?.incoterm) {
    items.push({
      label: "Incoterm",
      value: `${logistics.incoterm}${logistics.discharge_port ? " " + logistics.discharge_port : ""}`,
    });
  }
  if (finance?.payment_term) {
    items.push({
      label: "Payment",
      value: finance.payment_term.replace(/_/g, " "),
    });
  }

  if (items.length <= 1) return null;

  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-1">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
        Input Brief
      </p>
      {items.map(({ label, value }) => (
        <div key={label} className="flex justify-between text-xs">
          <span className="text-zinc-500">{label}</span>
          <span className="text-zinc-300">{value}</span>
        </div>
      ))}
    </div>
  );
}
