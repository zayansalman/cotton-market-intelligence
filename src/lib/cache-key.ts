import { createHash } from "crypto";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalize(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.keys(input)
      .sort()
      .reduce<Record<string, JsonValue>>((acc, key) => {
        if (input[key] !== undefined) acc[key] = normalize(input[key]);
        return acc;
      }, {});
  }
  return null;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function cacheKey(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
