/**
 * USDC: USDC on Base Sepolia, in the client's RulebookAccount (contracts/src).
 *
 * - Daily payments to approved contacts, within the daily limit: Face ID alone. The wallet passkey
 *   signs the operation; the account itself checks the contact (Merkle proof) and the limit on-chain.
 * - Anything else (above the limit, new rules, a new phone's passkey): the MPC key, signed by the
 *   phone and Swissquote after its checks. Such an operation also brings the rules on Base up to date.
 * - Swissquote runs the bundler and the paymaster, so the client never needs ETH.
 */
import { hexToBytes as hexToBytesNoble } from "@noble/hashes/utils.js";
import { get, set } from "idb-keyval";
import { hexToBytes, isAddressEqual, type Address, type Hex } from "viem";
import {
  DEPLOYMENTS,
  accountAddress,
  accountSettings,
  baseClient,
  batchCall,
  mpcSignature,
  mpcSignerAddress,
  passkeyFromSpki,
  passkeySignature,
  payContactCall,
  pendingSync,
  selfCall,
  usdcBalance,
  usdcTransfer,
  userOpFromJson,
  userOpHash,
  userOpToJson,
  type Call,
  type SelfAction,
} from "@sqw/ethereum";
import { ethereumSignature, type DklsKeyshare } from "@sqw/mpc";
import {
  contactProof,
  contactsRoot,
  type Contact,
  type EthAccountRecord,
  type EthFeeQuote,
  type EthPrepared,
  type EthSent,
  type EthStatus,
  type ShieldResult,
} from "@sqw/shared";
import { cosigner, cosignWithSwissquote, swissquoteOnline } from "./cosigner";
import { signWithPasskey } from "./passkey";
import type { WalletProfile } from "./profile";
import { BASE_RPC_URL } from "./services";
import { withShare } from "./wallet-bitcoin";

const client = baseClient(BASE_RPC_URL);
/** Reads from Base, for the rest of the app. */
export const baseReader = client;

export const USDC_ACCOUNT = "sqw.usdc-account";

/** Shown when Swissquote is offline: in this prototype, its bundler is the only way onto Base. */
export const USDC_OFFLINE =
  "While Swissquote is offline, USDC payments wait: in this prototype Swissquote relays them to the network. (In production, any standard relay could.)";

/** The operation was included on Base but did not go through. */
export class OperationFailedError extends Error {
  constructor(readonly sent: EthSent) {
    super(sent.reason ?? "The network did not carry out this operation.");
  }
}

/**
 * The phone's own check of Swissquote's record: the account must answer to this phone's MPC key and
 * passkey, at the address the factory derives from its settings.
 */
async function verified(profile: WalletProfile, record: EthAccountRecord, passkey: { x: Hex; y: Hex }): Promise<EthAccountRecord> {
  const settings = accountSettings(record);
  const ours =
    isAddressEqual(settings.mpcSigner, mpcSignerAddress(profile.mpcPublicKey)) &&
    record.passkey.x === passkey.x &&
    record.passkey.y === passkey.y;
  if (!ours) throw new Error("Swissquote recorded a USDC account with other keys. Setup stopped.");
  if (!isAddressEqual(await accountAddress(client, settings), record.address)) {
    throw new Error("Swissquote computed a different address for your USDC. Setup stopped.");
  }
  return record;
}

/** The client's USDC account: set up with Swissquote once (public keys only, no Face ID), then remembered. */
export async function usdcAccount(profile: WalletProfile): Promise<EthAccountRecord> {
  const spki = profile.passkey.publicKey;
  if (!spki || profile.passkey.algorithm !== -7) throw new Error("This safe's Face ID key is a type Base cannot check, so USDC and apps are not available. Open a new safe to use them.");
  const passkey = passkeyFromSpki(spki);
  const saved = await get<{ walletId: string; record: EthAccountRecord }>(USDC_ACCOUNT);
  if (saved?.walletId === profile.walletId && saved.record.passkey.x === passkey.x) return saved.record;

  const record = await verified(profile, await cosigner.registerEthereum(profile.walletId, spki), passkey);
  await set(USDC_ACCOUNT, { walletId: profile.walletId, record });
  return record;
}

/** USDC units in the account, read from Base directly (works while Swissquote is offline). */
export async function loadUsdcBalance(profile: WalletProfile): Promise<bigint> {
  return usdcBalance(client, (await usdcAccount(profile)).address);
}

// ---------------------------------------------------------------- operations

/** Swissquote filled in gas, nonce and its sponsorship: the operation must still be exactly ours. */
export function checked(prepared: EthPrepared, account: Address, callData: Hex): EthPrepared {
  const op = userOpFromJson(prepared.userOp);
  const same =
    isAddressEqual(op.sender, account) &&
    op.callData === callData &&
    op.paymaster !== undefined &&
    isAddressEqual(op.paymaster, DEPLOYMENTS.paymaster) &&
    userOpHash(op) === prepared.userOpHash;
  if (!same) throw new Error("Swissquote prepared a different operation than the one you asked for. Nothing was signed.");
  return prepared;
}

