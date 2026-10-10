/**
 * MOCK, for the demo only: the client's Swissquote account ("Transfer from my Swissquote account"),
 * backed by Swissquote's hot wallet, and the demo family's wallets, whose test coins it collects so
 * they keep circulating. Family keys are derived from a public label: valueless signet test keys.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { buildSpend, chfToSats, maxSpendable, savingsSafe, savingsSource, type Esplora } from "@sqw/bitcoin";
import { DEMO_CONTACTS, DEMO_FAMILY_KEY_LABEL } from "@sqw/shared";
import { PolicyError } from "./bitcoin-policy";
import type { HotWallet } from "./hot-wallet";
import type { StoredWallet } from "./wallets";

/** Largest single transfer from the mock Swissquote account. */
export const MAX_TRANSFER_CHF = 200;

export function familyKey(contactId: string): Uint8Array {
  return sha256(new TextEncoder().encode(`${DEMO_FAMILY_KEY_LABEL}${contactId}`));
}

export function familyWallet(contactId: string) {
  const secretKey = familyKey(contactId);
  return { secretKey, ...savingsSafe(secp256k1.getPublicKey(secretKey, true)) };
}

export function demoBank(net: Esplora, wallet: HotWallet, reserved: () => Set<string>) {
  return {
    /** Sends test bitcoin from "the client's Swissquote account" to their own registered address. */
    async transfer(client: StoredWallet, amountChf: number, into: "savings" | "pocket", btcChf: number): Promise<string> {
      if (!(amountChf > 0) || amountChf > MAX_TRANSFER_CHF) {
        throw new PolicyError(`Transfers are between CHF 1 and CHF ${MAX_TRANSFER_CHF} in the demo.`);
      }
      const to = into === "savings" ? client.savingsAddress : client.pocketAddress;
      try {
        return await wallet.send(to, chfToSats(amountChf, btcChf), reserved());
      } catch (err) {
        throw new PolicyError(`The demo Swissquote account could not send this: ${(err as Error).message}`);
      }
    },

    /** Collects what the demo family received back into Swissquote's hot wallet (confirmed coins only). */
    async collectFamily(): Promise<string[]> {
      const txids: string[] = [];
      for (const contact of DEMO_CONTACTS) {
        const family = familyWallet(contact.id);
        const coins = (await net.utxos(family.address)).filter((u) => u.status.confirmed);
        const feeRate = await net.feeRate();
        const amount = maxSpendable(savingsSource(family), coins, feeRate);
        if (amount === 0n) continue;
        const spend = buildSpend({ source: savingsSource(family), utxos: coins, to: wallet.address, amount, feeRate });
        spend.psbt.signAllInputs({
          publicKey: secp256k1.getPublicKey(family.secretKey, true),
          sign: (hash) => secp256k1.sign(hash, family.secretKey, { prehash: false }),
        });
        spend.psbt.finalizeAllInputs();
        const txid = await net.broadcast(spend.psbt.extractTransaction().toHex());
        wallet.recordOwn(txid);
        txids.push(txid);
      }
      return txids;
    },
  };
}
