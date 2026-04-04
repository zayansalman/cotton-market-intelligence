"use client";

import { useState, useEffect } from "react";
import type { Benchmarks, LandedCostResponse } from "@/lib/types";

export function useLandedCost(benchmarks: Benchmarks | undefined) {
  const [landedCost, setLandedCost] = useState<LandedCostResponse | null>(null);
  const [landedCostLoading, setLandedCostLoading] = useState(false);
  const [basisCentsLb, setBasisCentsLb] = useState(7);
  const [freightUsdT, setFreightUsdT] = useState(85);
  const [fxBdtUsd, setFxBdtUsd] = useState(117);

  useEffect(() => {
    async function loadLandedCost() {
      if (!benchmarks) return;
      setLandedCostLoading(true);
      try {
        const params = new URLSearchParams({
          futures_usd_lb: String(benchmarks.current_price),
          low_futures_usd_lb: String(benchmarks.low_1y),
          high_futures_usd_lb: String(benchmarks.high_1y),
          basis_cents_lb: String(basisCentsLb),
          freight_usd_t: String(freightUsdT),
          fx_bdt_usd: String(fxBdtUsd),
        });
        const res = await fetch(`/api/landed-cost?${params.toString()}`);
        if (res.ok) {
          setLandedCost(await res.json());
        }
      } catch {
        // Landed cost is additive insight; avoid blocking primary strategy flow.
      } finally {
        setLandedCostLoading(false);
      }
    }

    loadLandedCost();
  }, [benchmarks, basisCentsLb, freightUsdT, fxBdtUsd]);

  return {
    landedCost,
    landedCostLoading,
    basisCentsLb,
    setBasisCentsLb,
    freightUsdT,
    setFreightUsdT,
    fxBdtUsd,
    setFxBdtUsd,
  };
}
