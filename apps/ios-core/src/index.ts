/**
 * Entry point of the wallet core. The iOS app calls
 * `await window.sqwCore.call(method, argsJson)` (WKWebView `callAsyncJavaScript`) and gets a JSON string:
 * `{"ok":true,"value":…}` or `{"ok":false,"error":{"name","message",…}}`.
 */
import { InsufficientFundsError } from "@sqw/bitcoin";
import { ServiceError } from "../../web/lib/http";
import { NotEnoughInOnePocketError } from "../../web/lib/wallet-bitcoin";
import { OperationFailedError } from "../../web/lib/wallet-usdc";
import { PlannerUnavailableError } from "../../web/lib/assistant/planner";
import { callService, methods } from "./api";
import { toWire } from "./serialize";

/** Errors the screens react to, with the fields they need (the web pages use `instanceof`). */
function errorOf(err: unknown) {
  const base = { name: "Error", message: err instanceof Error ? err.message : String(err) };
  if (err instanceof ServiceError) return { ...base, name: "ServiceError", status: err.status };
  if (err instanceof NotEnoughInOnePocketError) {
    return { ...base, name: "NotEnoughInOnePocketError", pocketMax: err.pocketMax.toString(), savingsMax: err.savingsMax.toString() };
  }
  if (err instanceof InsufficientFundsError) return { ...base, name: "InsufficientFundsError", available: err.available.toString() };
  if (err instanceof OperationFailedError) return { ...base, name: "OperationFailedError", sent: toWire(err.sent) };
  if (err instanceof PlannerUnavailableError) return { ...base, name: "PlannerUnavailableError" };
  return base;
}

async function call(method: string, argsJson = "[]"): Promise<string> {
  try {
    const args = JSON.parse(argsJson) as unknown[];
    const run = methods[method] as ((...args: unknown[]) => unknown) | undefined;
    const value = run ? await run(...args) : await callService(method, args);
    return JSON.stringify({ ok: true, value: toWire(value) ?? null });
  } catch (err) {
    return JSON.stringify({ ok: false, error: errorOf(err) });
  }
}

declare global {
  interface Window {
    sqwCore: { call: typeof call; methods: string[] };
  }
}

window.sqwCore = { call, methods: Object.keys(methods) };
