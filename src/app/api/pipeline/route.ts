/**
 * /api/pipeline — Run data pipeline and return all forecasting factors.
 *
 * GET — returns PipelineOutput with all factors, quality metrics, and target.
 * Heavy endpoint (multiple external API calls) — shares strategy rate limits.
 */

import { NextResponse } from "next/server";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/api-security";
import { checkAbuse, abuseBlockedResponse } from "@/lib/abuse-protection";
import { runPipeline } from "@/lib/pipeline/runner";

export async function GET(req: Request) {
  const abuse = checkAbuse(req);
  if (abuse.blocked) return abuseBlockedResponse(abuse);

  const rateLimit = evaluateRequestRateLimit(req, "strategy");
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

  try {
    const output = await runPipeline();

    return applyRateLimitHeaders(
      NextResponse.json(output),
      rateLimit.headers
    );
  } catch (e) {
    return applyRateLimitHeaders(
      safeErrorResponse(e, "strategy"),
      rateLimit.headers
    );
  }
}
