"use client";

import type { Benchmarks } from "@/lib/types";
import MetricCard from "./MetricCard";

interface MarketMetricsProps {
  benchmarks: Benchmarks;
}

export default function MarketMetrics({ benchmarks: bm }: MarketMetricsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <MetricCard
        label="Cotton #2"
        value={`$${bm.current_price.toFixed(4)}/lb`}
        delta={`${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}% (30d)`}
        deltaColor={bm.change_30d_pct < 0 ? "green" : "red"}
      />
      <MetricCard
        label="1Y Percentile"
        value={`${(bm.pct_rank_1y * 100).toFixed(0)}%`}
        delta={
          bm.pct_rank_1y < 0.3
            ? "Cheap"
            : bm.pct_rank_1y > 0.7
              ? "Expensive"
              : "Mid-range"
        }
        deltaColor={
          bm.pct_rank_1y < 0.3
            ? "green"
            : bm.pct_rank_1y > 0.7
              ? "red"
              : "neutral"
        }
      />
      <MetricCard
        label="Z-Score (1Y)"
        value={bm.z_score_1y.toFixed(2)}
      />
      <MetricCard
        label="Volatility (30d)"
        value={`${bm.vol_30d_ann.toFixed(1)}%`}
        delta={bm.vol_30d_ann > 30 ? "Elevated" : "Normal"}
        deltaColor={bm.vol_30d_ann > 30 ? "red" : "green"}
      />
      <MetricCard
        label="200d MA"
        value={`$${bm.ma_200d.toFixed(4)}`}
        delta={bm.above_ma_200d ? "Above" : "Below"}
        deltaColor={bm.above_ma_200d ? "green" : "red"}
      />
    </div>
  );
}
