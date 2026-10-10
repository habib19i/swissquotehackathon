/**
 * Networked key generation and signing: the phone coordinates, the two services run the real
 * /mpc routes over HTTP with their own stores.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { coordinateKeygen, coordinateSign, type PartyHandle } from "./coordinator";
import { localKeygenParty, remoteKeygenParty, remoteRecoveryParty, remoteSigner } from "./client";
import { KeygenParty } from "./keygen";
import { Keyshare, nodeDkls, sign } from "./node";
import { PARTY_ID } from "./parties";
import { newBoxKeyPair, seal, unseal } from "./seal";
import { MpcError, mpcRouter, peerKeysFrom, type MpcSession, type MpcStore } from "./server";
import { SignParty } from "./sign";
import { bitcoinCompact, verifyDigest } from "./signature";
import type { WireMessage } from "./wire";

const { phone, cosigner, "recovery-provider": provider } = PARTY_ID;

function memoryStore() {
  const shares = new Map<string, { share: Uint8Array; publicKey: string }>();
  const sessions = new Map<string, MpcSession>();
  const store: MpcStore = {
    hasShare: (walletId) => shares.has(walletId),
    getShare: (walletId) => shares.get(walletId)?.share,
    getPublicKey: (walletId) => shares.get(walletId)?.publicKey,
    saveShare: (walletId, share, publicKey) => void shares.set(walletId, { share, publicKey }),
    replaceShare: (walletId, share, publicKey) => void shares.set(walletId, { share, publicKey }),
    loadSession: (id) => sessions.get(id),
    saveSession: (id, session) => void sessions.set(id, session),
    deleteSession: (id) => void sessions.delete(id),
  };
  return { store, shares };
}

/** Test policy: signs the SHA-256 of a text message, and refuses anything mentioning "steal". */
interface TestRequest {
  message: string;
}
const digestOf = (request: TestRequest) => sha256(new TextEncoder().encode(request.message));

const urls: Record<number, string> = {};
const servers = [cosigner, provider].map((partyId) => {
  const { store, shares } = memoryStore();
  const signed: { request: unknown; signature: { r: Uint8Array; s: Uint8Array } }[] = [];
  const app = express().use(
    mpcRouter({
      partyId,
      store,
      identity: newBoxKeyPair(),
      peerPublicKey: peerKeysFrom(urls),
      authorizeSign: async (_walletId, request) => {
        const { message } = request as TestRequest;
        if (message.includes("steal")) throw new MpcError(403, "Refused by policy");
        return digestOf({ message });
      },
      onSigned: (_walletId, request, signature) => void signed.push({ request, signature }),
      // Test policy: a recovery needs the request to say it was verified.
      authorizeRecovery: async (_walletId, _lost, request) => {
        if ((request as { verified?: boolean })?.verified !== true) throw new MpcError(403, "Recovery not verified");
      },
    }),
  );
  const server = app.listen(0);
  urls[partyId] = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { server, shares, signed };
});
const [cosignerService, providerService] = servers;
after(() => servers.forEach((s) => s.server.close()));

/** Records every message the coordinator relays, to check what the phone can see. */
function recording(handle: PartyHandle, seen: WireMessage[]): PartyHandle {
  return {
    partyId: handle.partyId,
    start: async () => (await handle.start()).map((m) => (seen.push(m), m)),
    round: async (n, input) => {
      const out = await handle.round(n, input);
      seen.push(...out.messages);
      return out;
    },
  };
}

