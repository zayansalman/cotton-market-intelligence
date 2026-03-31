"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  PricesResponse,
  Headline,
  Strategy,
  Benchmarks,
  LandedCostResponse,
} from "@/lib/types";
import PriceChart from "@/components/PriceChart";
import RoadmapChart from "@/components/RoadmapChart";
import SignalBadge from "@/components/SignalBadge";
import MetricCard from "@/components/MetricCard";
import LandedCostCard from "@/components/LandedCostCard";

export default function Home() {
  const [priceData, setPriceData] = useState<PricesResponse | null>(null);
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tonnage, setTonnage] = useState(2000);
  const [months, setMonths] = useState(6);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [timeframe, setTimeframe] = useState<
    "3M" | "6M" | "1Y" | "3Y" | "5Y" | "ALL"
  >("1Y");
  const [landedCost, setLandedCost] = useState<LandedCostResponse | null>(null);
  const [landedCostLoading, setLandedCostLoading] = useState(false);
  const [basisCentsLb, setBasisCentsLb] = useState(7);
  const [freightUsdT, setFreightUsdT] = useState(85);
  const [fxBdtUsd, setFxBdtUsd] = useState(117);
  const bm = priceData?.benchmarks;

  useEffect(() => {
    async function load() {
      try {
        const [priceRes, headlineRes] = await Promise.all([
          fetch("/api/prices"),
          fetch("/api/headlines"),
        ]);

        if (priceRes.ok) {
          setPriceData(await priceRes.json());
        } else {
          setError("Could not load cotton prices. Markets may be closed.");
        }

        if (headlineRes.ok) {
          setHeadlines(await headlineRes.json());
        }
      } catch {
        setError("Failed to connect to data services.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    async function loadLandedCost() {
      if (!bm) return;
      setLandedCostLoading(true);
      try {
        const params = new URLSearchParams({
          futures_usd_lb: String(bm.current_price),
          low_futures_usd_lb: String(bm.low_1y),
          high_futures_usd_lb: String(bm.high_1y),
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
  }, [bm, basisCentsLb, freightUsdT, fxBdtUsd]);

  const generateStrategy = useCallback(async () => {
    if (!priceData) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          benchmarks: priceData.benchmarks,
          headlines,
          tonnage,
          months,
          landedCost,
        }),
      });
      if (res.ok) {
        const data: Strategy = await res.json();
        const totalPct = data.monthly_plan.reduce((s, p) => s + p.pct, 0);
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
  }, [priceData, headlines, tonnage, months, landedCost]);

  const displayedPrices = useMemo(() => {
    if (!priceData?.prices?.length) return [];
    const points = priceData.prices;
    const map: Record<Exclude<typeof timeframe, "ALL">, number> = {
      "3M": 63,
      "6M": 126,
      "1Y": 252,
      "3Y": 756,
      "5Y": 1260,
    };
    if (timeframe === "ALL") return points;
    const n = map[timeframe];
    return points.slice(-Math.min(n, points.length));
  }, [priceData, timeframe]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-zinc-400 mt-4">Loading market data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Cotton Market Intelligence
            </h1>
            <p className="text-xs text-zinc-500">
              AI procurement advisor for spinning mills
            </p>
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-2 text-zinc-400 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? "block" : "hidden"
          } md:block w-full md:w-72 flex-shrink-0`}
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 sticky top-20 space-y-5">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
              Procurement Brief
            </h2>

            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                Tonnes needed
              </label>
              <input
                type="number"
                value={tonnage}
                onChange={(e) => setTonnage(Number(e.target.value))}
                min={100}
                step={500}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                Horizon: {months} months
              </label>
              <input
                type="range"
                min={1}
                max={12}
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-600">
                <span>1mo</span>
                <span>6mo</span>
                <span>12mo</span>
              </div>
            </div>

            <button
              onClick={generateStrategy}
              disabled={generating || !priceData}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {generating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing...
                </span>
              ) : (
                "Generate Strategy"
              )}
            </button>

            {bm && (
              <p className="text-[11px] text-zinc-600">
                Data as of {bm.price_date}
              </p>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4 text-sm">
              {error}
            </div>
          )}

          {/* Metrics */}
          {bm && (
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
          )}

          {bm && (
            <LandedCostCard
              data={landedCost}
              loading={landedCostLoading}
              basisCentsLb={basisCentsLb}
              setBasisCentsLb={setBasisCentsLb}
              freightUsdT={freightUsdT}
              setFreightUsdT={setFreightUsdT}
              fxBdtUsd={fxBdtUsd}
              setFxBdtUsd={setFxBdtUsd}
            />
          )}

          {/* Price chart */}
          {priceData && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-zinc-500 mr-1 uppercase tracking-wider">
                  Timeframe
                </p>
                {(["3M", "6M", "1Y", "3Y", "5Y", "ALL"] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                      timeframe === tf
                        ? "bg-blue-600/20 border-blue-500 text-blue-300"
                        : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {tf}
                  </button>
                ))}
                {displayedPrices.length > 0 && (
                  <span className="text-xs text-zinc-500 ml-2">
                    {displayedPrices[0].date} to{" "}
                    {displayedPrices[displayedPrices.length - 1].date}
                  </span>
                )}
              </div>
              <PriceChart
                prices={displayedPrices}
                benchmarks={priceData.benchmarks}
              />
            </div>
          )}

          {/* Strategy results */}
          {strategy ? (
            <>
              <SignalBadge strategy={strategy} />

              {/* Market analysis */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-3">
                  Market Analysis
                </h3>
                <div className="prose prose-invert prose-sm max-w-none text-zinc-300 leading-relaxed whitespace-pre-line">
                  {strategy.market_analysis}
                </div>
              </div>

              {/* Key levels */}
              {strategy.key_levels && (
                <div className="grid grid-cols-3 gap-3">
                  <MetricCard
                    label="Support"
                    value={`$${strategy.key_levels.support.toFixed(4)}/lb`}
                  />
                  <MetricCard
                    label="Fair Value"
                    value={`$${strategy.key_levels.fair_value.toFixed(4)}/lb`}
                  />
                  <MetricCard
                    label="Resistance"
                    value={`$${strategy.key_levels.resistance.toFixed(4)}/lb`}
                  />
                </div>
              )}

              {/* Roadmap */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-3">
                  Procurement Roadmap — {tonnage.toLocaleString()}t over{" "}
                  {months} months
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <RoadmapChart plan={strategy.monthly_plan} />
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase">
                          <th className="text-left px-4 py-3">Month</th>
                          <th className="text-right px-4 py-3">Tonnes</th>
                          <th className="text-right px-4 py-3">%</th>
                          <th className="text-left px-4 py-3">Rationale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {strategy.monthly_plan.map((p) => (
                          <tr
                            key={p.month}
                            className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                          >
                            <td className="px-4 py-2.5 font-medium">
                              M{p.month}
                            </td>
                            <td className="text-right px-4 py-2.5 text-zinc-300">
                              {p.tonnes.toLocaleString()}
                            </td>
                            <td className="text-right px-4 py-2.5 text-zinc-400">
                              {p.pct.toFixed(1)}%
                            </td>
                            <td className="px-4 py-2.5 text-zinc-500 text-xs">
                              {p.rationale}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Risks & Actions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {strategy.risk_factors.length > 0 && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-red-400/80 uppercase tracking-wider mb-3">
                      Risk Factors
                    </h3>
                    <ul className="space-y-2">
                      {strategy.risk_factors.map((r, i) => (
                        <li
                          key={i}
                          className="text-sm text-zinc-400 flex gap-2"
                        >
                          <span className="text-red-500 mt-0.5">•</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {strategy.next_actions.length > 0 && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-blue-400/80 uppercase tracking-wider mb-3">
                      Next Actions
                    </h3>
                    <ul className="space-y-2">
                      {strategy.next_actions.map((a, i) => (
                        <li
                          key={i}
                          className="text-sm text-zinc-400 flex gap-2"
                        >
                          <span className="text-blue-500 mt-0.5">→</span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Headlines */}
              {headlines.length > 0 && (
                <details className="bg-zinc-900 border border-zinc-800 rounded-xl">
                  <summary className="p-5 cursor-pointer text-sm font-semibold text-zinc-300 uppercase tracking-wider hover:text-white">
                    News Headlines ({headlines.length})
                  </summary>
                  <div className="px-5 pb-5 space-y-2">
                    {headlines.slice(0, 20).map((h, i) => (
                      <a
                        key={i}
                        href={h.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sm text-zinc-400 hover:text-blue-400 transition-colors"
                      >
                        • {h.title}
                      </a>
                    ))}
                  </div>
                </details>
              )}

              {/* Download */}
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    const blob = new Blob(
                      [JSON.stringify(strategy, null, 2)],
                      { type: "application/json" }
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `procurement_strategy_${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-4 py-2 transition-colors"
                >
                  Download Strategy (JSON)
                </button>
              </div>
            </>
          ) : (
            !generating && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
                <p className="text-zinc-400">
                  Enter your procurement brief and click{" "}
                  <span className="text-blue-400 font-medium">
                    Generate Strategy
                  </span>{" "}
                  to get started.
                </p>
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
}
