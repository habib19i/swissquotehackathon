/**
 * MPC party endpoints, mounted by each key-share holder service (co-signer, recovery provider).
 * One implementation, but every service runs it in its own process with its own store.
 *
 *   GET  /mpc/identity                       this party's box public key (for sealing)
 *   POST /mpc/keygen                         start key generation for a new wallet
 *   POST /mpc/keygen/:sessionId/rounds/:n    run round n (1..4); the share is stored after round 4
 *   POST /mpc/recover                        lost-share recovery: issue a new share to the party that lost it
 *                                            (then the same rounds as keygen); the stored share is replaced
 *   POST /mpc/sign                           ask this holder to co-sign; its policy computes the digest
 *   POST /mpc/sign/:sessionId/rounds/:n      rounds 1..3 build the pre-signature, round 4 signs
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { KEYGEN_ROUNDS, KeygenParty } from "./keygen";
import { nodeDkls } from "./node";
import { PHONE } from "./parties";
import { seal, unseal, type BoxKeyPair } from "./seal";
import { PRESIGN_ROUNDS, SignParty, type Signature } from "./sign";
import type { WireMessage } from "./wire";

export { addColumnIfMissing, sqliteIdentity, sqliteMpcStore } from "./sqlite-store";

export interface MpcSession {
  walletId: string;
  kind: "keygen" | "recovery" | "sign";
  /** The next round this session accepts; rounds must arrive in order. */
  nextRound: number;
  state: Uint8Array;
  /** Sign sessions: the digest this holder agreed to sign (hex), fixed when the session starts. */
  digest?: string;
  /** Sign and recovery sessions: the request, kept for the holder's records. */
  request?: unknown;
}

/** The holder's own storage. Shares never leave it. */
export interface MpcStore {
  hasShare(walletId: string): boolean;
  getShare(walletId: string): Uint8Array | undefined;
  getPublicKey(walletId: string): string | undefined;
  saveShare(walletId: string, share: Uint8Array, publicKey: string): void;
  /** Overwrites the share after a refresh or recovery: the old share must not survive. */
  replaceShare(walletId: string, share: Uint8Array, publicKey: string): void;
  loadSession(sessionId: string): MpcSession | undefined;
  saveSession(sessionId: string, session: MpcSession): void;
  deleteSession(sessionId: string): void;
}

export interface MpcPartyConfig {
  partyId: number;
  store: MpcStore;
  identity: BoxKeyPair;
  /** Box public key of another service, obtained directly from that service, never via the phone. */
  peerPublicKey(partyId: number): Promise<Uint8Array>;
  /**
   * This holder's signing policy. Checks the request against its own rules and returns the 32-byte
   * digest to sign, computed by the holder itself. Throw an MpcError to refuse.
   */
  authorizeSign(walletId: string, request: unknown): Promise<Uint8Array>;
  /** Called once a signature exists, for the holder's own records. */
  onSigned?(walletId: string, request: unknown, signature: Signature): void | Promise<void>;
  /**
   * This holder's recovery policy: may it help issue a new share to party `lostPartyId`?
   * Throw an MpcError to refuse. Without this hook, the holder never takes part in a recovery.
   */
  authorizeRecovery?(walletId: string, lostPartyId: number, request: unknown): Promise<void>;
  /** Called once this holder's share was replaced by a recovery. */
  onRecovered?(walletId: string, request: unknown): void | Promise<void>;
}

export class MpcError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function mpcRouter(config: MpcPartyConfig) {
  const { partyId, store, identity } = config;
  const router = express.Router();
  router.use(express.json({ limit: "10mb" }));

  /** Services talk to each other only through sealed messages; the phone talks to us directly. */
  async function openIncoming(msgs: WireMessage[]): Promise<WireMessage[]> {
    return Promise.all(
      msgs.map(async (m) =>
        m.from !== PHONE && m.to === partyId ? unseal(m, await config.peerPublicKey(m.from), identity.secretKey) : m,
      ),
    );
  }

  async function sealOutgoing(msgs: WireMessage[]): Promise<WireMessage[]> {
    return Promise.all(
      msgs.map(async (m) =>
        m.to !== undefined && m.to !== PHONE ? seal(m, await config.peerPublicKey(m.to), identity.secretKey) : m,
      ),
    );
  }

  function sessionFor(req: Request, kinds: MpcSession["kind"][]) {
    const sessionId = String(req.params.sessionId);
    const n = Number(req.params.n);
    const session = store.loadSession(sessionId);
    if (!session || !kinds.includes(session.kind)) throw new MpcError(404, "Unknown session");
    if (n !== session.nextRound) throw new MpcError(409, `Expected round ${session.nextRound}, got ${n}`);
    return { sessionId, n, session };
  }

  function newSession(req: Request, kind: MpcSession["kind"]) {
    const { walletId, sessionId } = req.body ?? {};
    if (typeof walletId !== "string" || typeof sessionId !== "string") {
      throw new MpcError(400, "walletId and sessionId are required");
    }
    if (store.loadSession(sessionId)) throw new MpcError(409, "Session already exists");
    return { walletId, sessionId };
  }

