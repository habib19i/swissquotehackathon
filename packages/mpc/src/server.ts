/**
 * MPC party endpoints, mounted by each key-share holder service (co-signer, recovery provider).
 * One implementation, but every service runs it in its own process with its own store.
 *
 *   GET  /mpc/identity                       this party's box public key (for sealing)
 *   POST /mpc/keygen                         start key generation for a new wallet
 *   POST /mpc/keygen/:sessionId/rounds/:n    run round n (1..4); the share is stored after round 4
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { KEYGEN_ROUNDS, KeygenParty } from "./keygen";
import { nodeDkls } from "./node";
import { PHONE } from "./parties";
import { seal, unseal, type BoxKeyPair } from "./seal";
import type { WireMessage } from "./wire";

export { sqliteIdentity, sqliteMpcStore } from "./sqlite-store";

export interface MpcSession {
  walletId: string;
  /** The next round this session accepts; rounds must arrive in order. */
  nextRound: number;
  state: Uint8Array;
}

/** The holder's own storage. Shares never leave it. */
export interface MpcStore {
  hasShare(walletId: string): boolean;
  saveShare(walletId: string, share: Uint8Array, publicKey: string): void;
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

  router.get("/mpc/identity", (_req, res) => {
    res.json({ partyId, boxPublicKey: bytesToHex(identity.publicKey) });
  });

  router.post("/mpc/keygen", (req, res) => {
    const { walletId, sessionId } = req.body ?? {};
    if (typeof walletId !== "string" || typeof sessionId !== "string") {
      throw new MpcError(400, "walletId and sessionId are required");
    }
    if (store.hasShare(walletId)) throw new MpcError(409, "This wallet already has a key");
    if (store.loadSession(sessionId)) throw new MpcError(409, "Session already exists");

    const party = KeygenParty.create(nodeDkls, partyId);
    const messages = party.start();
    store.saveSession(sessionId, { walletId, nextRound: 1, state: party.toBytes() });
    res.json({ messages });
  });

  router.post("/mpc/keygen/:sessionId/rounds/:n", async (req, res) => {
    const sessionId = String(req.params.sessionId);
    const n = Number(req.params.n);
    const session = store.loadSession(sessionId);
    if (!session) throw new MpcError(404, "Unknown session");
    if (n !== session.nextRound) throw new MpcError(409, `Expected round ${session.nextRound}, got ${n}`);

    const party = KeygenParty.restore(nodeDkls, partyId, session.state);
    const output = party.round(n, {
      messages: await openIncoming(req.body?.messages ?? []),
      commitments: req.body?.commitments,
    });

    if (n === KEYGEN_ROUNDS) {
      store.saveShare(session.walletId, party.result().toBytes(), output.publicKey!);
      store.deleteSession(sessionId);
    } else {
      store.saveSession(sessionId, { ...session, nextRound: n + 1, state: party.toBytes() });
    }
    res.json({ ...output, messages: await sealOutgoing(output.messages) });
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
