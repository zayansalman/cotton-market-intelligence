/**
 * Anti-bot and abuse protection tests (#19).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { checkAbuse, _resetForTesting } from "../abuse-protection";

function makeReq(opts: {
  ip?: string;
  ua?: string;
  accept?: string;
  acceptLang?: string;
} = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  if (opts.ua) headers["user-agent"] = opts.ua;
  if (opts.accept) headers["accept"] = opts.accept;
  if (opts.acceptLang) headers["accept-language"] = opts.acceptLang;
  return new Request("http://localhost/api/prices", { headers });
}

beforeEach(() => {
  _resetForTesting();
  delete process.env.API_KILL_SWITCH;
  delete process.env.ABUSE_PROTECTION_ENABLED;
  delete process.env.ABUSE_IP_DENYLIST;
  delete process.env.ABUSE_IP_ALLOWLIST;
  delete process.env.ABUSE_BLOCK_THRESHOLD;
});

describe("kill switch", () => {
  it("blocks all requests when API_KILL_SWITCH=1", () => {
    process.env.API_KILL_SWITCH = "1";
    const result = checkAbuse(makeReq({ ua: "Mozilla/5.0", accept: "*/*", acceptLang: "en" }));
    expect(result.blocked).toBe(true);
    expect(result.signals).toContain("kill_switch");
  });

  it("passes when kill switch is off", () => {
    const result = checkAbuse(makeReq({ ip: "1.2.3.4", ua: "Mozilla/5.0", accept: "*/*", acceptLang: "en" }));
    expect(result.blocked).toBe(false);
  });
});

describe("IP denylist", () => {
  it("blocks denylisted IPs", () => {
    process.env.ABUSE_IP_DENYLIST = "10.0.0.1,10.0.0.2";
    const result = checkAbuse(makeReq({ ip: "10.0.0.1", ua: "Mozilla/5.0", accept: "*/*" }));
    expect(result.blocked).toBe(true);
    expect(result.signals).toContain("denylisted");
  });

  it("allows non-denylisted IPs", () => {
    process.env.ABUSE_IP_DENYLIST = "10.0.0.1";
    const result = checkAbuse(makeReq({ ip: "10.0.0.99", ua: "Mozilla/5.0", accept: "*/*", acceptLang: "en" }));
    expect(result.blocked).toBe(false);
  });
});

describe("IP allowlist", () => {
  it("always allows allowlisted IPs regardless of signals", () => {
    process.env.ABUSE_IP_ALLOWLIST = "192.168.1.1";
    // No UA, no accept — would normally trigger signals
    const result = checkAbuse(makeReq({ ip: "192.168.1.1" }));
    expect(result.blocked).toBe(false);
    expect(result.signals).toContain("allowlisted");
  });
});

describe("suspicious UA detection", () => {
  it("flags curl requests", () => {
    const result = checkAbuse(makeReq({ ip: "1.2.3.4", ua: "curl/7.88.1" }));
    expect(result.signals.some((s) => s.startsWith("suspicious_ua"))).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("flags python-requests", () => {
    const result = checkAbuse(makeReq({ ip: "1.2.3.4", ua: "python-requests/2.31.0" }));
    expect(result.signals.some((s) => s.startsWith("suspicious_ua"))).toBe(true);
  });

  it("flags bot/crawler UAs", () => {
    const result = checkAbuse(makeReq({ ip: "1.2.3.4", ua: "Googlebot/2.1" }));
    expect(result.signals.some((s) => s.startsWith("suspicious_ua"))).toBe(true);
  });

  it("allows normal browser UAs", () => {
    const result = checkAbuse(makeReq({
      ip: "1.2.3.4",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      accept: "text/html",
      acceptLang: "en-US",
    }));
    expect(result.signals.filter((s) => s.startsWith("suspicious_ua"))).toHaveLength(0);
    expect(result.blocked).toBe(false);
  });
});

describe("header anomaly detection", () => {
  it("flags missing user-agent", () => {
    const result = checkAbuse(makeReq({ ip: "1.2.3.4" }));
    expect(result.signals).toContain("missing_user_agent");
  });

  it("flags missing accept header", () => {
    const result = checkAbuse(makeReq({ ip: "1.2.3.4", ua: "Mozilla/5.0" }));
    expect(result.signals).toContain("missing_accept_header");
  });
});

describe("repeat offender escalation", () => {
  it("increases score for repeat blocks", () => {
    process.env.ABUSE_BLOCK_THRESHOLD = "2"; // low threshold
    const req = makeReq({ ip: "5.5.5.5", ua: "scrapy/2.0" }); // suspicious UA = 2 points

    // First block
    const first = checkAbuse(req);
    expect(first.blocked).toBe(true);

    // Second check — should have higher score from offender record
    const second = checkAbuse(req);
    expect(second.score).toBeGreaterThan(first.score);
  });
});

describe("protection disabled", () => {
  it("passes all requests when ABUSE_PROTECTION_ENABLED=0", () => {
    process.env.ABUSE_PROTECTION_ENABLED = "0";
    const result = checkAbuse(makeReq({ ua: "scrapy/2.0" }));
    expect(result.blocked).toBe(false);
    expect(result.score).toBe(0);
  });
});

describe("UA allowlist", () => {
  it("allows Vercel health checks", () => {
    const result = checkAbuse(makeReq({ ip: "1.2.3.4", ua: "Vercel/1.0" }));
    expect(result.blocked).toBe(false);
    expect(result.signals).toContain("ua_allowlisted");
  });
});
