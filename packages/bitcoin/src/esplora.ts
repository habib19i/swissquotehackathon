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
  vout: { scriptpubkey_address?: string; value: number }[];
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

    /** Fee rate in sat/vB for confirmation within about half an hour (at least 1). */
    async feeRate(): Promise<number> {
      const { halfHourFee } = await get<{ halfHourFee: number }>("/v1/fees/recommended");
      return Math.max(Math.ceil(halfHourFee), 1);
    },

    /** Broadcasts a raw transaction and returns its txid. Throws with the network's reason if refused. */
    async broadcast(hex: string): Promise<string> {
      const res = await fetch(`${baseUrl}/tx`, { method: "POST", body: hex });
      const body = await res.text();
      if (!res.ok) throw new Error(`The Bitcoin network refused the payment: ${body}`);
      return body.trim();
    },
  };
}

export type Esplora = ReturnType<typeof esplora>;

export function balanceOf(utxos: Utxo[]): Balance {
  const sum = (list: Utxo[]) => list.reduce((total, u) => total + BigInt(u.value), 0n);
  return {
    confirmed: sum(utxos.filter((u) => u.status.confirmed)),
    pending: sum(utxos.filter((u) => !u.status.confirmed)),
  };
}
