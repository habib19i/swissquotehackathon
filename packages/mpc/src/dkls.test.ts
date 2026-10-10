import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { PARTY_ID, keygen, recoverLostShare, refresh, sign } from "./dkls";
import { bitcoinCompact, ethereumSignature, verifyDigest } from "./signature";

const { phone, cosigner, "recovery-provider": provider } = PARTY_ID;

function signAndVerify(a: Parameters<typeof sign>[0][0], b: Parameters<typeof sign>[0][1], publicKey: Uint8Array) {
  const digest = randomBytes(32);
  const { r, s } = sign([a, b], digest);
  return verifyDigest(bitcoinCompact(r, s), digest, publicKey);
}

test("2-of-3 keygen gives every holder a share of the same public key", () => {
  const shares = keygen();
  assert.equal(shares.length, 3);
  assert.deepEqual(
    shares.map((s) => s.partyId),
    [phone, cosigner, provider],
  );
  const pk = shares[0].publicKey;
  assert.equal(pk.length, 33, "compressed secp256k1 public key");
  for (const s of shares) assert.deepEqual(s.publicKey, pk);
});

test("any two holders can sign; the signature verifies against the shared public key", () => {
  const [p, c, r] = keygen();
  const pk = p.publicKey;
  assert.ok(signAndVerify(p, c, pk), "phone + Swissquote");
  assert.ok(signAndVerify(p, r, pk), "phone + recovery provider (Swissquote offline)");
  assert.ok(signAndVerify(c, r, pk), "Swissquote + recovery provider (recovery only)");
});

test("signatures are low-S and carry a valid Ethereum recovery bit", () => {
  const [p, c] = keygen();
  for (let i = 0; i < 5; i++) {
    const digest = randomBytes(32);
    const { r, s } = sign([p, c], digest);
    const eth = ethereumSignature(r, s, digest, p.publicKey);
    assert.ok(BigInt(eth.s) <= secp256k1.Point.Fn.ORDER / 2n);
    assert.ok(eth.yParity === 0 || eth.yParity === 1);
  }
});

test("refresh keeps the same key and makes old shares incompatible with new ones", () => {
  const old = keygen();
  const fresh = refresh(old);
  const pk = old[0].publicKey;
  assert.deepEqual(fresh[0].publicKey, pk);
  assert.ok(signAndVerify(fresh[0], fresh[1], pk));
  assert.equal(safeSignAndVerify(old[0], fresh[1], pk), false, "old phone share + new Swissquote share");
});

test("lost phone: Swissquote + provider issue a new phone share for the same key", () => {
  const [lostPhone, c, r] = keygen();
  const pk = c.publicKey;
  const recovered = recoverLostShare([c, r], phone);
  assert.deepEqual(recovered[phone].publicKey, pk);
  assert.ok(signAndVerify(recovered[phone], recovered[cosigner], pk), "new phone + Swissquote");
  assert.ok(signAndVerify(recovered[phone], recovered[provider], pk), "new phone + provider");
  assert.equal(safeSignAndVerify(lostPhone, recovered[cosigner], pk), false);
});

/** Signing with mismatched shares may throw inside the protocol or produce an invalid signature. */
function safeSignAndVerify(...args: Parameters<typeof signAndVerify>): boolean {
  try {
    return signAndVerify(...args);
  } catch {
    return false;
  }
}
