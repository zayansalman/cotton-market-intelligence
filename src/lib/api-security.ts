/**
 * API security utilities: payload guards, safe error responses,
 * and input validation helpers.
 */

import { NextResponse } from "next/server";
export { fetchWithTimeout } from "./fetch-with-timeout";

/* ------------------------------------------------------------------ */
/*  Payload size guard                                                 */
/* ------------------------------------------------------------------ */

const MAX_BODY_BYTES = 512 * 1024; // 512 KB

/**
 * Safely parse a JSON request body with a size cap.
 * Returns the parsed object or a 413/400 NextResponse.
 */
export async function safeParseBody(
  req: Request
): Promise<Record<string, unknown> | NextResponse> {
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body too large", max_bytes: MAX_BODY_BYTES },
      { status: 413 }
    );
  }

  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body too large", max_bytes: MAX_BODY_BYTES },
        { status: 413 }
      );
    }
    const body = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    return body as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Safe error response (no internal detail leakage)                   */
/* ------------------------------------------------------------------ */

const SAFE_MESSAGES: Record<string, string> = {
  strategy: "Strategy generation failed. Please try again.",
  prices: "Market data temporarily unavailable.",
  headlines: "News feed temporarily unavailable.",
  landed_cost: "Cost calculation failed.",
  prediction: "Price prediction failed. Please try again.",
  pipeline: "Forecasting pipeline failed. Please try again.",
  backtest: "Backtest failed. Please try again.",
};

/**
 * Returns a sanitized 500 error response. Logs the real error
 * server-side but returns only a generic message to clients.
 */
export function safeErrorResponse(
  error: unknown,
  endpoint: string
): NextResponse {
  // Log full error server-side for debugging
  console.error(`[${endpoint}] Internal error:`, error);

  return NextResponse.json(
    { error: SAFE_MESSAGES[endpoint] ?? "Internal server error" },
    { status: 500 }
  );
}
