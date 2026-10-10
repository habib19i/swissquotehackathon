/**
 * Thin adapter over Silence Laboratories' DKLs23 threshold ECDSA library
 * (@silencelaboratories/dkls-wasm-ll-node). We never implement cryptography ourselves:
 * this file only routes the library's protocol messages between parties.
 *
 * Party ids are fixed across the system (CLAUDE.md section 5):
 *   0 = client's phone, 1 = Swissquote co-signer, 2 = recovery provider.
 *
 * The runners below drive all parties in one process. They are used by tests and the M0 spike;
 * the services exchange the same messages over the network from M1 on.
 */
import { KeygenSession, Keyshare, Message, SignSession } from "@silencelaboratories/dkls-wasm-ll-node";
import type { ShareHolder } from "@sqw/shared";

export { Keyshare };

export const PARTICIPANTS = 3;
export const THRESHOLD = 2;

export const PARTY_ID: Record<ShareHolder, number> = {
  phone: 0,
  cosigner: 1,
  "recovery-provider": 2,
};

/** Broadcast messages from everyone except `party`. */
function broadcastTo(msgs: Message[], party: number): Message[] {
  return msgs.filter((m) => m.from_id !== party).map((m) => m.clone());
}

/** Point-to-point messages addressed to `party`. */
function directTo(msgs: Message[], party: number): Message[] {
  return msgs.filter((m) => m.to_id === party).map((m) => m.clone());
}

function freeAll(msgs: Message[]) {
  for (const m of msgs) m.free();
}

/** The library consumes key shares passed to it; work on copies so callers keep theirs. */
function copy(share: Keyshare): Keyshare {
  return Keyshare.fromBytes(share.toBytes());
}

/** Runs the 4 rounds of DKLs23 key generation (also used for refresh and recovery). */
function runKeygenRounds(sessions: KeygenSession[]): Keyshare[] {
  const msg1 = sessions.map((s) => s.createFirstMessage());
  const msg2 = sessions.flatMap((s, i) => s.handleMessages(broadcastTo(msg1, i)));
  const commitments = sessions.map((s) => s.calculateChainCodeCommitment());
  const msg3 = sessions.flatMap((s, i) => s.handleMessages(directTo(msg2, i)));
  const msg4 = sessions.flatMap((s, i) => s.handleMessages(directTo(msg3, i), commitments));
  sessions.forEach((s, i) => s.handleMessages(broadcastTo(msg4, i)));
  [msg1, msg2, msg3, msg4].forEach(freeAll);
  return sessions.map((s) => s.keyshare());
}

/** 2-of-3 distributed key generation. The key never exists in one place. */
export function keygen(): Keyshare[] {
  const sessions = Array.from({ length: PARTICIPANTS }, (_, id) => new KeygenSession(PARTICIPANTS, THRESHOLD, id));
  return runKeygenRounds(sessions);
}

/**
 * Proactive refresh: every holder gets a new share of the SAME key; old shares stop working together
 * with new ones. All three holders take part.
 */
export function refresh(shares: Keyshare[]): Keyshare[] {
  return runKeygenRounds(shares.map((s) => KeygenSession.initKeyRotation(copy(s))));
}

/**
 * Lost-share recovery (CLAUDE.md section 8, step 6): the two remaining holders and the new phone
 * run a refresh that issues a fresh share to the new phone. Same public key, old phone share useless.
 */
export function recoverLostShare(remaining: Keyshare[], lostParty: number): Keyshare[] {
  const publicKey = remaining[0].publicKey;
  const lost = Uint8Array.of(lostParty);
  const sessions: KeygenSession[] = [];
  for (let id = 0; id < PARTICIPANTS; id++) {
    const share = remaining.find((s) => s.partyId === id);
    sessions.push(
      share
        ? KeygenSession.initKeyRecovery(copy(share), lost)
        : KeygenSession.initLostShareRecovery(PARTICIPANTS, THRESHOLD, id, publicKey, lost),
    );
  }
  return runKeygenRounds(sessions);
}

/**
 * 2-party signing of a 32-byte digest. Returns the raw (r, s) pair; chain-specific encoding
 * (low-S, DER, recovery id) lives in signature.ts. Each pre-signature is used exactly once.
 */
export function sign(shares: [Keyshare, Keyshare], digest: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  if (digest.length !== 32) throw new Error("MPC signing expects a 32-byte digest");
  const sessions = shares.map((share) => new SignSession(copy(share), "m"));
  const msg1 = sessions.map((s) => s.createFirstMessage());
  const msg2 = sessions.flatMap((s, i) => s.handleMessages(broadcastTo(msg1, partyOf(shares, i))));
  const msg3 = sessions.flatMap((s, i) => s.handleMessages(directTo(msg2, partyOf(shares, i))));
  sessions.forEach((s, i) => s.handleMessages(directTo(msg3, partyOf(shares, i))));
  const last = sessions.map((s) => s.lastMessage(digest));
  const results = sessions.map((s, i) => s.combine(broadcastTo(last, partyOf(shares, i))));
  [msg1, msg2, msg3, last].forEach(freeAll);
  const [r, s] = results[0] as [Uint8Array, Uint8Array];
  return { r, s };
}

function partyOf(shares: Keyshare[], index: number): number {
  return shares[index].partyId;
}
