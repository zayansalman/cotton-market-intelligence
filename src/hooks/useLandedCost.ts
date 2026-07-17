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
    if (!benchmarks) {
      setLandedCostLoading(false);
      return;
    }

    // Guard against overlapping fetches: abort the previous request on cleanup
    // and ignore any late/aborted response so a slow older request can never
    // overwrite the newest inputs' result (or setState after unmount).
    const controller = new AbortController();
    let ignore = false;

    async function loadLandedCost() {
      setLandedCostLoading(true);
      try {
        const params = new URLSearchParams({
          futures_usd_lb: String(benchmarks!.current_price),
          low_futures_usd_lb: String(benchmarks!.low_1y),
          high_futures_usd_lb: String(benchmarks!.high_1y),
          basis_cents_lb: String(basisCentsLb),
          freight_usd_t: String(freightUsdT),
          fx_bdt_usd: String(fxBdtUsd),
        });
        const res = await fetch(`/api/landed-cost?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!ignore && res.ok) {
          const data = await res.json();
          if (!ignore) setLandedCost(data);
        }
      } catch {
        // Aborted or failed request. Landed cost is additive insight;
        // avoid blocking the primary strategy flow.
      } finally {
        if (!ignore) setLandedCostLoading(false);
      }
    }

    loadLandedCost();

    return () => {
      ignore = true;
      controller.abort();
    };
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
