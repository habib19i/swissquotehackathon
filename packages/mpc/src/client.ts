/**
 * The phone's view of a remote key-share holder: a PartyHandle that calls the service's /mpc routes.
 */
import type { PartyHandle, RemoteSigner } from "./coordinator";
import { KeygenParty, type RoundInput, type RoundOutput } from "./keygen";
import type { DklsKeyshare } from "./lib";
import type { WireMessage } from "./wire";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${url} answered ${res.status}`);
  return json as T;
}

export function remoteKeygenParty(baseUrl: string, partyId: number, walletId: string, sessionId: string): PartyHandle {
  return {
    partyId,
    start: async () =>
      (await post<{ messages: WireMessage[] }>(`${baseUrl}/mpc/keygen`, { walletId, sessionId })).messages,
    round: (n: number, input: RoundInput) =>
      post<RoundOutput>(`${baseUrl}/mpc/keygen/${sessionId}/rounds/${n}`, input),
  };
}

/**
 * A remote holder taking part in lost-share recovery. `request` is the holder's evidence that the
 * recovery is legitimate (e.g. a recovery id); the holder checks it before joining.
 */
export function remoteRecoveryParty(
  baseUrl: string,
  partyId: number,
  walletId: string,
  sessionId: string,
  lostPartyId: number,
  request: unknown,
): PartyHandle {
  return {
    partyId,
    start: async () =>
      (await post<{ messages: WireMessage[] }>(`${baseUrl}/mpc/recover`, { walletId, sessionId, lostPartyId, request })).messages,
    round: (n: number, input: RoundInput) => post<RoundOutput>(`${baseUrl}/mpc/keygen/${sessionId}/rounds/${n}`, input),
  };
}

/**
 * A remote holder asked to co-sign. `request` tells it what is being signed (e.g. a PSBT input);
 * the holder checks it against its own rules and computes the digest itself.
 */
export function remoteSigner(
  baseUrl: string,
  partyId: number,
  walletId: string,
  sessionId: string,
  request: unknown,
): RemoteSigner {
  const roundUrl = (n: number) => `${baseUrl}/mpc/sign/${sessionId}/rounds/${n}`;
  return {
    partyId,
    start: () => post(`${baseUrl}/mpc/sign`, { walletId, sessionId, request }),
    round: async (n, messages) => (await post<{ messages: WireMessage[] }>(roundUrl(n), { messages })).messages,
    finish: async (messages) => (await post<{ messages: WireMessage[] }>(roundUrl(4), { messages })).messages,
  };
}

/** Wraps a party running on this device; `share()` gives its key share once the session is done. */
export function localKeygenParty(party: KeygenParty): PartyHandle & { share(): DklsKeyshare } {
  return {
    partyId: party.partyId,
    start: async () => party.start(),
    round: async (n: number, input: RoundInput) => party.round(n, input),
    share: () => party.result(),
  };
}
