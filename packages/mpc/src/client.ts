/**
 * The phone's view of a remote key-share holder: a PartyHandle that calls the service's /mpc routes.
 */
import type { PartyHandle } from "./coordinator";
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

/** Wraps a party running on this device; `share()` gives its key share once the session is done. */
export function localKeygenParty(party: KeygenParty): PartyHandle & { share(): DklsKeyshare } {
  return {
    partyId: party.partyId,
    start: async () => party.start(),
    round: async (n: number, input: RoundInput) => party.round(n, input),
    share: () => party.result(),
  };
}