test("phone, Swissquote and the recovery provider create a key over HTTP; each keeps only its share", async () => {
  const walletId = randomUUID();
  const sessionId = randomUUID();
  const seen: WireMessage[] = [];
  const local = localKeygenParty(KeygenParty.create(nodeDkls, phone));

  const publicKey = await coordinateKeygen([
    local,
    recording(remoteKeygenParty(urls[cosigner], cosigner, walletId, sessionId), seen),
    recording(remoteKeygenParty(urls[provider], provider, walletId, sessionId), seen),
  ]);

  const phoneShare = local.share();
  const cosignerShare = Keyshare.fromBytes(cosignerService.shares.get(walletId)!.share);
  const providerShare = Keyshare.fromBytes(providerService.shares.get(walletId)!.share);
  assert.deepEqual(phoneShare.publicKey, hexToBytes(publicKey));
  assert.deepEqual(cosignerShare.publicKey, hexToBytes(publicKey));
  assert.deepEqual(providerShare.publicKey, hexToBytes(publicKey));

  const digest = crypto.getRandomValues(new Uint8Array(32));
  const { r, s } = sign([phoneShare, cosignerShare], digest);
  assert.ok(verifyDigest(bitcoinCompact(r, s), digest, phoneShare.publicKey));

  const betweenServices = seen.filter((m) => m.to !== undefined && m.to !== phone);
  assert.ok(betweenServices.length > 0);
  assert.ok(betweenServices.every((m) => m.sealed), "the phone only ever relays sealed service-to-service messages");
});

test("a service refuses to create a second key for the same wallet", async () => {
  const walletId = randomUUID();
  await coordinateKeygen([
    localKeygenParty(KeygenParty.create(nodeDkls, phone)),
    remoteKeygenParty(urls[cosigner], cosigner, walletId, randomUUID()),
    remoteKeygenParty(urls[provider], provider, walletId, randomUUID()),
  ]);
  await assert.rejects(
    remoteKeygenParty(urls[cosigner], cosigner, walletId, randomUUID()).start(),
    /already has a key/,
  );
});

test("a service refuses an unsealed message claiming to come from the other service", async () => {
  const sessionId = randomUUID();
  const handle = remoteKeygenParty(urls[cosigner], cosigner, randomUUID(), sessionId);
  await handle.start();
  const forged: WireMessage = { from: provider, to: cosigner, payload: "00" };
  await assert.rejects(handle.round(1, { messages: [forged] }), /must be sealed/);
});

test("sealed messages cannot be read or altered by the relay", () => {
  const sender = newBoxKeyPair();
  const recipient = newBoxKeyPair();
  const sealed = seal({ from: 1, to: 2, payload: "cafe" }, recipient.publicKey, sender.secretKey);
  assert.notEqual(sealed.payload, "cafe");
  assert.equal(unseal(sealed, sender.publicKey, recipient.secretKey).payload, "cafe");

  const tampered = { ...sealed, payload: sealed.payload.slice(0, -2) + (sealed.payload.endsWith("00") ? "01" : "00") };
  assert.throws(() => unseal(tampered, sender.publicKey, recipient.secretKey), /failed authentication/);
  assert.throws(() => unseal(sealed, newBoxKeyPair().publicKey, recipient.secretKey), /failed authentication/);
});

/** A wallet created over HTTP; returns the phone's share. */
async function createWallet() {
  const walletId = randomUUID();
  const sessionId = randomUUID();
  const local = localKeygenParty(KeygenParty.create(nodeDkls, phone));
  await coordinateKeygen([
    local,
    remoteKeygenParty(urls[cosigner], cosigner, walletId, sessionId),
    remoteKeygenParty(urls[provider], provider, walletId, sessionId),
  ]);
  return { walletId, phoneShare: local.share() };
}

test("phone + Swissquote sign over HTTP; Swissquote computes what it signs itself", async () => {
  const { walletId, phoneShare } = await createWallet();
  const request = { message: "Pay Léo CHF 20" };
  const digest = digestOf(request);

  const signature = await coordinateSign(
    SignParty.create(nodeDkls, phoneShare),
    remoteSigner(urls[cosigner], cosigner, walletId, randomUUID(), request),
    digest,
  );

  assert.ok(verifyDigest(bitcoinCompact(signature.r, signature.s), digest, phoneShare.publicKey));
  const record = cosignerService.signed.at(-1)!;
  assert.deepEqual(record.request, request);
  assert.deepEqual(record.signature, signature, "Swissquote holds the same signature for its records");
});

