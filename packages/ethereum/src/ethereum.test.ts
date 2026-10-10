import assert from "node:assert/strict";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { decodeAbiParameters, hexToBytes, keccak256, slice, toHex, type Address, type Hex } from "viem";
import { DEMO_CONTACTS, contactProof, defaultRulebook } from "@sqw/shared";
import { passkeyFromSpki } from "./account";
import { batchCall, decodeActions, payContactCall, selfCall, usdcTransfer, UnsupportedCallError } from "./calls";
import { USDC } from "./config";
import { ethOwnershipMessage, ethOwnershipProof } from "./ownership";
import { limitMatches, rulesTarget, syncActions } from "./rules";
import { mpcSignature, passkeySignature } from "./signatures";
import { formatUsdc, usdcForChf, usdcUnits } from "./usdc";
import { GAS, paymasterHash, userOpFromJson, userOpHash, userOpToJson, type UserOp } from "./userop";

const ACCOUNT: Address = "0x00000000000000000000000000000000000000aa";
const leo = DEMO_CONTACTS.find((c) => c.id === "leo")!.ethAddress!;
const ATTACKER: Address = "0xE2a0455E058a23E152C18f56103c99522554867f";

const op = (callData: Hex): UserOp => ({
  sender: ACCOUNT,
  nonce: 3n,
  callData,
  callGasLimit: GAS.call,
  verificationGasLimit: GAS.verification,
  preVerificationGas: GAS.preVerification,
  maxFeePerGas: 12_000_000n,
  maxPriorityFeePerGas: 1_000_000n,
  paymaster: "0x00000000000000000000000000000000000000bb",
  paymasterVerificationGasLimit: GAS.paymasterVerification,
  paymasterPostOpGasLimit: GAS.paymasterPostOp,
  paymasterData: "0x",
  signature: "0x",
});

test("passkey public key is read from the SubjectPublicKeyInfo WebAuthn returns", () => {
  const publicKey = p256.getPublicKey(p256.utils.randomSecretKey(), false);
  const spki = `3059301306072a8648ce3d020106082a8648ce3d030107034200${bytesToHex(publicKey)}`;
  const { x, y } = passkeyFromSpki(spki);
  assert.equal(x, toHex(publicKey.slice(1, 33)));
  assert.equal(y, toHex(publicKey.slice(33)));
  assert.throws(() => passkeyFromSpki("30820122300d06092a864886f70d01010105000382010f00"), /P-256/);
});

test("passkey signature: DER is converted to low-S r, s with the clientDataJSON indexes", () => {
  const secretKey = p256.utils.randomSecretKey();
  const challenge = keccak256("0x1234");
  const clientDataJSON = new TextEncoder().encode(
    `{"type":"webauthn.get","challenge":"${Buffer.from(hexToBytes(challenge)).toString("base64url")}","origin":"http://localhost:3000"}`,
  );
  const authenticatorData = new Uint8Array(37).fill(5);
  const digest = sha256(new Uint8Array([...authenticatorData, ...sha256(clientDataJSON)]));

  for (let i = 0; i < 8; i++) {
    const der = p256.sign(digest, secretKey, { prehash: false, lowS: false, format: "der" });
    const encoded = passkeySignature({ authenticatorData, clientDataJSON, signature: der });
    assert.equal(slice(encoded, 0, 1), "0x01");
    const [r, s, challengeIndex, typeIndex, auth, json] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes" }],
      slice(encoded, 1),
    );
    assert.ok(BigInt(s) <= p256.Point.Fn.ORDER / 2n, "low S");
    assert.equal(challengeIndex, 23n);
    assert.equal(typeIndex, 1n);
    assert.equal(auth, toHex(authenticatorData));
    assert.equal(json, toHex(clientDataJSON));
    const compact = hexToBytes(`${r}${s.slice(2)}`);
    assert.ok(p256.verify(compact, digest, p256.getPublicKey(secretKey), { prehash: false }), "still a valid signature");
  }
});

test("MPC signature is key type 0x00 then r, s, v", () => {
  const r = `0x${"11".repeat(32)}` as Hex;
  const s = `0x${"22".repeat(32)}` as Hex;
  assert.equal(mpcSignature({ r, s, yParity: 1 }), `0x00${"11".repeat(32)}${"22".repeat(32)}1c`);
});

test("a daily payment decodes to one payContact action", () => {
  const proof = contactProof(DEMO_CONTACTS, leo);
  const [action] = decodeActions(ACCOUNT, payContactCall(leo, usdcUnits(12.5), proof, 10_000n));
  assert.deepEqual(action, { kind: "payContact", to: leo, amount: 12_500_000n, proof, fee: 10_000n });
});

test("a batch decodes to its USDC transfers and rulebook calls", () => {
  const root = rulesTarget({ ...defaultRulebook(), contacts: DEMO_CONTACTS }, 0.8).contactsRoot;
  const callData = batchCall([
    selfCall(ACCOUNT, { kind: "setRulebook", root, limit: 125_000_000n }),
    usdcTransfer(leo, 5_000_000n),
  ]);
  assert.deepEqual(decodeActions(ACCOUNT, callData), [
    { kind: "setRulebook", root, limit: 125_000_000n },
    { kind: "usdcTransfer", to: leo, amount: 5_000_000n },
  ]);
});

