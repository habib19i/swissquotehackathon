/**
 * Drives a key generation session across parties that may live in other processes.
 * The phone is the coordinator: it calls each service round by round and routes the messages.
 * Messages between the two services are sealed end to end (seal.ts), so the phone only relays them.
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import { KEYGEN_ROUNDS, type RoundInput, type RoundOutput } from "./keygen";
import { PRESIGN_ROUNDS, type Signature, type SignParty } from "./sign";
import { deliverTo, type WireMessage } from "./wire";

/** A party as the coordinator sees it: local (on the phone) or remote (a service over HTTP). */
export interface PartyHandle {
  partyId: number;
  start(): Promise<WireMessage[]>;
  round(n: number, input: RoundInput): Promise<RoundOutput>;
}

export type KeygenProgress = (round: number, total: number) => void;

/** Runs all rounds and returns the shared public key (hex). Every party must agree on it. */
export async function coordinateKeygen(parties: PartyHandle[], onProgress?: KeygenProgress): Promise<string> {
  const ordered = [...parties].sort((a, b) => a.partyId - b.partyId);
  let messages = (await Promise.all(ordered.map((p) => p.start()))).flat();
  let commitments: string[] | undefined;
  let outputs: RoundOutput[] = [];

  for (let n = 1; n <= KEYGEN_ROUNDS; n++) {
    onProgress?.(n, KEYGEN_ROUNDS);
    outputs = await Promise.all(
      ordered.map((p) => p.round(n, { messages: deliverTo(messages, p.partyId), commitments })),
    );
    messages = outputs.flatMap((o) => o.messages);
    if (n === 1) commitments = outputs.map((o) => required(o.commitment, "commitment"));
  }

  const keys = new Set(outputs.map((o) => required(o.publicKey, "public key")));
  if (keys.size !== 1) throw new Error("Parties disagree on the public key; key generation aborted");
  return [...keys][0];
}

/**
 * The other key holder in a signing session. It decides what it signs: it computes the digest
 * itself from the request (never trusting the phone) and returns it when the session starts.
 */
export interface RemoteSigner {
  partyId: number;
  start(): Promise<{ messages: WireMessage[]; digest: string }>;
  round(n: number, messages: WireMessage[]): Promise<WireMessage[]>;
  /** Exchanges last messages; the remote holder combines on its side too. */
  finish(lastMessages: WireMessage[]): Promise<WireMessage[]>;
}

/**
 * Signs `digest` with this device's share and one remote holder. Aborts before any pre-signature
 * work if the two sides do not agree on exactly what is being signed.
 */
export async function coordinateSign(local: SignParty, remote: RemoteSigner, digest: Uint8Array): Promise<Signature> {
  const started = await remote.start();
  if (started.digest !== bytesToHex(digest)) {
    throw new Error("The other key holder would sign something different; signing stopped");
  }
  let messages = [...local.start(), ...started.messages];
  for (let n = 1; n <= PRESIGN_ROUNDS; n++) {
    const [mine, theirs] = await Promise.all([
      local.round(n, deliverTo(messages, local.partyId)),
      remote.round(n, deliverTo(messages, remote.partyId)),
    ]);
    messages = [...mine, ...theirs];
  }
  const theirLast = await remote.finish(local.lastMessage(digest));
  return local.combine(theirLast);
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`A party did not return its ${what}`);
  return value;
}
