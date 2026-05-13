import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HF_CHAT_MODEL, hfChatCompletion } from "./client";

const ORIGINAL_ENV = {
  HF_TOKEN: process.env.HF_TOKEN,
  HF_STRATEGY_MODEL: process.env.HF_STRATEGY_MODEL,
  HF_STRATEGY_FALLBACK_MODELS: process.env.HF_STRATEGY_FALLBACK_MODELS,
  HF_CHAT_ENDPOINT: process.env.HF_CHAT_ENDPOINT,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("hfChatCompletion", () => {
  beforeEach(() => {
    process.env.HF_TOKEN = "hf_test_token";
    delete process.env.HF_STRATEGY_MODEL;
    delete process.env.HF_STRATEGY_FALLBACK_MODELS;
    delete process.env.HF_CHAT_ENDPOINT;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it("posts to the HF router with the default analyst model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "analyst view" } }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hfChatCompletion({
        messages: [{ role: "user", content: "Review cotton" }],
      })
    ).resolves.toBe("analyst view");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://router.huggingface.co/v1/chat/completions");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: DEFAULT_HF_CHAT_MODEL,
      messages: [{ role: "user", content: "Review cotton" }],
    });
  });

  it("retries transient router failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "recovered" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hfChatCompletion({
        messages: [{ role: "user", content: "Retry me" }],
      })
    ).resolves.toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a smaller LLM if the primary model is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "unsupported model" }, 400))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "fallback view" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hfChatCompletion({
        messages: [{ role: "user", content: "Fallback request" }],
      })
    ).resolves.toBe("fallback view");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe(DEFAULT_HF_CHAT_MODEL);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).model).toBe(
      "Qwen/Qwen2.5-Coder-32B-Instruct:fastest"
    );
  });

  it("does not retry the same model on non-transient request errors", async () => {
    process.env.HF_STRATEGY_FALLBACK_MODELS = "bad fallback model";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "bad model" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hfChatCompletion({
        messages: [{ role: "user", content: "Bad request" }],
      })
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call HF without a token", async () => {
    delete process.env.HF_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hfChatCompletion({
        messages: [{ role: "user", content: "No token" }],
      })
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid model and endpoint configuration before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    process.env.HF_STRATEGY_MODEL = "bad model; rm -rf /";
    await expect(
      hfChatCompletion({
        messages: [{ role: "user", content: "Invalid model" }],
      })
    ).resolves.toBeNull();

    process.env.HF_STRATEGY_MODEL = DEFAULT_HF_CHAT_MODEL;
    process.env.HF_CHAT_ENDPOINT = "http://router.huggingface.co/v1/chat/completions";
    await expect(
      hfChatCompletion({
        messages: [{ role: "user", content: "Invalid endpoint" }],
      })
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
