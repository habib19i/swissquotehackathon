/**
 * Node.js build of DKLs23, plus in-process runners that drive all parties in one process.
 * Used by the services (their own party only), the tests and the M0 spike.
 */
import * as dkls from "@silencelaboratories/dkls-wasm-ll-node";
import { KEYGEN_ROUNDS, KeygenParty, copy, type RoundInput } from "./keygen";
import type { DklsKeyshare, DklsLib } from "./lib";
import { PARTICIPANTS } from "./parties";
import { deliverTo, fromWire, toWire, type WireMessage } from "./wire";

export const nodeDkls: DklsLib = dkls;
export const Keyshare = dkls.Keyshare;
export type Keyshare = DklsKeyshare;

/** Runs every round for parties that all live in this process. */
function runLocally(parties: KeygenParty[]): DklsKeyshare[] {
  let messages = parties.flatMap((p) => p.start());
  let commitments: RoundInput["commitments"];
  for (let n = 1; n <= KEYGEN_ROUNDS; n++) {
    const outputs = parties.map((p) => p.round(n, { messages: deliverTo(messages, p.partyId), commitments }));
    messages = outputs.flatMap((o) => o.messages);
    if (n === 1) commitments = outputs.map((o) => o.commitment!);
  }
  return parties.map((p) => p.result());
}

/** 2-of-3 distributed key generation. The key never exists in one place. */
export function keygen(): DklsKeyshare[] {
  return runLocally(Array.from({ length: PARTICIPANTS }, (_, id) => KeygenParty.create(dkls, id)));
}

/** New shares of the same key for all three holders. */
export function refresh(shares: DklsKeyshare[]): DklsKeyshare[] {
  return runLocally(shares.map((s) => KeygenParty.refresh(dkls, s)));
}

/** The two remaining holders issue a fresh share to the party that lost its own. */
export function recoverLostShare(remaining: DklsKeyshare[], lostPartyId: number): DklsKeyshare[] {
  const publicKey = remaining[0].publicKey;
  const parties = Array.from({ length: PARTICIPANTS }, (_, id) => {
    const share = remaining.find((s) => s.partyId === id);
    return share ? KeygenParty.recoverWith(dkls, share, lostPartyId) : KeygenParty.recoverAs(dkls, id, publicKey);
  });
  return runLocally(parties);
}

/**
 * Two holders sign a 32-byte digest. Returns the raw (r, s) pair; chain-specific encoding
 * (low-S, recovery bit) lives in signature.ts. Each pre-signature is used exactly once.
 */
export function sign(shares: [DklsKeyshare, DklsKeyshare], digest: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  if (digest.length !== 32) throw new Error("MPC signing expects a 32-byte digest");
  const sessions = shares.map((share) => new dkls.SignSession(copy(dkls, share), "m"));
  const ids = shares.map((s) => s.partyId);
  const step = (msgs: WireMessage[]) =>
    sessions.flatMap((s, i) => toWire(s.handleMessages(fromWire(dkls, deliverTo(msgs, ids[i])))));

  const msg1 = toWire(sessions.map((s) => s.createFirstMessage()));
  const msg3 = step(step(msg1));
  step(msg3);
  const last = toWire(sessions.map((s) => s.lastMessage(digest)));
  const [r, s] = sessions[0].combine(fromWire(dkls, deliverTo(last, ids[0]))) as [Uint8Array, Uint8Array];
  sessions.slice(1).forEach((session) => session.free());
  return { r, s };
}
