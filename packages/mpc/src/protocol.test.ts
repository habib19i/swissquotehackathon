/**
 * Networked key generation: the phone coordinates, the two services run the real /mpc routes
 * over HTTP with their own stores.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { hexToBytes } from "@noble/hashes/utils.js";
import { coordinateKeygen, type PartyHandle } from "./coordinator";
import { localKeygenParty, remoteKeygenParty } from "./client";
import { KeygenParty } from "./keygen";
import { Keyshare, nodeDkls, sign } from "./node";
import { PARTY_ID } from "./parties";
import { newBoxKeyPair, seal, unseal } from "./seal";
import { mpcRouter, peerKeysFrom, type MpcSession, type MpcStore } from "./server";
import { bitcoinCompact, verifyDigest } from "./signature";
import type { WireMessage } from "./wire";

const { phone, cosigner, "recovery-provider": provider } = PARTY_ID;

function memoryStore() {
  const shares = new Map<string, Uint8Array>();
  const sessions = new Map<string, MpcSession>();
  const store: MpcStore = {
    hasShare: (walletId) => shares.has(walletId),
    saveShare: (walletId, share) => void shares.set(walletId, share),
    loadSession: (id) => sessions.get(id),
    saveSession: (id, session) => void sessions.set(id, session),
    deleteSession: (id) => void sessions.delete(id),
  };
  return { store, shares };
}

const urls: Record<number, string> = {};
const servers = [cosigner, provider].map((partyId) => {
  const { store, shares } = memoryStore();
  const app = express().use(mpcRouter({ partyId, store, identity: newBoxKeyPair(), peerPublicKey: peerKeysFrom(urls) }));
  const server = app.listen(0);
  urls[partyId] = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { server, shares };
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
  const cosignerShare = Keyshare.fromBytes(cosignerService.shares.get(walletId)!);
  const providerShare = Keyshare.fromBytes(providerService.shares.get(walletId)!);
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
