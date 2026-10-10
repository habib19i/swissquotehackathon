/**
 * One party's side of DKLs23 signing (2 of 3 holders), serializable between rounds like KeygenParty.
 *
 * Rounds 1-3 build a pre-signature that does not depend on the message. Round 4 exchanges the last
 * messages over the digest and combines them into (r, s). A pre-signature is used exactly once:
 * reusing one would expose the key, so a session is consumed by `combine`.
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import { copy } from "./keygen";
import type { DklsKeyshare, DklsLib } from "./lib";
import { fromWire, toWire, type WireMessage } from "./wire";

type DklsSignSession = InstanceType<DklsLib["SignSession"]>;

export const PRESIGN_ROUNDS = 3;

/** Every share is a share of the root key; Bitcoin and Ethereum use it underived. */
const CHAIN_PATH = "m";

export interface Signature {
  r: Uint8Array;
  s: Uint8Array;
}

export class SignParty {
  private constructor(
    private readonly lib: DklsLib,
    private readonly session: DklsSignSession,
    readonly partyId: number,
  ) {}

  static create(lib: DklsLib, share: DklsKeyshare): SignParty {
    return new SignParty(lib, new lib.SignSession(copy(lib, share), CHAIN_PATH), share.partyId);
  }

  static restore(lib: DklsLib, partyId: number, bytes: Uint8Array): SignParty {
    return new SignParty(lib, lib.SignSession.fromBytes(bytes), partyId);
  }

  toBytes(): Uint8Array {
    return this.session.toBytes();
  }

  start(): WireMessage[] {
    return toWire([this.session.createFirstMessage()]);
  }

  /** Pre-signature rounds 1 to 3. */
  round(n: number, messages: WireMessage[]): WireMessage[] {
    if (n < 1 || n > PRESIGN_ROUNDS) throw new Error(`Unknown signing round ${n}`);
    return toWire(this.session.handleMessages(fromWire(this.lib, messages)));
  }

  /** This party's last message, binding the pre-signature to the 32-byte digest. */
  lastMessage(digest: Uint8Array): WireMessage[] {
    if (digest.length !== 32) throw new Error("MPC signing expects a 32-byte digest");
    return toWire([this.session.lastMessage(digest)]);
  }

  /** Combines the other parties' last messages into the signature. Consumes the session. */
  combine(messages: WireMessage[]): Signature {
    const [r, s] = this.session.combine(fromWire(this.lib, messages)) as [Uint8Array, Uint8Array];
    return { r, s };
  }
}

export function signatureToHex({ r, s }: Signature) {
  return { r: bytesToHex(r), s: bytesToHex(s) };
}
