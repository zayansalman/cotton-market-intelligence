"use client";

import type { Benchmarks, PurchaserInput } from "@/lib/types";

interface KDenseHandoffProps {
  purchaserInput: PurchaserInput;
  benchmarks: Benchmarks;
}

/**
 * Feature-flagged "Open in K-Dense" button.
 *
 * Enabled via NEXT_PUBLIC_KDENSE_ENABLED=true
 * URL configurable via NEXT_PUBLIC_KDENSE_URL
 */
export default function KDenseHandoff({
  purchaserInput,
  benchmarks,
}: KDenseHandoffProps) {
  const enabled = process.env.NEXT_PUBLIC_KDENSE_ENABLED === "true";
  const baseUrl =
    process.env.NEXT_PUBLIC_KDENSE_URL ?? "https://kdense.web.app";

  if (!enabled) return null;

  const handleClick = () => {
    const context = {
      source: "cmi",
      tonnage: purchaserInput.demand.required_tonnes,
      horizon_months: purchaserInput.demand.planning_horizon_months,
      origins: purchaserInput.quality?.preferred_origins,
      current_price: benchmarks.current_price,
      pct_rank_1y: benchmarks.pct_rank_1y,
      z_score_1y: benchmarks.z_score_1y,
      vol_30d_ann: benchmarks.vol_30d_ann,
    };
    const encoded = btoa(JSON.stringify(context));
    window.open(`${baseUrl}?cmi_context=${encoded}`, "_blank");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-4 py-2 transition-colors flex items-center gap-2"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeWidth={1.5} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
      Open in K-Dense
    </button>
  );
}
