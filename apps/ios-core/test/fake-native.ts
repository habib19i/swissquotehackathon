/**
 * TEST ONLY: plays the iOS app's side of the bridge in a desktop browser, so the wallet core can be tested
 * without Xcode. A software P-256 key stands in for the Secure Enclave (same signature format), memory
 * for the Keychain and storage. The recovery key is not available here.
 */
import { p256 } from "@noble/curves/nist.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

interface Request {
  id?: number;
  method?: string;
  params?: Record<string, string>;
  event?: string;
  data?: unknown;
}

const keys = new Map<string, Uint8Array>();
const storage = new Map<string, string>();
let vault: { walletId: string; mpcShare: string; pocketKey: string } | undefined;

/** What the test reads back: every event, and how often "Face ID" was asked. */
const log = { events: [] as { event: string; data: unknown }[], faceId: 0 };
(window as unknown as { fakeNative: typeof log }).fakeNative = log;

const handlers: Record<string, (params: Record<string, string>) => unknown> = {
  "faceId.create": () => {
    const secret = p256.utils.randomSecretKey();
    const keyId = `test-key-${keys.size + 1}`;
    keys.set(keyId, secret);
    log.faceId++;
    return { keyId, publicKey: bytesToHex(p256.getPublicKey(secret, false)) };
  },
  // The Secure Enclave hashes the message with SHA-256 and returns a DER signature: so does this.
  "faceId.sign": ({ keyId, message }) => {
    const secret = keys.get(keyId);
    if (!secret) throw new Error("No such Face ID key on this phone.");
    log.faceId++;
    return { signature: bytesToHex(p256.sign(hexToBytes(message), secret, { prehash: true, lowS: false, format: "der" })) };
  },
  "faceId.confirm": () => {
    log.faceId++;
    return {};
  },
  "vault.save": ({ walletId, mpcShare, pocketKey }) => {
    vault = { walletId, mpcShare, pocketKey };
    return {};
  },
  "vault.unlock": ({ walletId }) => {
    if (!vault || vault.walletId !== walletId) throw new Error("This phone does not hold a key for this safe");
    log.faceId++;
    return { mpcShare: vault.mpcShare, pocketKey: vault.pocketKey };
  },
  "device.forget": () => {
    vault = undefined;
    keys.clear();
    return {};
  },
  "storage.get": ({ key }) => ({ value: storage.get(key) ?? null }),
  "storage.set": ({ key, value }) => {
    storage.set(key, value);
    return {};
  },
  "storage.del": ({ key }) => {
    storage.delete(key);
    return {};
  },
};

window.webkit = {
  messageHandlers: {
    native: {
      postMessage(message: unknown) {
        const { id, method, params, event, data } = message as Request;
        if (event) {
          log.events.push({ event, data });
          return;
        }
        setTimeout(() => {
          try {
            const handler = handlers[method ?? ""];
            if (!handler) throw new Error(`The test phone cannot do ${method}.`);
            window.sqwNative.reply(id!, true, JSON.stringify(handler(params ?? {})));
          } catch (err) {
            window.sqwNative.reply(id!, false, JSON.stringify({ message: (err as Error).message }));
          }
        }, 0);
      },
    },
  },
};