/** Calls that bring the rules and the passkey on Base up to date with the rules in force. */
export async function updateCalls(profile: WalletProfile, record: EthAccountRecord, status: EthStatus): Promise<Call[]> {
  const actions: SelfAction[] = pendingSync(status);
  if (actions.some((a) => a.kind === "setRulebook")) {
    // Never sign contacts the client did not approve: the root must be that of the rulebook shown to them.
    const { contacts } = await cosigner.rulebook(profile.walletId);
    if (contactsRoot(contacts) !== status.target.contactsRoot) throw new Error("Swissquote's rules for Base do not match your contacts.");
  }
  if (!status.passkeyUpToDate) actions.push({ kind: "setPasskey", ...record.passkey });
  return actions.map((a) => selfCall(record.address, a));
}

/** The phone and Swissquote sign the operation with the MPC key; Swissquote recomputes its hash. */
export async function mpcSign(profile: WalletProfile, share: DklsKeyshare, prepared: EthPrepared, clientConfirmed: boolean): Promise<Hex> {
  const digest = hexToBytes(prepared.userOpHash);
  const { r, s } = await cosignWithSwissquote(share, profile.walletId, { kind: "eth-userop", userOp: prepared.userOp, clientConfirmed }, digest);
  return mpcSignature(ethereumSignature(r, s, digest, hexToBytesNoble(profile.mpcPublicKey)));
}

export async function submit(profile: WalletProfile, prepared: EthPrepared, signature: Hex): Promise<EthSent> {
  const sent = await cosigner.ethSend(profile.walletId, userOpToJson({ ...userOpFromJson(prepared.userOp), signature }));
  if (!sent.success) throw new OperationFailedError(sent);
  return sent;
}

/**
 * Brings the rules (and, after a recovery, the passkey) on Base up to date with the MPC key. Pass the
 * share when Face ID already unlocked it. Returns undefined when there was nothing to update.
 */
export async function updateRulesOnBase(profile: WalletProfile, share?: DklsKeyshare): Promise<EthSent | undefined> {
  const record = await usdcAccount(profile);
  const calls = await updateCalls(profile, record, await cosigner.ethStatus(profile.walletId));
  if (calls.length === 0) return undefined;
  const callData = batchCall(calls);
  const prepared = checked(await cosigner.ethPrepare(profile.walletId, { callData, signer: "mpc" }), record.address, callData);
  const signature = share ? await mpcSign(profile, share, prepared, false) : await withShare(profile, (s) => mpcSign(profile, s, prepared, false));
  return submit(profile, prepared, signature);
}

// ---------------------------------------------------------------- payments

export interface UsdcPayment {
  contact: Contact;
  /** USDC units the contact receives. */
  amount: bigint;
  fee: EthFeeQuote;
  /** "passkey": Face ID alone, within the rules. "mpc": the MPC key, after Swissquote's check. */
  signer: "passkey" | "mpc";
  /** USDC units the passkey may still pay today. */
  remainingToday: bigint;
  /** Absent when Swissquote's scam shield stopped the payment. */
  prepared?: EthPrepared;
  review?: ShieldResult;
}

export async function prepareUsdcPayment(profile: WalletProfile, contact: Contact, amount: bigint): Promise<UsdcPayment> {
  const to = contact.ethAddress;
  if (!to) throw new Error(`${contact.name} has no USDC address yet.`);
  if (!(await swissquoteOnline())) throw new Error(USDC_OFFLINE);

  const record = await usdcAccount(profile);
  const id = profile.walletId;
  const [status, fee, rulebook] = await Promise.all([cosigner.ethStatus(id), cosigner.ethFee(id), cosigner.rulebook(id)]);
  const feeUnits = BigInt(fee.feeUsdc);
  const remainingToday = BigInt(status.onChain.remainingToday);
  if (amount + feeUnits > BigInt(status.balance)) throw new Error("There is not enough USDC in your safe for this payment.");

  const approved = rulebook.contacts.some((c) => c.ethAddress && isAddressEqual(c.ethAddress, to));
  const withinRules = approved && status.rulesUpToDate && status.passkeyUpToDate && !status.onChain.frozen && amount + feeUnits <= remainingToday;
  if (withinRules) {
    const callData = payContactCall(to, amount, contactProof(rulebook.contacts, to), feeUnits);
    const prepared = checked(await cosigner.ethPrepare(id, { callData, signer: "passkey" }), record.address, callData);
    return { contact, amount, fee, signer: "passkey", remainingToday, prepared };
  }

  const review = await cosigner.shieldUsdc(id, to, amount);
  if (review.verdict === "BLOCKED") return { contact, amount, fee, signer: "mpc", remainingToday, review };
  const callData = batchCall([
    ...(await updateCalls(profile, record, status)),
    usdcTransfer(to, amount),
    ...(feeUnits > 0n ? [usdcTransfer(DEPLOYMENTS.swissquote, feeUnits)] : []),
  ]);
  const prepared = checked(await cosigner.ethPrepare(id, { callData, signer: "mpc" }), record.address, callData);
  return { contact, amount, fee, signer: "mpc", remainingToday, prepared, review };
}

/** Face ID: the passkey signs a daily payment, or unlocks the share for the MPC key. */
export async function sendUsdcPayment(profile: WalletProfile, payment: UsdcPayment, clientConfirmed = false): Promise<EthSent> {
  const { prepared } = payment;
  if (!prepared) throw new Error("Swissquote stopped this payment.");
  const signature =
    payment.signer === "passkey"
      ? passkeySignature(await signWithPasskey(profile.passkey, hexToBytes(prepared.userOpHash)))
      : await withShare(profile, (share) => mpcSign(profile, share, prepared, clientConfirmed));
  return submit(profile, prepared, signature);
}
