/**
 * Shared HF Inference API client using the new chat completion endpoint.
 *
 * Since July 2025, HF Inference API uses the OpenAI-compatible
 * chat/completions endpoint. The old text-generation endpoint returns 410.
 *
 * Model selection rationale (cost-effective quant firm perspective):
 * - Qwen2.5-7B-Instruct: best structured JSON compliance at 7B scale,
 *   strong reasoning, free on HF inference. This is what a cost-conscious
 *   quant desk would use — pay for compute only when you need it,
 *   use the smallest model that reliably produces correct output.
 * - NOT GPT-4 (expensive, proprietary, vendor lock-in)
 * - NOT 70B+ models (latency too high for real-time strategy generation)
 * - NOT Gemma (good general model but weaker at structured JSON output)
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
  /** Request JSON response format (model must support it). */
  response_format?: { type: "json_object" };
}

/* ------------------------------------------------------------------ */
/*  Default model                                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct";

/**
 * Provider routing for chat models. The free hf-inference tier no longer
 * serves large LLMs (July 2025 change). We try multiple providers in order:
 * 1. novita (free tier available for some models)
 * 2. hf-inference (legacy, works for small models)
 * 3. together (if configured)
 *
 * This is the same pattern used by quant firms — multiple execution venues,
 * failover on rejection, minimize single-provider dependency.
 */
const PROVIDERS = [
  "novita",
  "hf-inference",
  "together",
];

/* ------------------------------------------------------------------ */
/*  Chat completion call                                               */
/* ------------------------------------------------------------------ */

/**
 * Call HF Inference API using the new chat/completions endpoint.
 * Tries multiple providers until one succeeds.
 * Returns the assistant's response text, or null on failure.
 */
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
        console.warn(`[hf-client] ${provider}/${model} returned ${status}, trying next provider`);
        // 401/403 = auth issue, don't try more providers
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

/**
 * Parse JSON from LLM response text. Handles markdown code blocks
 * and stray text before/after the JSON object.
 */
export function parseJsonResponse(text: string): Record<string, unknown> | null {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch { /* continue */ }

  // Try extracting JSON from markdown code block
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim());
    } catch { /* continue */ }
  }

  // Try extracting first {...} block
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch { /* continue */ }
  }

  return null;
}
