/**
 * The activity feed: every transaction touching the client's safe, on both networks, in plain language.
 * Bitcoin from the signet explorer's API (esplora), USDC from Blockscout's API for Base Sepolia.
 */
import { esplora, type EsploraTx } from "@sqw/bitcoin";
import { DEPLOYMENTS, USDC } from "@sqw/ethereum";
import { explorer, type Contact } from "@sqw/shared";
import type { WalletProfile } from "./profile";
import { loadRulebook } from "./rules";
import { BLOCKSCOUT_URL, ESPLORA_URL } from "./services";
import { usdcAccount } from "./wallet-usdc";

const net = esplora(ESPLORA_URL);

export interface ActivityItem {
  id: string;
  asset: "BTC" | "USDC";
  /** Plain-language description, e.g. "To Léo" or "Received in your Spending pocket". */
  label: string;
  /** Net effect on the client's safe, in satoshis or USDC units (negative when money left it). */
  amount: bigint;
  /** What the client paid for the network fee (zero when Swissquote paid on the Premium plan). */
  fee: bigint;
  confirmed: boolean;
  time?: Date;
  link: string;
}

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Uniswap's USDC/ETH pool (0.3%) on Base Sepolia: where exchanges send and take USDC. */
const UNISWAP_POOL = "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad";

// ---------------------------------------------------------------- bitcoin

function describeBtc(tx: EsploraTx, profile: WalletProfile, contacts: Contact[]): ActivityItem {
  const mine = (a?: string) => a === profile.pocketAddress || a === profile.savingsAddress;
  const contact = (a?: string) => contacts.find((c) => c.btcAddress === a);
  const nameOf = (a?: string) =>
    a === profile.pocketAddress ? "your Spending pocket" : a === profile.savingsAddress ? "your Savings safe" : contact(a)?.name;
  const spent = tx.vin.reduce((s, i) => s + (i.prevout && mine(i.prevout.scriptpubkey_address) ? BigInt(i.prevout.value) : 0n), 0n);
  const received = tx.vout.reduce((s, o) => s + (mine(o.scriptpubkey_address) ? BigInt(o.value) : 0n), 0n);
  const paidOut = tx.vout.filter((o) => contact(o.scriptpubkey_address)).reduce((s, o) => s + BigInt(o.value), 0n);

  let label: string;
  if (spent === 0n) {
    label = `Received in ${nameOf(tx.vout.find((o) => mine(o.scriptpubkey_address))?.scriptpubkey_address)}`;
  } else {
    const fromPocket = tx.vin.some((i) => i.prevout?.scriptpubkey_address === profile.pocketAddress);
    const external = tx.vout.find((o) => contact(o.scriptpubkey_address));
    label = external ? `To ${nameOf(external.scriptpubkey_address)}` : fromPocket ? "Moved to your Savings safe" : "Spending pocket refilled";
  }

  // What the client paid beyond the amounts sent and kept: the fee, unless Swissquote covered it.
  const clientFee = spent > 0n ? spent - received - paidOut : 0n;
  return {
    id: tx.txid,
    asset: "BTC",
    label,
    amount: received - spent,
    fee: clientFee > 0n ? clientFee : 0n,
    confirmed: tx.status.confirmed,
    time: tx.status.block_time ? new Date(tx.status.block_time * 1000) : undefined,
    link: explorer.btcTx(tx.txid),
  };
}

async function btcActivity(profile: WalletProfile, contacts: Contact[]): Promise<ActivityItem[]> {
  const lists = await Promise.all([net.transactions(profile.pocketAddress), net.transactions(profile.savingsAddress)]);
  const byId = new Map(lists.flat().map((tx) => [tx.txid, tx]));
  return [...byId.values()].map((tx) => describeBtc(tx, profile, contacts));
}

// ---------------------------------------------------------------- USDC

interface TokenTransfer {
  transaction_hash: string;
  timestamp: string;
  from: { hash: string };
  to: { hash: string };
  total: { value: string };
  token: { address_hash: string };
}

async function usdcActivity(profile: WalletProfile, contacts: Contact[]): Promise<ActivityItem[]> {
  const account = (await usdcAccount(profile)).address;
  const res = await fetch(`${BLOCKSCOUT_URL}/api/v2/addresses/${account}/token-transfers?type=ERC-20&token=${USDC.address}`);
  if (!res.ok) throw new Error(`Blockscout answered ${res.status}`);
  const { items } = (await res.json()) as { items: TokenTransfer[] };

  const byTx = new Map<string, TokenTransfer[]>();
  for (const t of items.filter((t) => same(t.token.address_hash, USDC.address))) {
    byTx.set(t.transaction_hash, [...(byTx.get(t.transaction_hash) ?? []), t]);
  }
  return [...byTx.entries()].map(([hash, transfers]) => {
    const value = (t: TokenTransfer) => BigInt(t.total.value);
    const incoming = transfers.filter((t) => same(t.to.hash, account));
    const fee = transfers.filter((t) => same(t.from.hash, account) && same(t.to.hash, DEPLOYMENTS.swissquote));
    const paid = transfers.filter((t) => same(t.from.hash, account) && !fee.includes(t));
    const received = incoming.reduce((s, t) => s + value(t), 0n);
    const sent = paid.reduce((s, t) => s + value(t), 0n);
    const feePaid = fee.reduce((s, t) => s + value(t), 0n);

    const to = paid[0] && contacts.find((c) => same(c.ethAddress, paid[0].to.hash));
    const from = incoming[0]?.from.hash;
    const exchanged = transfers.some((t) => same(t.from.hash, UNISWAP_POOL) || same(t.to.hash, UNISWAP_POOL));
    const label = exchanged
      ? "Exchanged on Uniswap"
      : paid.length
      ? `To ${to?.name ?? "someone outside your contacts"}`
      : same(from, DEPLOYMENTS.swissquote)
        ? "From your Swissquote account"
        : "Received in your USDC";
    return {
      id: hash,
      asset: "USDC" as const,
      label,
      amount: received - sent - feePaid,
      fee: feePaid,
      confirmed: true,
      time: new Date(transfers[0].timestamp),
      link: explorer.baseTx(hash),
    };
  });
}

/** Both networks, newest first. A network that cannot be reached is reported, not hidden. */
export async function loadActivity(profile: WalletProfile): Promise<{ items: ActivityItem[]; unavailable: string[] }> {
  const { contacts } = await loadRulebook(profile.walletId);
  const [btc, usdc] = await Promise.allSettled([btcActivity(profile, contacts), usdcActivity(profile, contacts)]);
  const unavailable = [btc.status === "rejected" && "Bitcoin", usdc.status === "rejected" && "USDC"].filter(Boolean) as string[];
  const items = [...(btc.status === "fulfilled" ? btc.value : []), ...(usdc.status === "fulfilled" ? usdc.value : [])];
  return {
    items: items.sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0)),
    unavailable,
  };
}
