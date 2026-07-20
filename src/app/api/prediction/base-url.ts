/**
 * Origin resolution for the prediction route's internal self-fetches.
 *
 * Kept in its own module (no path-alias imports) so it is directly unit
 * testable without pulling in the whole route graph.
 */

/** Public origins this app is served from. Exact-match only. */
const ALLOWED_SELF_HOSTS = new Set(["cmi-notebooks.vercel.app"]);

function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

/**
 * Resolve the origin for internal self-fetches without opening an SSRF hole.
 *
 * The client Host header is attacker-controllable, so it is only honoured when
 * it EXACTLY matches a known public origin of this app (or localhost). A
 * spoofed `Host: evil.com` never matches and is discarded, so the server can
 * never be induced to fetch — and cache — an arbitrary origin.
 *
 * Precedence matters: an allowlisted Host wins over VERCEL_URL because
 * VERCEL_URL is the deployment-specific hostname, which sits behind Vercel
 * Deployment Protection on non-production targets. Self-fetching it returns a
 * 302 to the SSO login instead of JSON, which surfaced as a 502 "Market data
 * unavailable". The public alias the request actually arrived on is both safe
 * (exact allowlist) and reachable.
 */
export function resolveBaseUrl(req: Request): string {
  // 1. Explicit operator override always wins.
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  // 2. The origin this request actually arrived on, if it is provably ours.
  const host = req.headers.get("host") ?? "";
  if (isLocalHost(host)) return `http://${host}`;
  if (ALLOWED_SELF_HOSTS.has(host)) return `https://${host}`;

  // 3. Vercel's own deployment hostname (server-set, not client-controlled).
  //    Works when deployment protection is off.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  // 4. Unknown/spoofed host with no trusted config — stay on loopback rather
  //    than self-fetching an attacker-controlled origin.
  return "http://localhost:3000";
}
