/**
 * The activity feed: every transaction touching the client's two addresses, in plain language.
 */
import { esplora, type EsploraTx } from "@sqw/bitcoin";
import { DEMO_CONTACTS } from "@sqw/shared";
import type { WalletProfile } from "./profile";
import { ESPLORA_URL } from "./services";

const net = esplora(ESPLORA_URL);

export interface ActivityItem {
  txid: string;
  /** Plain-language description, e.g. "To Léo" or "Received in your Spending pocket". */
  label: string;
  /** Net effect on the client's safe in satoshis (negative when money left it). */
  amount: bigint;
  /** Satoshis the client paid to the network (zero when Swissquote paid on the Premium plan). */
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
  const known = (a?: string) => mine(a) || DEMO_CONTACTS.some((c) => c.btcAddress === a);
  const spent = tx.vin.reduce((s, i) => s + (i.prevout && mine(i.prevout.scriptpubkey_address) ? BigInt(i.prevout.value) : 0n), 0n);
  const received = tx.vout.reduce((s, o) => s + (mine(o.scriptpubkey_address) ? BigInt(o.value) : 0n), 0n);
  const sentOut = tx.vout.filter((o) => known(o.scriptpubkey_address) && !mine(o.scriptpubkey_address));
  const paidOut = sentOut.reduce((s, o) => s + BigInt(o.value), 0n);

  let label: string;
  if (spent === 0n) {
    const into = tx.vout.find((o) => mine(o.scriptpubkey_address))?.scriptpubkey_address;
    label = `Received in ${nameOf(into, profile)}`;
  } else {
    const fromPocket = tx.vin.some((i) => i.prevout?.scriptpubkey_address === profile.pocketAddress);
    const external = tx.vout.find((o) => !mine(o.scriptpubkey_address) && known(o.scriptpubkey_address));
    label = external
      ? `To ${nameOf(external.scriptpubkey_address, profile)}`
      : fromPocket
        ? "Moved to your Savings safe"
        : "Spending pocket refilled";
  }

  // What the client paid beyond the amounts sent and kept: the fee, unless Swissquote covered it.
  const clientFee = spent > 0n ? spent - received - paidOut : 0n;
  return {
    txid: tx.txid,
    label,
    amount: received - spent,
    fee: clientFee > 0n ? clientFee : 0n,
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