test("calls to other contracts, ETH transfers and nested daily payments are refused", () => {
  const other = { target: ATTACKER, value: 0n, data: "0x" as Hex };
  assert.throws(() => decodeActions(ACCOUNT, batchCall([other])), UnsupportedCallError);
  assert.throws(() => decodeActions(ACCOUNT, batchCall([{ ...usdcTransfer(leo, 1n), value: 1n }])), UnsupportedCallError);
  const pay = { target: ACCOUNT, value: 0n, data: payContactCall(leo, 1n, [], 0n) };
  assert.throws(() => decodeActions(ACCOUNT, batchCall([pay])), UnsupportedCallError);
  assert.throws(() => decodeActions(ACCOUNT, "0xdeadbeef"), UnsupportedCallError);
});

test("UserOperations survive the JSON round trip and their hash covers the call", () => {
  const original = op(payContactCall(leo, 1n, [], 0n));
  const copy = userOpFromJson(JSON.parse(JSON.stringify(userOpToJson(original))));
  assert.deepEqual(copy, original);
  assert.equal(userOpHash(copy), userOpHash(original));
  assert.notEqual(userOpHash(op(payContactCall(leo, 2n, [], 0n))), userOpHash(original));
  assert.equal(userOpHash({ ...original, signature: "0x01" }), userOpHash(original), "the signature is not hashed");
  assert.throws(() => userOpFromJson({ ...userOpToJson(original), sender: "leo" }), /sender/);
});

test("Swissquote's sponsorship covers the call, the gas and the validity window", () => {
  const base = op(payContactCall(leo, 1n, [], 0n));
  const hash = paymasterHash(base, 1_000, 0);
  assert.notEqual(paymasterHash(op(payContactCall(ATTACKER, 1n, [], 0n)), 1_000, 0), hash);
  assert.notEqual(paymasterHash({ ...base, maxFeePerGas: base.maxFeePerGas * 10n }, 1_000, 0), hash);
  assert.notEqual(paymasterHash(base, 2_000, 0), hash);
  assert.equal(paymasterHash({ ...base, paymasterData: "0x1234", signature: "0x99" }, 1_000, 0), hash);
});

test("USDC amounts: CHF limits convert at the day's rate, rounded down to the cent", () => {
  assert.equal(usdcForChf(100, 0.8), 125_000_000n);
  assert.equal(usdcForChf(100, 0.81), 123_450_000n);
  assert.equal(formatUsdc(123_450_000n), "USDC 123.45");
  assert.equal(USDC.decimals, 6);
});

test("on-chain rules are updated only when they really differ", () => {
  const rulebook = { ...defaultRulebook(), contacts: DEMO_CONTACTS };
  const target = rulesTarget(rulebook, 0.8);
  const onChain = { deployed: true, ...target, passkeyX: "0x" as Hex, passkeyY: "0x" as Hex, remainingToday: 0n };

  assert.deepEqual(syncActions(onChain, target), []);
  assert.ok(limitMatches(target.dailyLimit, rulesTarget(rulebook, 0.81).dailyLimit), "1% rate drift is no change");
  assert.deepEqual(syncActions({ ...onChain, dailyLimit: target.dailyLimit * 2n }, target), [
    { kind: "setRulebook", root: target.contactsRoot, limit: target.dailyLimit },
  ]);

  const withoutLeo = rulesTarget({ ...rulebook, contacts: DEMO_CONTACTS.filter((c) => c.id !== "leo"), frozen: true }, 0.8);
  assert.deepEqual(syncActions(onChain, withoutLeo), [
    { kind: "setRulebook", root: withoutLeo.contactsRoot, limit: withoutLeo.dailyLimit },
    { kind: "setFrozen", frozen: true },
  ]);
});

test("ownership proof: the message names client and account; before deployment it carries the deployment (ERC-6492)", () => {
  const message = ethOwnershipMessage("CH-4417-2093", ACCOUNT, "2026-10-10T12:00:00.000Z");
  assert.match(message, /Client: CH-4417-2093/);
  assert.ok(message.includes(`Digital dollar account (Base): ${ACCOUNT}`));

  const signature = mpcSignature({ r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, yParity: 0 });
  const settings = { mpcSigner: ACCOUNT, passkeyX: `0x${"01".repeat(32)}` as Hex, passkeyY: `0x${"02".repeat(32)}` as Hex, contactsRoot: `0x${"03".repeat(32)}` as Hex, dailyLimit: 1n };
  assert.equal(ethOwnershipProof(signature, true, settings), signature);
  const wrapped = ethOwnershipProof(signature, false, settings);
  assert.ok(wrapped.endsWith("6492".repeat(16)), "ERC-6492 magic suffix");
});
