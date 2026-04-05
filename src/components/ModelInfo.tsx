"use client";

export default function ModelInfo({
  provider,
  source,
}: {
  provider?: string;
  source?: string;
}) {
  const modelName =
    provider === "huggingface"
      ? "Qwen 2.5 7B Instruct (via HF Pro)"
      : provider === "heuristic"
        ? "Statistical Heuristic + Ensemble"
        : provider ?? "Unknown";

  const description =
    provider === "huggingface"
      ? "AI-powered analysis using Qwen 2.5 7B — instruction-tuned open model with strong structured JSON output. Selected for optimal balance of reasoning capability and latency."
      : "Deterministic statistical model using percentile rank, z-score, and volatility regime. Enhanced with HF sentiment analysis and LLM news reasoning when available.";

  return (
    <div className="bg-zinc-700/30 border border-zinc-700 rounded-lg p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">Model</span>
        <span className="text-zinc-200 font-medium">{modelName}</span>
      </div>
      <p className="text-zinc-500 mt-1">{description}</p>
      {source === "heuristic" && (
        <p className="text-amber-400/70 mt-1">
          Set HF_TOKEN for AI-powered news analysis and geopolitical reasoning.
        </p>
      )}
    </div>
  );
}
