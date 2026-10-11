import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Address, Hex } from "viem";
import { encodeFunctionData, erc20Abi } from "viem";
import {
  DEPLOYMENTS,
  PROTOCOLS,
  aavePoolAbi,
  GAS,
  USDC,
  appParams,
  useAppCall,
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
const settings = { factory: DEPLOYMENTS.factory, mpcSigner: SWISSQUOTE, passkeyX: PASSKEY.x, passkeyY: PASSKEY.y, contactsRoot: target.contactsRoot, dailyLimit: target.dailyLimit };
const ctx: EthPolicyContext = { account: ACCOUNT, settings, passkey: PASSKEY, rulebook, target, usdcChf: USDC_CHF, ethChf: 2_500, swissquote: SWISSQUOTE };

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

const swap = (checked: boolean) =>
  op(useAppCall(DEPLOYMENTS.adapters.uniswap, appParams({ app: "uniswap", tokenIn: USDC.address, amountIn: 10_000_000n, minOut: 1n }), checked));

test("approved apps are written on-chain only once in force", () => {
  const withUniswap = { ...ctx, target: rulesTarget({ ...rulebook, apps: ["uniswap"] }, USDC_CHF) };
  const approve = op(batchCall([selfCall(ACCOUNT, { kind: "setApp", app: DEPLOYMENTS.adapters.uniswap, approved: true })]));
  assert.ok(authorizeEthOp(approve, withUniswap));
  refused(() => authorizeEthOp(approve, ctx), /waiting period/);
});

test("an app outside the approved ones: Swissquote explains it and the client confirms", () => {
  const review = reviewEthOp(swap(true), ctx);
  assert.equal(review.shield?.verdict, "NEEDS_CONFIRMATION");
  assert.match(review.shield!.reasons.join(" "), /exchange USDC 10.00 .*Uniswap.*back to your own safe.*not one of your approved apps/);
  refused(() => authorizeEthOp(swap(true), ctx), /confirmation first/);
  assert.ok(authorizeEthOp(swap(true), ctx, true));

  const approvedCtx = { ...ctx, rulebook: { ...rulebook, apps: ["uniswap"] } };
  assert.equal(reviewEthOp(swap(true), approvedCtx).shield?.verdict, "APPROVE");
});

test("only vetted adapters, and never while frozen", () => {
  const unknown = op(useAppCall(SWISSQUOTE, "0x", true));
  refused(() => reviewEthOp(unknown, ctx), /not vetted/);
  const frozen = { ...ctx, rulebook: { ...rulebook, frozen: true } };
  refused(() => authorizeEthOp(swap(true), frozen, true), /frozen/);
});

const call = (target: Address, data: Hex) => op(batchCall([{ target, value: 0n, data }]));
const approve = (spender: Address) => call(PROTOCOLS.weth, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 10n ** 15n] }));
const supply = (onBehalfOf: Address) =>
  call(PROTOCOLS.aave.pool, encodeFunctionData({ abi: aavePoolAbi, functionName: "supply", args: [PROTOCOLS.weth, 10n ** 15n, onBehalfOf, 0] }));
const withdraw = (to: Address) => call(PROTOCOLS.aave.pool, encodeFunctionData({ abi: aavePoolAbi, functionName: "withdraw", args: [PROTOCOLS.weth, 10n ** 15n, to] }));

test("a connected app (app.aave.com): Aave approvals and deposits for the safe itself, after the client confirms", () => {
  assert.equal(reviewEthOp(approve(PROTOCOLS.aave.pool), ctx).shield?.verdict, "NEEDS_CONFIRMATION");
  refused(() => authorizeEthOp(supply(ACCOUNT), ctx), /confirmation first/);
  assert.ok(authorizeEthOp(supply(ACCOUNT), ctx, true));
  assert.ok(authorizeEthOp(withdraw(ACCOUNT), ctx, true));
  assert.match(reviewEthOp(supply(ACCOUNT), ctx).shield!.reasons.join(" "), /deposit ETH 0.001.* in Aave/);
});

test("a connected app cannot send the money elsewhere or get a token approval for itself", () => {
  refused(() => reviewEthOp(approve(DEMO_ATTACKER_ETH_ADDRESS), ctx), /only lets apps it has vetted/);
  refused(() => reviewEthOp(supply(DEMO_ATTACKER_ETH_ADDRESS), ctx), /credited to someone else/);
  refused(() => reviewEthOp(withdraw(DEMO_ATTACKER_ETH_ADDRESS), ctx), /go to someone else/);
});
