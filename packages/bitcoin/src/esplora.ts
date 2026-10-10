/**
 * Minimal client for an Esplora API (mempool.space signet by default). Works in the browser.
 */
export const DEFAULT_ESPLORA_URL = "https://mempool.space/signet/api";

export interface Utxo {
  txid: string;
  vout: number;
  /** Satoshis. */
  value: number;
  status: { confirmed: boolean };
}

export interface EsploraTx {
  txid: string;
  fee: number;
  status: { confirmed: boolean; block_time?: number };
  vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[];
  vout: { scriptpubkey: string; scriptpubkey_address?: string; value: number }[];
}

export interface Balance {
  /** Confirmed satoshis, ready to spend. */
  confirmed: bigint;
  /** Satoshis still waiting for a block. */
  pending: bigint;
}

export function esplora(baseUrl: string = DEFAULT_ESPLORA_URL) {
  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) throw new Error(`Bitcoin network service answered ${res.status} for ${path}`);
    return res.json() as Promise<T>;
  }

  return {
    utxos: (address: string) => get<Utxo[]>(`/address/${address}/utxo`),

    transactions: (address: string) => get<EsploraTx[]>(`/address/${address}/txs`),

    tx: (txid: string) => get<EsploraTx>(`/tx/${txid}`),

    /**
     * Waits until the index shows a just-broadcast transaction, so the next step (and Swissquote,
     * which reads the same index) sees balances that include it.
     */
    async waitForTx(txid: string, timeoutMs = 15_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ((await fetch(`${baseUrl}/tx/${txid}/status`)).ok) return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      throw new Error("The Bitcoin network has not shown this payment yet. Please try again in a minute.");
    },

    /** Fee rate in sat/vB for confirmation within about half an hour (at least 1). */
    async feeRate(): Promise<number> {
      const { halfHourFee } = await get<{ halfHourFee: number }>("/v1/fees/recommended");
      return Math.max(Math.ceil(halfHourFee), 1);
    },

    /** Broadcasts a raw transaction and returns its txid. Throws with the network's reason if refused. */
    async broadcast(hex: string): Promise<string> {
      const res = await fetch(`${baseUrl}/tx`, { method: "POST", body: hex });
      const body = await res.text();
      if (!res.ok) throw new Error(explainRefusal(body));
      return body.trim();
    },
  };
}

export type Esplora = ReturnType<typeof esplora>;

/** Plain-language reason for a refused broadcast; the network's own text is kept for the record. */
export function explainRefusal(networkReason: string): string {
  if (/too-long-mempool-chain|too many unconfirmed ancestors/.test(networkReason)) {
    return "Some of this bitcoin has only just arrived and the network has not confirmed it yet. Please try again after the next block, in about 10 minutes.";
  }
  if (/insufficient fee|min relay fee/.test(networkReason)) {
    return "The network fee was too low for the network to accept this payment. Please try again.";
  }
  if (/missingorspent|bad-txns-inputs-missingorspent/.test(networkReason)) {
    return "Some of these coins were already spent. Please wait a moment and try again.";
  }
  return `The Bitcoin network refused the payment (${networkReason.trim()}).`;
}

export function balanceOf(utxos: Utxo[]): Balance {
  const sum = (list: Utxo[]) => list.reduce((total, u) => total + BigInt(u.value), 0n);
  return {
    confirmed: sum(utxos.filter((u) => u.status.confirmed)),
    pending: sum(utxos.filter((u) => !u.status.confirmed)),
  };
}
