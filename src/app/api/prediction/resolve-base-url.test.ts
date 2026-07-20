import { describe, it, expect, afterEach } from "vitest";
import { resolveBaseUrl } from "./base-url";

const ORIGINAL_ENV = { ...process.env };

function reqWithHost(host?: string): Request {
  return new Request("https://example.test/api/prediction", {
    headers: host ? { host } : {},
  });
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveBaseUrl", () => {
  it("prefers an explicit APP_BASE_URL and strips trailing slashes", () => {
    process.env.APP_BASE_URL = "https://cmi.example.com/";
    process.env.VERCEL_URL = "deployment-xyz.vercel.app";
    expect(resolveBaseUrl(reqWithHost("cmi-notebooks-dev.vercel.app"))).toBe(
      "https://cmi.example.com"
    );
  });

  // REGRESSION GUARD: VERCEL_URL is the deployment-specific host, which sits
  // behind Vercel Deployment Protection (302 -> SSO) on non-production
  // targets. Preferring it over the public alias broke /api/prediction with a
  // 502 "Market data unavailable" on the dev deployment.
  it("prefers an allowlisted public Host over VERCEL_URL", () => {
    delete process.env.APP_BASE_URL;
    process.env.VERCEL_URL = "cmi-notebooks-hqm8wclcu-zayansalmans-projects.vercel.app";
    expect(resolveBaseUrl(reqWithHost("cmi-notebooks-dev.vercel.app"))).toBe(
      "https://cmi-notebooks-dev.vercel.app"
    );
    expect(resolveBaseUrl(reqWithHost("cmi-notebooks.vercel.app"))).toBe(
      "https://cmi-notebooks.vercel.app"
    );
  });

  it("ignores a spoofed Host (no SSRF) and falls back to VERCEL_URL", () => {
    delete process.env.APP_BASE_URL;
    process.env.VERCEL_URL = "deployment-xyz.vercel.app";
    expect(resolveBaseUrl(reqWithHost("evil.com"))).toBe(
      "https://deployment-xyz.vercel.app"
    );
  });

  it("never returns an attacker-controlled origin when nothing is configured", () => {
    delete process.env.APP_BASE_URL;
    delete process.env.VERCEL_URL;
    expect(resolveBaseUrl(reqWithHost("evil.com"))).toBe("http://localhost:3000");
    expect(resolveBaseUrl(reqWithHost("attacker.cmi-notebooks.vercel.app.evil.com"))).toBe(
      "http://localhost:3000"
    );
  });

  it("supports local development hosts over http", () => {
    delete process.env.APP_BASE_URL;
    delete process.env.VERCEL_URL;
    expect(resolveBaseUrl(reqWithHost("localhost:3000"))).toBe("http://localhost:3000");
    expect(resolveBaseUrl(reqWithHost("127.0.0.1:3000"))).toBe("http://127.0.0.1:3000");
  });
});