test("phone + recovery provider can sign without Swissquote", async () => {
  const { walletId, phoneShare } = await createWallet();
  const request = { message: "Move everything out" };
  const signature = await coordinateSign(
    SignParty.create(nodeDkls, phoneShare),
    remoteSigner(urls[provider], provider, walletId, randomUUID(), request),
    digestOf(request),
  );
  assert.ok(verifyDigest(bitcoinCompact(signature.r, signature.s), digestOf(request), phoneShare.publicKey));
});

test("a holder's policy can refuse to sign", async () => {
  const { walletId, phoneShare } = await createWallet();
  const request = { message: "steal everything" };
  await assert.rejects(
    coordinateSign(
      SignParty.create(nodeDkls, phoneShare),
      remoteSigner(urls[cosigner], cosigner, walletId, randomUUID(), request),
      digestOf(request),
    ),
    /Refused by policy/,
  );
});

test("signing stops if the phone and the holder would sign different things", async () => {
  const { walletId, phoneShare } = await createWallet();
  const shown = { message: "Pay Léo CHF 20" };
  const sent = { message: "Pay Léo CHF 2000" };
  await assert.rejects(
    coordinateSign(
      SignParty.create(nodeDkls, phoneShare),
      remoteSigner(urls[cosigner], cosigner, walletId, randomUUID(), sent),
      digestOf(shown),
    ),
    /would sign something different/,
  );
});

test("a signing session is single-use: its pre-signature cannot be spent twice", async () => {
  const { walletId, phoneShare } = await createWallet();
  const request = { message: "Pay Adam CHF 10" };
  const sessionId = randomUUID();
  const remote = remoteSigner(urls[cosigner], cosigner, walletId, sessionId, request);
  await coordinateSign(SignParty.create(nodeDkls, phoneShare), remote, digestOf(request));
  await assert.rejects(remote.finish([]), /Unknown session/);
});

test("lost phone over HTTP: Swissquote and the provider issue a new phone share; old shares are gone", async () => {
  const { walletId, phoneShare: lostPhone } = await createWallet();
  const oldCosigner = Keyshare.fromBytes(cosignerService.shares.get(walletId)!.share);
  const sessionId = randomUUID();
  const newPhone = localKeygenParty(KeygenParty.recoverAs(nodeDkls, phone, lostPhone.publicKey));
  const evidence = { verified: true };

  const publicKey = await coordinateKeygen([
    newPhone,
    remoteRecoveryParty(urls[cosigner], cosigner, walletId, sessionId, phone, evidence),
    remoteRecoveryParty(urls[provider], provider, walletId, sessionId, phone, evidence),
  ]);
  assert.deepEqual(hexToBytes(publicKey), lostPhone.publicKey, "same key, same addresses");

  const newCosigner = Keyshare.fromBytes(cosignerService.shares.get(walletId)!.share);
  const digest = digestOf({ message: "after recovery" });
  const sig = sign([newPhone.share(), newCosigner], digest);
  assert.ok(verifyDigest(bitcoinCompact(sig.r, sig.s), digest, lostPhone.publicKey), "new phone + Swissquote sign");

  assert.notDeepEqual(oldCosigner.toBytes(), newCosigner.toBytes(), "Swissquote's old share was replaced");
  const oldPhoneSigns = (() => {
    try {
      const s = sign([lostPhone, newCosigner], digest);
      return verifyDigest(bitcoinCompact(s.r, s.s), digest, lostPhone.publicKey);
    } catch {
      return false;
    }
  })();
  assert.equal(oldPhoneSigns, false, "the lost phone's share is useless");
});

test("a key holder refuses a recovery its policy has not approved", async () => {
  const { walletId, phoneShare } = await createWallet();
  const party = remoteRecoveryParty(urls[cosigner], cosigner, walletId, randomUUID(), phone, { verified: false });
  await assert.rejects(party.start(), /Recovery not verified/);
  assert.ok(phoneShare);
});
