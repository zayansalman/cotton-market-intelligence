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

/* ------------------------------------------------------------------ */
/*  Chat completion call                                               */
/* ------------------------------------------------------------------ */

/**
 * Call HF Inference API using the new chat/completions endpoint.
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

  try {
    const res = await fetchWithTimeout(
      `https://router.huggingface.co/hf-inference/models/${encodeURIComponent(model)}/v1/chat/completions`,
      {
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
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[hf-client] ${model} error ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.error("[hf-client] No content in response:", JSON.stringify(data).slice(0, 200));
      return null;
    }

    return content;
  } catch (e) {
    console.error("[hf-client] Chat completion failed:", e);
    return null;
  }
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
