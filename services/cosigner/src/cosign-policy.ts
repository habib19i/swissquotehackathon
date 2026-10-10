/**
 * What Swissquote agrees to co-sign. Called by the MPC routes before any signing work starts;
 * returns the digest Swissquote computed itself, or refuses with a plain-language reason.
 */
import { hexToBytes } from "@noble/hashes/utils.js";
import { address as btcAddress } from "bitcoinjs-lib";
import { balanceOf, esplora, signet, spendingPocket } from "@sqw/bitcoin";
import { ownershipDigest, ownershipMessage } from "@sqw/bitcoin/ownership";
import { MpcError } from "@sqw/mpc/server";
import type { BtcSpendPurpose, CosignRequest } from "@sqw/shared";
import { reviewBtcSpend, mpcInputDigest, PolicyError, type ReviewContext } from "./bitcoin-policy";
import { btcChf } from "./price";
import type { StoredWallet } from "./wallets";

/** An ownership proof must be signed within this time after Swissquote fixed its date. */
const OWNERSHIP_PROOF_TTL_MS = 10 * 60_000;

export const net = esplora(process.env.BITCOIN_ESPLORA_URL);

/** A coin as recorded on the Bitcoin network; values never come from the app. */
export async function prevoutFromNetwork(txid: string, vout: number) {
  const out = (await net.tx(txid).catch(() => undefined))?.vout[vout];
  if (!out) throw new PolicyError("This payment spends a coin that the Bitcoin network does not know.");
  return { value: BigInt(out.value), script: hexToBytes(out.scriptpubkey) };
}

/** Swissquote's fee wallet, set once the fee service has started (Premium plan). */
let feeWalletAddress: string | undefined;
export const useFeeWallet = (address: string) => {
  feeWalletAddress = address;
};

export async function reviewContext(wallet: StoredWallet): Promise<ReviewContext> {
  return {
    wallet,
    rulebook: wallet.rulebook,
    btcChf: await btcChf(),
    prevout: prevoutFromNetwork,
    feeWalletAddress,
    oldPockets: wallet.oldPocketKeys.map((key) => spendingPocket(hexToBytes(key), hexToBytes(wallet.mpcPublicKey))),
    pocketBalance: async () => {
      const { confirmed, pending } = balanceOf(await net.utxos(wallet.pocketAddress));
      return confirmed + pending;
    },
  };
}

export async function reviewSpend(wallet: StoredWallet, psbt: string, purpose: BtcSpendPurpose) {
  try {
    return await reviewBtcSpend(psbt, purpose, await reviewContext(wallet));
  } catch (err) {
    if (err instanceof PolicyError) throw new MpcError(403, err.message);
    throw err;
  }
}

export function ownershipMessageFor(wallet: StoredWallet): string {
  if (!wallet.ownershipIssuedAt) throw new MpcError(403, "Start the ownership proof first.");
  return ownershipMessage(wallet.clientNumber, wallet.savingsAddress, wallet.ownershipIssuedAt);
}

export async function authorizeCosign(wallet: StoredWallet, request: CosignRequest): Promise<Uint8Array> {
  const mpcKey = hexToBytes(wallet.mpcPublicKey);

  switch (request.kind) {
    case "btc-input": {
      const spend = await reviewSpend(wallet, request.psbt, request.purpose);
      const { verdict, reasons } = spend.review;
      if (verdict === "BLOCKED") throw new MpcError(403, reasons.join(" "));
      if (verdict === "NEEDS_CONFIRMATION" && !request.clientConfirmed) {
        throw new MpcError(403, `Swissquote needs your confirmation first. ${reasons.join(" ")}`);
      }
      return mpcInputDigest(spend, request.inputIndex, mpcKey);
    }

    case "ownership-proof": {
      const message = ownershipMessageFor(wallet);
      if (Date.now() - Date.parse(wallet.ownershipIssuedAt!) > OWNERSHIP_PROOF_TTL_MS) {
        throw new MpcError(403, "This ownership proof has expired. Please start again.");
      }
      return ownershipDigest(message, btcAddress.toOutputScript(wallet.savingsAddress, signet), mpcKey);
    }

    default:
      throw new MpcError(403, "Swissquote does not sign this kind of request.");
  }
}
