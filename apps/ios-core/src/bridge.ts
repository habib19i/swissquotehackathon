/**
 * The wallet core's line to the iOS app.
 *
 * - Core to Swift: `window.webkit.messageHandlers.native.postMessage({ id, method, params })`; Swift answers
 *   with `window.sqwNative.reply(id, ok, json)`. Used for Face ID, the Keychain vault and storage.
 * - Core to Swift, one way: `{ event, data }` messages (progress of a key generation, for example).
 * Values cross as JSON: bigints as decimal strings, bytes as hex (see serialize.ts).
 */

interface NativeHandler {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { native?: NativeHandler } };
    sqwNative: { reply(id: number, ok: boolean, json: string): void };
  }
}

const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let nextId = 1;

function handler(): NativeHandler {
  const native = window.webkit?.messageHandlers?.native;
  if (!native) throw new Error("The wallet core runs inside the iOS app only.");
  return native;
}

window.sqwNative = {
  reply(id, ok, json) {
    const call = waiting.get(id);
    if (!call) return;
    waiting.delete(id);
    const value = json ? JSON.parse(json) : undefined;
    if (ok) call.resolve(value);
    else call.reject(new Error(typeof value?.message === "string" ? value.message : "The phone refused this step."));
  },
};

/** Asks the iOS app to do something only it can do (Face ID, Keychain). */
export function native<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    try {
      handler().postMessage({ id, method, params });
    } catch (err) {
      waiting.delete(id);
      reject(err as Error);
    }
  });
}

/** Tells the iOS app something happened; no answer expected. */
export function emit(event: string, data: unknown) {
  handler().postMessage({ event, data });
}
