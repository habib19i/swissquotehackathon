/**
 * Values between the core and the iOS app.
 *
 * - `toWire`: results for Swift. Plain JSON: bigints become decimal strings, bytes hex, dates ISO strings.
 *   Class instances (a PSBT, a key share) are left out: they stay in the core behind a handle.
 * - `encodeStored` / `decodeStored`: what the core asks the app to store. Tagged, so a stored value comes
 *   back exactly as it was (bigints and bytes included).
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const isPlainObject = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function toWire(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === "object") {
    if (!isPlainObject(value)) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const wired = toWire(item);
      if (wired !== undefined) out[key] = wired;
    }
    return out;
  }
  return typeof value === "function" ? undefined : value;
}

export function encodeStored(value: unknown): string {
  return JSON.stringify(value, function (key, item) {
    const raw = (this as Record<string, unknown>)[key];
    if (typeof raw === "bigint") return { $bigint: raw.toString() };
    if (raw instanceof Uint8Array) return { $bytes: bytesToHex(raw) };
    if (raw instanceof Date) return { $date: raw.toISOString() };
    return item;
  });
}

export function decodeStored<T>(json: string): T {
  return JSON.parse(json, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const keys = Object.keys(item);
      if (keys.length === 1) {
        if (typeof item.$bigint === "string") return BigInt(item.$bigint);
        if (typeof item.$bytes === "string") return hexToBytes(item.$bytes);
        if (typeof item.$date === "string") return new Date(item.$date);
      }
    }
    return item;
  }) as T;
}
