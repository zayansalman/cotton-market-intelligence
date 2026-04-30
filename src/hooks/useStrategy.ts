"use client";

import { useState, useCallback } from "react";
import type {
  PricesResponse,
  Headline,
  Strategy,
  LandedCostResponse,
  PurchaserInput,
  Benchmarks,
} from "@/lib/types";

interface UseStrategyDeps {
  priceData: PricesResponse | null;
  headlines: Headline[];
  landedCost: LandedCostResponse | null;
  purchaserInput: PurchaserInput;
  setError: (msg: string | null) => void;
}

export interface StrategyRequestBody {
  strategy_input_version: 2;
  purchaser_input: PurchaserInput;
  benchmarks: Benchmarks;
  headlines: Headline[];
  landedCost?: LandedCostResponse;
  marketForecast?: unknown;
}

export function buildStrategyRequestBody({
  benchmarks,
  headlines,
  landedCost,
  marketForecast,
  purchaserInput,
}: {
  benchmarks: Benchmarks;
  headlines: Headline[];
  landedCost: LandedCostResponse | null;
  marketForecast?: unknown | null;
  purchaserInput: PurchaserInput;
}): StrategyRequestBody {
  return {
    strategy_input_version: 2,
    purchaser_input: purchaserInput,
    benchmarks,
    headlines,
    ...(landedCost ? { landedCost } : {}),
    ...(marketForecast ? { marketForecast } : {}),
  };
}

export function useStrategy({
  priceData,
  headlines,
  landedCost,
  purchaserInput,
  setError,
}: UseStrategyDeps) {
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [generating, setGenerating] = useState(false);

  const generateStrategy = useCallback(async () => {
    if (!priceData) return;
    setGenerating(true);
    try {
      const marketForecast = await fetch("/api/prediction?horizon=21d")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      const body = buildStrategyRequestBody({
        benchmarks: priceData.benchmarks,
        headlines,
        landedCost,
        marketForecast,
        purchaserInput,
      });
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data: Strategy = await res.json();
        const totalPct = data.monthly_plan.reduce((s, p) => s + p.pct, 0);
        const tonnage = purchaserInput.demand.required_tonnes;
        if (totalPct > 0) {
          data.monthly_plan = data.monthly_plan.map((p) => ({
            ...p,
            pct: Math.round((p.pct / totalPct) * 1000) / 10,
            tonnes: Math.round((tonnage * p.pct) / totalPct),
          }));
        }
        setStrategy(data);
      }
    } catch {
      setError("Strategy generation failed.");
    } finally {
      setGenerating(false);
    }
  }, [priceData, headlines, landedCost, purchaserInput, setError]);

  return { strategy, generating, generateStrategy };
}
