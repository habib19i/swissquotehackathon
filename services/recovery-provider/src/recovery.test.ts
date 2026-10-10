import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
import express from "express";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { faceCheckPayload, type FaceCheckAttestation } from "@sqw/shared";
import { checkFaceAttestation } from "./face-check";
import { offlineApprovals, swissquoteIsOffline } from "./offline";
import { isReady, recoveries } from "./recoveries";

/** A stand-in for Swissquote: its face-check key and its health switch. */
const swissquoteKey = schnorr.utils.randomSecretKey();
let swissquoteOffline = false;
const server = express()
  .get("/mock/face-check/key", (_req, res) => res.json({ publicKey: bytesToHex(schnorr.getPublicKey(swissquoteKey)) }))
  .get("/health", (_req, res) => res.json({ offline: swissquoteOffline }))
  .listen(0);
const swissquote = `http://localhost:${(server.address() as AddressInfo).port}`;
after(() => server.close());

function attest(walletId: string, recoveryId: string, result: FaceCheckAttestation["result"], key = swissquoteKey): FaceCheckAttestation {
  const fields = { walletId, recoveryId, result, at: new Date().toISOString() };
  return { ...fields, signature: bytesToHex(schnorr.sign(sha256(new TextEncoder().encode(faceCheckPayload(fields))), key)) };
}

test("a recovery only becomes ready after its waiting period, and never once cancelled", () => {
  const store = recoveries(new DatabaseSync(":memory:"));
  const r = store.start("w1");
  assert.equal(isReady(r, "w1"), false, "not verified yet");

  const waiting = store.startWaiting(r.id);
  assert.equal(waiting.status, "waiting-period");
  assert.equal(isReady(waiting, "w1"), false, "still waiting");
  assert.equal(isReady({ ...waiting, waitUntil: new Date(0).toISOString() }, "w1"), true, "after the wait");
  assert.equal(isReady({ ...waiting, waitUntil: new Date(0).toISOString() }, "w2"), false, "another wallet");

  const cancelled = store.cancel(r.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(isReady({ ...cancelled, waitUntil: new Date(0).toISOString() }, "w1"), false);
});

test("Swissquote's face check: a match passes; no-match, forgeries and missing checks are refused", async () => {
  assert.deepEqual(await checkFaceAttestation(swissquote, attest("w1", "r1", "match"), "w1", "r1"), []);
  assert.match((await checkFaceAttestation(swissquote, attest("w1", "r1", "no-match"), "w1", "r1"))[0], /did not match/);
  assert.match((await checkFaceAttestation(swissquote, attest("w1", "r1", "match", schnorr.utils.randomSecretKey()), "w1", "r1"))[0], /could not be verified/);
  assert.match((await checkFaceAttestation(swissquote, attest("w1", "r9", "match"), "w1", "r1"))[0], /another recovery/);
  assert.match((await checkFaceAttestation(swissquote, undefined, "w1", "r1"))[0], /was not done/);
});

test("an offline approval covers one transaction of one wallet, for a few minutes", () => {
  const approvals = offlineApprovals(new DatabaseSync(":memory:"));
  const token = approvals.grant("w1", "tx-a");
  assert.ok(approvals.covers(token, "w1", "tx-a"));
  assert.equal(approvals.covers(token, "w1", "tx-b"), false, "another transaction");
  assert.equal(approvals.covers(token, "w2", "tx-a"), false, "another wallet");
});

test("the provider sees for itself whether Swissquote is down", async () => {
  swissquoteOffline = false;
  assert.equal(await swissquoteIsOffline(swissquote), false);
  swissquoteOffline = true;
  assert.equal(await swissquoteIsOffline(swissquote), true);
  assert.equal(await swissquoteIsOffline("http://localhost:1"), true, "unreachable counts as down");
});

test("a recovery that is never verified expires and stops showing as in progress", () => {
  const db = new DatabaseSync(":memory:");
  const store = recoveries(db);
  const stale = store.start("w1");
  db.prepare("UPDATE recoveries SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 11 * 60_000).toISOString(), stale.id);
  assert.equal(store.active("w1"), undefined);
  assert.equal(store.get(stale.id)?.status, "expired");
  const fresh = store.start("w1");
  assert.equal(store.active("w1")?.id, fresh.id);
});