  router.get("/mpc/identity", (_req, res) => {
    res.json({ partyId, boxPublicKey: bytesToHex(identity.publicKey) });
  });

  // ---------------------------------------------------------------- key generation

  router.post("/mpc/keygen", (req, res) => {
    const { walletId, sessionId } = newSession(req, "keygen");
    if (store.hasShare(walletId)) throw new MpcError(409, "This wallet already has a key");

    const party = KeygenParty.create(nodeDkls, partyId);
    const messages = party.start();
    store.saveSession(sessionId, { walletId, kind: "keygen", nextRound: 1, state: party.toBytes() });
    res.json({ messages });
  });

  router.post("/mpc/recover", async (req, res) => {
    const { walletId, sessionId } = newSession(req, "recovery");
    const lostPartyId = Number(req.body.lostPartyId);
    const share = store.getShare(walletId);
    if (!share) throw new MpcError(404, "Unknown wallet");
    if (lostPartyId === partyId || !(lostPartyId >= 0)) throw new MpcError(400, "Invalid lost party");
    if (!config.authorizeRecovery) throw new MpcError(403, "This key holder does not take part in recoveries");
    await config.authorizeRecovery(walletId, lostPartyId, req.body.request);

    const party = KeygenParty.recoverWith(nodeDkls, nodeDkls.Keyshare.fromBytes(share), lostPartyId);
    const messages = party.start();
    store.saveSession(sessionId, { walletId, kind: "recovery", nextRound: 1, state: party.toBytes(), request: req.body.request });
    res.json({ messages });
  });

  router.post("/mpc/keygen/:sessionId/rounds/:n", async (req, res) => {
    const { sessionId, n, session } = sessionFor(req, ["keygen", "recovery"]);
    const party = KeygenParty.restore(nodeDkls, partyId, session.state);
    const output = party.round(n, {
      messages: await openIncoming(req.body?.messages ?? []),
      commitments: req.body?.commitments,
    });

    if (n === KEYGEN_ROUNDS) {
      store.deleteSession(sessionId);
      if (session.kind === "recovery") {
        // Same key, new shares: the old share is overwritten and can never sign again with the new ones.
        const publicKey = output.publicKey!;
        if (publicKey !== store.getPublicKey(session.walletId)) throw new MpcError(500, "Recovery produced a different key");
        store.replaceShare(session.walletId, party.result().toBytes(), publicKey);
        await config.onRecovered?.(session.walletId, session.request);
      } else {
        store.saveShare(session.walletId, party.result().toBytes(), output.publicKey!);
      }
    } else {
      store.saveSession(sessionId, { ...session, nextRound: n + 1, state: party.toBytes() });
    }
    res.json({ ...output, messages: await sealOutgoing(output.messages) });
  });

  // ---------------------------------------------------------------- signing

  router.post("/mpc/sign", async (req, res) => {
    const { walletId, sessionId } = newSession(req, "sign");
    const share = store.getShare(walletId);
    if (!share) throw new MpcError(404, "Unknown wallet");

    // The policy decides, and computes what is signed. Nothing from the phone is signed blindly.
    const request = req.body.request;
    const digest = bytesToHex(await config.authorizeSign(walletId, request));

    const party = SignParty.create(nodeDkls, nodeDkls.Keyshare.fromBytes(share));
    const messages = party.start();
    store.saveSession(sessionId, { walletId, kind: "sign", nextRound: 1, state: party.toBytes(), digest, request });
    res.json({ messages, digest });
  });

  router.post("/mpc/sign/:sessionId/rounds/:n", async (req, res) => {
    const { sessionId, n, session } = sessionFor(req, ["sign"]);
    const party = SignParty.restore(nodeDkls, partyId, session.state);
    const incoming = await openIncoming(req.body?.messages ?? []);

    if (n <= PRESIGN_ROUNDS) {
      const messages = party.round(n, incoming);
      store.saveSession(sessionId, { ...session, nextRound: n + 1, state: party.toBytes() });
      return res.json({ messages: await sealOutgoing(messages) });
    }

    // Round 4: the pre-signature is spent on the agreed digest, then the session is gone for good.
    store.deleteSession(sessionId);
    const messages = party.lastMessage(hexToBytes(session.digest!));
    const signature = party.combine(incoming);
    await config.onSigned?.(session.walletId, session.request, signature);
    res.json({ messages: await sealOutgoing(messages) });
  });

  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof MpcError ? err.status : 400;
    res.status(status).json({ error: err.message });
  });

  return router;
}

/** Fetches (and caches) other services' box public keys directly from them. */
export function peerKeysFrom(urls: Record<number, string>) {
  const cache = new Map<number, Uint8Array>();
  return async (peerId: number): Promise<Uint8Array> => {
    const cached = cache.get(peerId);
    if (cached) return cached;
    const url = urls[peerId];
    if (!url) throw new MpcError(400, `Party ${peerId} is not a known service`);
    const body = (await (await fetch(`${url}/mpc/identity`)).json()) as { partyId: number; boxPublicKey: string };
    if (body.partyId !== peerId) throw new MpcError(502, `Service at ${url} is not party ${peerId}`);
    const key = hexToBytes(body.boxPublicKey);
    cache.set(peerId, key);
    return key;
  };
}
