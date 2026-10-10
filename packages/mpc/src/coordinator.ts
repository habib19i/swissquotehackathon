/**
 * Drives a key generation session across parties that may live in other processes.
 * The phone is the coordinator: it calls each service round by round and routes the messages.
 * Messages between the two services are sealed end to end (seal.ts), so the phone only relays them.
 */
import { KEYGEN_ROUNDS, type RoundInput, type RoundOutput } from "./keygen";
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

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`A party did not return its ${what}`);
  return value;
}
