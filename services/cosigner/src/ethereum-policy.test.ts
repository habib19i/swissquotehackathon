import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Address, Hex } from "viem";
import {
  GAS,
  batchCall,
  deployment,
  payContactCall,
  rulesTarget,
  selfCall,
  usdcForChf,
  usdcTransfer,
  userOpHash,
  type UserOp,
} from "@sqw/ethereum";
import { DEMO_ATTACKER_ETH_ADDRESS, DEMO_CONTACTS, applyChange, defaultRulebook, type Contact } from "@sqw/shared";
import { PolicyError } from "./bitcoin-policy";
import { authorizeEthOp, reviewEthOp, type EthPolicyContext } from "./ethereum-policy";

const ACCOUNT: Address = "0x00000000000000000000000000000000000000aa";
const SWISSQUOTE: Address = "0x00000000000000000000000000000000000000cc";
const PASSKEY = { x: `0x${"01".repeat(32)}` as Hex, y: `0x${"02".repeat(32)}` as Hex };
const USDC_CHF = 0.8;
const leo = DEMO_CONTACTS[0].ethAddress!;
const thief: Contact = { id: "thief", name: "Mr. Smith", ethAddress: DEMO_ATTACKER_ETH_ADDRESS };

const rulebook = { ...defaultRulebook(), contacts: DEMO_CONTACTS };
const target = rulesTarget(rulebook, USDC_CHF);
const settings = { mpcSigner: SWISSQUOTE, passkeyX: PASSKEY.x, passkeyY: PASSKEY.y, contactsRoot: target.contactsRoot, dailyLimit: target.dailyLimit };
const ctx: EthPolicyContext = { account: ACCOUNT, settings, passkey: PASSKEY, rulebook, target, usdcChf: USDC_CHF, swissquote: SWISSQUOTE };

const op = (callData: Hex, extra: Partial<UserOp> = {}): UserOp => ({
  sender: ACCOUNT,
  nonce: 0n,
  callData,
  callGasLimit: GAS.call,
  verificationGasLimit: GAS.verification,
  preVerificationGas: GAS.preVerification,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
  signature: "0x",
  ...extra,
});
const pay = (to: Address, chf: number) => op(batchCall([usdcTransfer(to, usdcForChf(chf, USDC_CHF))]));
const refused = (fn: () => unknown, reason: RegExp) => assert.throws(fn, (err) => err instanceof PolicyError && reason.test(err.message));

test("Swissquote co-signs a payment to a contact and signs the hash it computed itself", () => {
  const payment = pay(leo, 50);
  assert.equal(reviewEthOp(payment, ctx).shield?.verdict, "APPROVE");
  assert.equal(`0x${bytesToHex(authorizeEthOp(payment, ctx))}`, userOpHash(payment));
});

test("above the daily limit, the client must confirm on the card first", () => {
  const big = pay(leo, 250);
  refused(() => authorizeEthOp(big, ctx), /confirmation first/);
  assert.ok(authorizeEthOp(big, ctx, true));
});

test("attacker mode: CHF 5,000 in USDC to the thief is blocked, even if 'confirmed'", () => {
  refused(() => authorizeEthOp(pay(DEMO_ATTACKER_ETH_ADDRESS, 5_000), ctx, true), /never paid/);
});

test("while the safe is frozen, payments are blocked", () => {
  const frozen = { ...ctx, rulebook: { ...rulebook, frozen: true } };
  refused(() => authorizeEthOp(pay(leo, 10), frozen, true), /frozen/);
});

test("the on-chain rulebook can only be set to the rules in force, not to a pending change", () => {
  const sync = op(batchCall([selfCall(ACCOUNT, { kind: "setRulebook", root: target.contactsRoot, limit: target.dailyLimit })]));
  assert.ok(authorizeEthOp(sync, ctx));

  const pending = rulesTarget(applyChange(rulebook, { kind: "addContact", contact: thief }), USDC_CHF);
  const early = op(batchCall([selfCall(ACCOUNT, { kind: "setRulebook", root: pending.contactsRoot, limit: target.dailyLimit })]));
  refused(() => authorizeEthOp(early, ctx), /waiting period/);

  const higher = op(batchCall([selfCall(ACCOUNT, { kind: "setRulebook", root: target.contactsRoot, limit: target.dailyLimit * 10n })]));
  refused(() => authorizeEthOp(higher, ctx), /rules in force/);
});

test("after a recovery, only the new phone's passkey can be set", () => {
  const recovered = op(batchCall([selfCall(ACCOUNT, { kind: "setPasskey", ...PASSKEY })]));
  assert.ok(authorizeEthOp(recovered, ctx));
  const thiefKey = op(batchCall([selfCall(ACCOUNT, { kind: "setPasskey", x: PASSKEY.y, y: PASSKEY.x })]));
  refused(() => authorizeEthOp(thiefKey, ctx), /recovered this safe/);
});

test("operations for another account, another deployment, or daily payments are refused", () => {
  const payment = pay(leo, 10).callData;
  refused(() => authorizeEthOp({ ...op(payment), sender: SWISSQUOTE }, ctx), /not for your safe/);
  refused(() => authorizeEthOp(op(payment, deployment({ ...settings, passkeyX: PASSKEY.y })), ctx), /different account/);
  assert.ok(authorizeEthOp(op(payment, deployment(settings)), ctx), "its own deployment is fine");
  refused(() => authorizeEthOp(op(payContactCall(leo, 1n, [], 0n)), ctx), /Face ID alone/);
});

test("one payment at a time, plus at most a small fee to Swissquote", () => {
  const withFee = op(batchCall([usdcTransfer(leo, 1_000_000n), usdcTransfer(SWISSQUOTE, 10_000n)]));
  assert.deepEqual(reviewEthOp(withFee, ctx).fee, 10_000n);
  refused(() => reviewEthOp(op(batchCall([usdcTransfer(leo, 1n), usdcTransfer(leo, 1n)])), ctx), /one payment at a time/);
  refused(() => reviewEthOp(op(batchCall([usdcTransfer(leo, 1n), usdcTransfer(SWISSQUOTE, 50_000_000n)])), ctx), /fee is too high/);
});
