"use client";

import type { LandedCostResponse } from "@/lib/types";

interface Props {
  data: LandedCostResponse | null;
  loading: boolean;
  basisCentsLb: number;
  setBasisCentsLb: (v: number) => void;
  freightUsdT: number;
  setFreightUsdT: (v: number) => void;
  fxBdtUsd: number;
  setFxBdtUsd: (v: number) => void;
}

function num(v: number, digits = 2): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function LandedCostCard({
  data,
  loading,
  basisCentsLb,
  setBasisCentsLb,
  freightUsdT,
  setFreightUsdT,
  fxBdtUsd,
  setFxBdtUsd,
}: Props) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          Bangladesh Landed Cost
        </h3>
        {loading && (
          <span className="text-xs text-zinc-500 flex items-center gap-2">
            <span className="w-3 h-3 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
            Updating
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-xs text-zinc-400">
          Basis (c/lb)
          <input
            type="number"
            value={basisCentsLb}
            onChange={(e) => setBasisCentsLb(Number(e.target.value))}
            step={0.5}
            className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-200"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Freight (USD/t)
          <input
            type="number"
            value={freightUsdT}
            onChange={(e) => setFreightUsdT(Number(e.target.value))}
            step={5}
            className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-200"
          />
        </label>
        <label className="text-xs text-zinc-400">
          FX (BDT/USD)
          <input
            type="number"
            value={fxBdtUsd}
            onChange={(e) => setFxBdtUsd(Number(e.target.value))}
            step={0.5}
            className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-200"
          />
        </label>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-zinc-800/60 rounded-lg p-3">
              <p className="text-[11px] text-zinc-500 uppercase">Effective USD/t</p>
              <p className="text-lg font-semibold text-zinc-100">
                ${num(data.breakdown.effective_usd_t)}
              </p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg p-3">
              <p className="text-[11px] text-zinc-500 uppercase">Effective BDT/kg</p>
              <p className="text-lg font-semibold text-zinc-100">
                Tk {num(data.breakdown.effective_bdt_kg)}
              </p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg p-3">
              <p className="text-[11px] text-zinc-500 uppercase">Cotton USD/t</p>
              <p className="text-lg font-semibold text-zinc-100">
                ${num(data.breakdown.cotton_usd_t)}
              </p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg p-3">
              <p className="text-[11px] text-zinc-500 uppercase">Logistics + Costs</p>
              <p className="text-lg font-semibold text-zinc-100">
                $
                {num(
                  data.breakdown.freight_usd_t +
                    data.breakdown.insurance_usd_t +
                    data.breakdown.duty_usd_t
                )}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5">
              <p className="text-emerald-300 font-medium">Low 1Y Futures</p>
              <p className="text-zinc-300">
                ${num(data.sensitivity.low_1y.effective_usd_t)} /t
              </p>
              <p className="text-zinc-400">
                Tk {num(data.sensitivity.low_1y.effective_bdt_kg)} /kg
              </p>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2.5">
              <p className="text-blue-300 font-medium">Current</p>
              <p className="text-zinc-300">
                ${num(data.sensitivity.current.effective_usd_t)} /t
              </p>
              <p className="text-zinc-400">
                Tk {num(data.sensitivity.current.effective_bdt_kg)} /kg
              </p>
            </div>
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
              <p className="text-red-300 font-medium">High 1Y Futures</p>
              <p className="text-zinc-300">
                ${num(data.sensitivity.high_1y.effective_usd_t)} /t
              </p>
              <p className="text-zinc-400">
                Tk {num(data.sensitivity.high_1y.effective_bdt_kg)} /kg
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
