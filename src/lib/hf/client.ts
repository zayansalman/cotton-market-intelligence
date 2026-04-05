/**
 * Hugging Face Inference API client (Pro tier).
 *
 * Uses the HF router with multi-provider failover for chat completion.
 * HF Pro ($9/mo) unlocks serverless inference for all chat models.
 *
 * MODEL SELECTION RATIONALE:
 *
 * Qwen2.5-7B-Instruct is the primary model because:
 * 1. Best structured JSON compliance at 7B scale — critical for our
 *    pipeline which parses LLM output as JSON for signals/forecasts
 * 2. Strong instruction-following for complex commodity analysis prompts
 * 3. 7B is the sweet spot: fast enough for real-time (<5s), smart enough
 *    to reason about geopolitical causality and supply chain effects
 * 4. Open-source, no vendor lock-in, runs on HF serverless infrastructure
 *
 * WHY NOT LARGER MODELS:
 * - 70B+ models: latency 15-30s, unacceptable for interactive strategy
 * - GPT-4: proprietary, expensive ($0.03/1K tokens vs free/HF Pro $9/mo)
 * - Claude: same issue, plus no HF integration
 *
 * WHY NOT SMALLER:
 * - 1-3B models: insufficient reasoning for multi-factor commodity analysis
 * - Cannot reliably produce structured JSON with complex nested fields
 *
 * This is the same cost-optimization thinking used at quant firms:
 * use the smallest model that reliably produces correct output.
 * Inference cost per strategy call: ~$0.001 on HF Pro.
 */

import { fetchWithTimeout } from "@/lib/api-security";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
}

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct";

/**
 * Provider routing order. HF Pro unlocks all providers.
 * We try multiple in case one is temporarily overloaded.
 */
const PROVIDERS = ["novita", "hf-inference", "together"];

/** Current model info for transparency in UI. */
export function getModelInfo(): {
  model: string;
  provider: string;
  rationale: string;
} {
  const model = process.env.HF_STRATEGY_MODEL ?? DEFAULT_MODEL;
  return {
    model,
    provider: "Hugging Face (Pro)",
    rationale:
      "7B instruction-tuned model selected for optimal balance of " +
      "structured JSON compliance, reasoning capability, and latency. " +
      "Runs on HF serverless infrastructure with multi-provider failover.",
  };
}

/* ------------------------------------------------------------------ */
/*  Chat completion                                                    */
/* ------------------------------------------------------------------ */

export async function hfChatCompletion(
  options: ChatCompletionOptions
): Promise<string | null> {
  const token = process.env.HF_TOKEN;
  if (!token) {
    console.warn("[hf-client] HF_TOKEN not set");
    return null;
  }

  const model = options.model ?? process.env.HF_STRATEGY_MODEL ?? DEFAULT_MODEL;

  for (const provider of PROVIDERS) {
    try {
      const url = `https://router.huggingface.co/${provider}/models/${encodeURIComponent(model)}/v1/chat/completions`;

      const res = await fetchWithTimeout(url, {
        method: "POST",
        timeout: 45_000,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: options.messages,
          max_tokens: options.max_tokens ?? 800,
          temperature: options.temperature ?? 0.2,
          ...(options.response_format ? { response_format: options.response_format } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content?.trim();
        if (content) {
          console.info(`[hf-client] ${model} succeeded via ${provider}`);
          return content;
        }
      } else {
        const status = res.status;
        console.warn(`[hf-client] ${provider}/${model} returned ${status}, trying next`);
        if (status === 401 || status === 403) break;
        continue;
      }
    } catch (e) {
      console.warn(`[hf-client] ${provider}/${model} failed:`, e);
      continue;
    }
  }

  console.error(`[hf-client] All providers exhausted for ${model}`);
  return null;
}

/* ------------------------------------------------------------------ */
/*  JSON parsing                                                       */
/* ------------------------------------------------------------------ */

export function parseJsonResponse(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* continue */ }
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) { try { return JSON.parse(codeBlock[1].trim()); } catch { /* continue */ } }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) { try { return JSON.parse(jsonMatch[0]); } catch { /* continue */ } }
  return null;
}
