/**
 * One party's side of DKLs23 key generation. The same 4-round protocol also runs key refresh and
 * lost-share recovery; only the way the session starts differs.
 *
 * A party can be serialized between rounds (`toBytes` / `restore`), so the services can run it
 * across separate HTTP requests and keep the state in their own database.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { DklsKeygenSession, DklsKeyshare, DklsLib } from "./lib";
import { PARTICIPANTS, THRESHOLD } from "./parties";
import { fromWire, toWire, type WireMessage } from "./wire";

export const KEYGEN_ROUNDS = 4;

export type KeygenKind = "keygen" | "refresh" | "recovery";

export interface RoundInput {
  messages: WireMessage[];
  /** Chain-code commitments of all parties, in party-id order. Needed in round 3 only. */
  commitments?: string[];
}

export interface RoundOutput {
  messages: WireMessage[];
  /** This party's chain-code commitment, returned after round 1. */
  commitment?: string;
  /** Compressed public key (hex), returned after the last round. */
  publicKey?: string;
}

export class KeygenParty {
  private keyshare?: DklsKeyshare;

  private constructor(
    private readonly lib: DklsLib,
    private session: DklsKeygenSession,
    readonly partyId: number,
  ) {}

  /** Fresh 2-of-3 key generation. */
  static create(lib: DklsLib, partyId: number): KeygenParty {
    return new KeygenParty(lib, new lib.KeygenSession(PARTICIPANTS, THRESHOLD, partyId), partyId);
  }

  /** Proactive refresh: a new share of the same key. */
  static refresh(lib: DklsLib, share: DklsKeyshare): KeygenParty {
    return new KeygenParty(lib, lib.KeygenSession.initKeyRotation(copy(lib, share)), share.partyId);
  }

  /** Lost-share recovery, run by a holder that still has its share. */
  static recoverWith(lib: DklsLib, share: DklsKeyshare, lostPartyId: number): KeygenParty {
    const session = lib.KeygenSession.initKeyRecovery(copy(lib, share), Uint8Array.of(lostPartyId));
    return new KeygenParty(lib, session, share.partyId);
  }

  /** Lost-share recovery, run by the new device that receives a fresh share of `publicKey`. */
  static recoverAs(lib: DklsLib, partyId: number, publicKey: Uint8Array): KeygenParty {
    const session = lib.KeygenSession.initLostShareRecovery(
      PARTICIPANTS,
      THRESHOLD,
      partyId,
      publicKey,
      Uint8Array.of(partyId),
    );
    return new KeygenParty(lib, session, partyId);
  }

  static restore(lib: DklsLib, partyId: number, bytes: Uint8Array): KeygenParty {
    return new KeygenParty(lib, lib.KeygenSession.fromBytes(bytes), partyId);
  }

  toBytes(): Uint8Array {
    return this.session.toBytes();
  }

  /** Round 0: the first broadcast message. */
  start(): WireMessage[] {
    return toWire([this.session.createFirstMessage()]);
  }

  /** Rounds 1 to 4, in order. After round 4, `result()` returns the new key share. */
  round(n: number, input: RoundInput): RoundOutput {
    const msgs = fromWire(this.lib, input.messages);
    switch (n) {
      case 1: {
        const out = toWire(this.session.handleMessages(msgs));
        return { messages: out, commitment: bytesToHex(this.session.calculateChainCodeCommitment()) };
      }
      case 2:
        return { messages: toWire(this.session.handleMessages(msgs)) };
      case 3: {
        if (input.commitments?.length !== PARTICIPANTS) throw new Error("Round 3 needs every party's commitment");
        const commitments = input.commitments.map((c) => hexToBytes(c));
        return { messages: toWire(this.session.handleMessages(msgs, commitments)) };
      }
      case 4: {
        this.session.handleMessages(msgs);
        this.keyshare = this.session.keyshare(); // consumes the session
        return { messages: [], publicKey: bytesToHex(this.keyshare.publicKey) };
      }
      default:
        throw new Error(`Unknown key generation round ${n}`);
    }
  }

  result(): DklsKeyshare {
    if (!this.keyshare) throw new Error("Key generation has not finished");
    return this.keyshare;
  }
}

/** The library consumes key shares passed to it; work on copies so callers keep theirs. */
export function copy(lib: DklsLib, share: DklsKeyshare): DklsKeyshare {
  return lib.Keyshare.fromBytes(share.toBytes());
}
