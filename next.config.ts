import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every route. These are defense-in-depth
 * for a stateless market-intelligence app (no first-party auth cookies), so the
 * emphasis is on clickjacking, MIME-sniffing, referrer leakage, and transport
 * security rather than a strict CSP (which would need per-page nonce plumbing).
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
