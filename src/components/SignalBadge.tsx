import type { Strategy } from "@/lib/types";

const SIGNAL_STYLES: Record<
  Strategy["signal"],
  { bg: string; border: string; text: string }
> = {
  STRONG_BUY: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500",
    text: "text-emerald-400",
  },
  BUY: {
    bg: "bg-blue-500/10",
    border: "border-blue-500",
    text: "text-blue-400",
  },
  HOLD: {
    bg: "bg-amber-500/10",
    border: "border-amber-500",
    text: "text-amber-400",
  },
  AVOID: {
    bg: "bg-red-500/10",
    border: "border-red-500",
    text: "text-red-400",
  },
};

export default function SignalBadge({ strategy }: { strategy: Strategy }) {
  const s = SIGNAL_STYLES[strategy.signal];
  const providerLabel =
    strategy.provider === "huggingface" ? "HF" : null;
  return (
    <div
      className={`${s.bg} border-l-4 ${s.border} rounded-lg p-5 my-4`}
    >
      <div className="flex items-center gap-4">
        <span className={`text-2xl font-bold ${s.text}`}>
          {strategy.signal.replace("_", " ")}
        </span>
        <span className="text-zinc-400 text-sm">
          confidence {strategy.confidence}%
        </span>
        {strategy.source === "ai" && (
          <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">
            AI-powered{providerLabel ? ` (${providerLabel})` : ""}
          </span>
        )}
        {strategy.source === "heuristic" && (
          <span className="text-xs bg-zinc-700 text-zinc-400 px-2 py-0.5 rounded-full">
            Statistical
          </span>
        )}
      </div>
      <p className="mt-3 text-zinc-200 text-[15px] leading-relaxed">
        {strategy.executive_summary}
      </p>
    </div>
  );
}
