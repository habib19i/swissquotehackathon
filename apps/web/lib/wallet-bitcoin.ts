/**
 * Bitcoin side of the app: balances, Spending pocket payments and activity, on signet.
 */
import {
  balanceOf,
  buildPocketPayment,
  esplora,
  maxPocketAmount,
  signWithPocketKey,
  type Balance,
  type EsploraTx,
  type PocketPayment,
} from "@sqw/bitcoin";
import { DEMO_CONTACTS, type Contact } from "@sqw/shared";
import { pocketOf, type WalletProfile } from "./profile";
import { ESPLORA_URL } from "./services";
import { unlockVault } from "./vault";

const net = esplora(ESPLORA_URL);

export interface Balances {
  pocket: Balance;
  savings: Balance;
}

export async function loadBalances(profile: WalletProfile): Promise<Balances> {
  const [pocket, savings] = await Promise.all([net.utxos(profile.pocketAddress), net.utxos(profile.savingsAddress)]);
  return { pocket: balanceOf(pocket), savings: balanceOf(savings) };
}

/** The most the pocket can pay right now, after the network fee. */
export async function pocketAvailable(profile: WalletProfile): Promise<bigint> {
  const [utxos, feeRate] = await Promise.all([net.utxos(profile.pocketAddress), net.feeRate()]);
  return maxPocketAmount(utxos, feeRate);
}

/** Builds the payment so the confirmation card can show the exact amount and network fee. */
export async function preparePocketPayment(profile: WalletProfile, to: Contact, amount: bigint) {
  if (!to.btcAddress) throw new Error(`${to.name} has no Bitcoin address`);
  const [utxos, feeRate] = await Promise.all([net.utxos(profile.pocketAddress), net.feeRate()]);
  return buildPocketPayment({ pocket: pocketOf(profile), utxos, to: to.btcAddress, amount, feeRate });
}

/** Face ID unlocks the pocket key on this phone; the payment is signed here and broadcast. */
export async function sendFromPocket(profile: WalletProfile, payment: PocketPayment): Promise<string> {
  const { pocketKey } = await unlockVault(profile.passkey, profile.walletId);
  try {
    const { hex } = signWithPocketKey(payment.psbt, pocketKey);
    return await net.broadcast(hex);
  } finally {
    pocketKey.fill(0);
  }
}

export interface ActivityItem {
  txid: string;
  /** Plain-language description, e.g. "To Léo" or "Received in your Spending pocket". */
  label: string;
  /** Net effect on the client's safe in satoshis (negative when money left it). */
  amount: bigint;
  /** Satoshis paid to the network. */
  fee: bigint;
  confirmed: boolean;
  time?: Date;
}

function nameOf(address: string | undefined, profile: WalletProfile): string | undefined {
  if (address === profile.pocketAddress) return "your Spending pocket";
  if (address === profile.savingsAddress) return "your Savings safe";
  return DEMO_CONTACTS.find((c) => c.btcAddress === address)?.name;
}

function describe(tx: EsploraTx, profile: WalletProfile): ActivityItem {
  const mine = (a?: string) => a === profile.pocketAddress || a === profile.savingsAddress;
  const spent = tx.vin.reduce((sum, i) => sum + (i.prevout && mine(i.prevout.scriptpubkey_address) ? BigInt(i.prevout.value) : 0n), 0n);
  const received = tx.vout.reduce((sum, o) => sum + (mine(o.scriptpubkey_address) ? BigInt(o.value) : 0n), 0n);
  const amount = received - spent;

  let label: string;
  if (spent === 0n) {
    const into = tx.vout.find((o) => mine(o.scriptpubkey_address))?.scriptpubkey_address;
    label = `Received in ${nameOf(into, profile)}`;
  } else {
    const external = tx.vout.find((o) => !mine(o.scriptpubkey_address));
    label = external ? `To ${nameOf(external.scriptpubkey_address, profile) ?? "a new recipient"}` : "Moved between your pockets";
  }

  return {
    txid: tx.txid,
    label,
    amount,
    fee: spent > 0n ? BigInt(tx.fee) : 0n,
    confirmed: tx.status.confirmed,
    time: tx.status.block_time ? new Date(tx.status.block_time * 1000) : undefined,
  };
}

export async function loadActivity(profile: WalletProfile): Promise<ActivityItem[]> {
  const lists = await Promise.all([net.transactions(profile.pocketAddress), net.transactions(profile.savingsAddress)]);
  const byId = new Map(lists.flat().map((tx) => [tx.txid, tx]));
  return [...byId.values()]
    .map((tx) => describe(tx, profile))
    .sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0));
}
