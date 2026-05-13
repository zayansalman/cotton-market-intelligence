"use client";

export default function ModelInfo({
  provider,
  providerStatus,
  source,
}: {
  provider?: string;
  providerStatus?: string;
  source?: string;
}) {
  const modelName =
    provider === "huggingface"
      ? "Qwen 2.5 72B Instruct (via HF Router)"
      : provider === "heuristic"
        ? "Statistical Heuristic + Ensemble"
        : provider ?? "Unknown";

  const description =
    provider === "huggingface"
      ? "AI-powered analysis using Qwen 2.5 72B — instruction-tuned open model with strong structured JSON output, routed through Hugging Face for current provider availability."
      : "Deterministic statistical model using percentile rank, z-score, and volatility regime. Enhanced with HF sentiment analysis and LLM news reasoning when available.";

  return (
    <div className="bg-zinc-700/30 border border-zinc-700 rounded-lg p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">Model</span>
        <span className="text-zinc-200 font-medium">{modelName}</span>
      </div>
      <p className="text-zinc-500 mt-1">{description}</p>
      {source === "heuristic" && providerStatus === "unavailable" && (
        <p className="text-amber-400/70 mt-1">
          AI provider is configured but was unavailable or timed out, so this roadmap used the deterministic fallback.
        </p>
      )}
      {source === "heuristic" && providerStatus === "quota_exceeded" && (
        <p className="text-amber-400/70 mt-1">
          AI quota was reached, so this roadmap used the deterministic fallback.
        </p>
      )}
      {source === "heuristic" && !providerStatus && (
        <p className="text-amber-400/70 mt-1">
          Configure an AI provider for AI-powered strategy generation.
        </p>
      )}
    </div>
  );
}
