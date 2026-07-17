import { describe, it, expect } from "vitest";
import { reserveGlobalAiBudget, utcDayKey } from "../ai-budget";

function mockClient(behavior: (args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return behavior(args);
    },
  };
}

describe("reserveGlobalAiBudget", () => {
  it("allows and reports durable count when under the limit", async () => {
    const client = mockClient(() => ({ data: 5, error: null }));
    const res = await reserveGlobalAiBudget(client, { limit: 1000, today: "2026-07-18" });
    expect(res).toEqual({ allowed: true, count: 5, durable: true });
    expect(client.calls[0]).toEqual({ p_date: "2026-07-18" });
  });

  it("blocks when the returned count exceeds the limit", async () => {
    const client = mockClient(() => ({ data: 1001, error: null }));
    const res = await reserveGlobalAiBudget(client, { limit: 1000, today: "2026-07-18" });
    expect(res.allowed).toBe(false);
    expect(res.durable).toBe(true);
    expect(res.count).toBe(1001);
  });

  it("allows exactly at the limit boundary", async () => {
    const client = mockClient(() => ({ data: 1000, error: null }));
    const res = await reserveGlobalAiBudget(client, { limit: 1000, today: "2026-07-18" });
    expect(res.allowed).toBe(true);
  });

  it("fails OPEN when the RPC returns an error", async () => {
    const client = mockClient(() => ({ data: null, error: { message: "no such function" } }));
    const res = await reserveGlobalAiBudget(client, { limit: 1000, today: "2026-07-18" });
    expect(res).toEqual({ allowed: true, count: null, durable: false });
  });

  it("fails OPEN when the RPC throws", async () => {
    const client = {
      rpc: async () => {
        throw new Error("network down");
      },
    };
    const res = await reserveGlobalAiBudget(client, { limit: 1000, today: "2026-07-18" });
    expect(res).toEqual({ allowed: true, count: null, durable: false });
  });

  it("is a no-op (allowed) when no client is configured", async () => {
    const res = await reserveGlobalAiBudget(null, { limit: 1000 });
    expect(res).toEqual({ allowed: true, count: null, durable: false });
  });

  it("treats limit 0 as unlimited (no durable call)", async () => {
    const client = mockClient(() => ({ data: 999999, error: null }));
    const res = await reserveGlobalAiBudget(client, { limit: 0, today: "2026-07-18" });
    expect(res.allowed).toBe(true);
    expect(client.calls.length).toBe(0);
  });

  it("utcDayKey returns a YYYY-MM-DD string", () => {
    expect(utcDayKey(new Date("2026-07-18T14:30:00Z"))).toBe("2026-07-18");
  });
});
