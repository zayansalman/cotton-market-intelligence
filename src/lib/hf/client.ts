/**
 * Hugging Face Router client (Pro tier).
 *
 * Uses the HF router's OpenAI-compatible chat completion endpoint.
 * HF Pro ($9/mo) unlocks serverless inference for all chat models.
 *
 * MODEL SELECTION RATIONALE:
 *
 * Qwen2.5-72B-Instruct is the primary model because:
 * 1. Strong structured JSON compliance — critical for our
 *    pipeline which parses LLM output as JSON for signals/forecasts
 * 2. Strong instruction-following for complex commodity analysis prompts
 * 3. The `:fastest` router suffix lets HF choose a currently available
 *    provider instead of hard-coding provider-specific endpoints
 * 4. Open-source, no vendor lock-in, runs on HF serverless infrastructure
 *
 * Smaller 7B routes were previously provider-specific and proved brittle
 * as provider availability changed. The router endpoint keeps the app
 * deployable while still allowing HF_STRATEGY_MODEL overrides.
 */

import { fetchWithTimeout } from "../fetch-with-timeout";

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

export const DEFAULT_HF_CHAT_MODEL = "Qwen/Qwen2.5-72B-Instruct:fastest";
const DEFAULT_HF_FALLBACK_MODELS = ["Qwen/Qwen2.5-Coder-32B-Instruct:fastest"];
const DEFAULT_HF_CHAT_ENDPOINT = "https://router.huggingface.co/v1/chat/completions";
const MAX_ROUTER_ATTEMPTS = 2;
const HF_MODEL_ID_PATTERN = /^[A-Za-z0-9._/-]+(?::[A-Za-z0-9._-]+)?$/;

function configuredFallbackModels(): string[] {
  const raw = process.env.HF_STRATEGY_FALLBACK_MODELS;
  if (!raw) return DEFAULT_HF_FALLBACK_MODELS;
  return raw.split(",").map((model) => model.trim()).filter(Boolean);
}

/**
 * Current model info for transparency in UI.
 */
export function getModelInfo(): {
  model: string;
  provider: string;
  rationale: string;
} {
  const model = process.env.HF_STRATEGY_MODEL ?? DEFAULT_HF_CHAT_MODEL;
  return {
    model,
    provider: "Hugging Face Router",
    rationale:
      "72B instruction-tuned model routed through Hugging Face's " +
      "OpenAI-compatible router for structured reasoning with provider failover.",
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

  const primaryModel = (options.model ?? process.env.HF_STRATEGY_MODEL ?? DEFAULT_HF_CHAT_MODEL).trim();
  const endpoint = (process.env.HF_CHAT_ENDPOINT ?? DEFAULT_HF_CHAT_ENDPOINT).trim();
  if (!primaryModel) {
    console.warn("[hf-client] HF chat model is empty");
    return null;
  }
  if (!HF_MODEL_ID_PATTERN.test(primaryModel)) {
    console.warn("[hf-client] HF chat model contains invalid characters");
    return null;
  }
  if (!endpoint) {
    console.warn("[hf-client] HF chat endpoint is empty");
    return null;
  }
  try {
    const parsedEndpoint = new URL(endpoint);
    if (parsedEndpoint.protocol !== "https:") {
      console.warn("[hf-client] HF chat endpoint must use HTTPS");
      return null;
    }
  } catch {
    console.warn("[hf-client] HF chat endpoint is invalid");
    return null;
  }

  const models = [primaryModel, ...configuredFallbackModels()]
    .filter((model, index, all) => model && all.indexOf(model) === index);

  for (const model of models) {
    if (!HF_MODEL_ID_PATTERN.test(model)) {
      console.warn(`[hf-client] Skipping invalid HF chat model: ${model}`);
      continue;
    }

    for (let attempt = 1; attempt <= MAX_ROUTER_ATTEMPTS; attempt += 1) {
      try {
        const res = await fetchWithTimeout(endpoint, {
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
            console.info(`[hf-client] ${model} succeeded via HF Router`);
            return content;
          }
          console.warn(`[hf-client] ${model} returned empty content`);
          break;
        }

        const status = res.status;
        const errBody = await res.text().catch(() => "");
        console.warn(`[hf-client] ${model} HTTP ${status}: ${errBody.slice(0, 250)}`);
        if (status === 401 || status === 403) return null;
        if (status !== 429 && status < 500) break;
      } catch (e) {
        console.warn(`[hf-client] ${model} attempt ${attempt} failed:`, e);
      }
    }
  }

  console.error(`[hf-client] HF Router failed for configured models`);
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
