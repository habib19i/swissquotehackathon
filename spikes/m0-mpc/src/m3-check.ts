/**
 * M3 check against the running services, with Node playing the phone (no passkeys here, so the
 * recovery-key steps are tested in the browser): rulebook changes with delay and cancel, the scam
 * shield on the attacker's CHF 5,000, the face-check attestation, and the Watcher's alerts.
 */
import { randomUUID } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { chfToSats, newPocketKey } from "@sqw/bitcoin";
import {
  KeygenParty,
  PARTY_ID,
  SignParty,
  coordinateKeygen,
  coordinateSign,
  localKeygenParty,
  remoteKeygenParty,
  remoteSigner,
} from "@sqw/mpc";
import { nodeDkls } from "@sqw/mpc/node";
import {
  DEMO_ATTACKER_BTC_ADDRESS,
  rulebookChangeDigest,
  type Alert,
  type PendingChange,
  type RulebookChange,
  type ShieldResult,
} from "@sqw/shared";
import { run } from "./wallet";

const COSIGNER = process.env.COSIGNER_URL ?? "http://localhost:4001";
const RECOVERY = process.env.RECOVERY_URL ?? "http://localhost:4002";

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${json.error}`);
  return json as T;
}

run(async () => {
  const walletId = randomUUID();
  const phone = localKeygenParty(KeygenParty.create(nodeDkls, PARTY_ID.phone));
  const sessionId = randomUUID();
  await coordinateKeygen([
    phone,
    remoteKeygenParty(COSIGNER, PARTY_ID.cosigner, walletId, sessionId),
    remoteKeygenParty(RECOVERY, PARTY_ID["recovery-provider"], walletId, sessionId),
  ]);
  const share = phone.share();
  await call(`${COSIGNER}/wallets`, {
    walletId,
    clientNumber: `CH-TEST-${walletId.slice(0, 4)}`,
    pocketPublicKey: bytesToHex(secp256k1.getPublicKey(newPocketKey(), true)),
    plan: "standard",
  });
  console.log(`1. Safe created and registered: ${walletId}`);

  const requestChange = async (change: RulebookChange) => {
    const nonce = randomUUID();
    const remote = remoteSigner(COSIGNER, PARTY_ID.cosigner, walletId, randomUUID(), { kind: "rulebook-change", change, nonce });
    await coordinateSign(SignParty.create(nodeDkls, share), remote, rulebookChangeDigest(walletId, change, nonce));
    return nonce;
  };

  const thief = { id: "thief", name: "Mr. Smith", btcAddress: DEMO_ATTACKER_BTC_ADDRESS };
  const changeId = await requestChange({ kind: "addContact", contact: thief });
  let changes = await call<PendingChange[]>(`${COSIGNER}/wallets/${walletId}/rulebook/changes`);
  console.log(`2. Attacker adds himself as a contact (MPC-signed): ${changes[0].status} until ${changes[0].effectiveAt}`);

  await call(`${COSIGNER}/wallets/${walletId}/rulebook/changes/${changeId}/cancel`, {});
  changes = await call<PendingChange[]>(`${COSIGNER}/wallets/${walletId}/rulebook/changes`);
  console.log(`3. The real client cancels from another device: ${changes[0].status}`);

  const removeId = await requestChange({ kind: "removeContact", contactId: "sofia" });
  changes = await call<PendingChange[]>(`${COSIGNER}/wallets/${walletId}/rulebook/changes`);
  console.log(`4. Removing a contact is instant: ${changes.find((c) => c.id === removeId)?.status}`);

  const shield = await call<ShieldResult>(`${COSIGNER}/wallets/${walletId}/shield/btc`, {
    to: DEMO_ATTACKER_BTC_ADDRESS,
    amountSats: Number(chfToSats(5_000, 70_000)),
  });
  console.log(`5. Attacker sends CHF 5,000 to himself: ${shield.verdict}. ${shield.reasons[0]}`);

  const noKey = await call(`${RECOVERY}/wallets/${walletId}/recoveries`, {}).catch((err: Error) => err.message);
  console.log(`6. Recovery to the attacker's phone, with no recovery key registered: ${noKey}`);

  const alerts = await call<Alert[]>(`${COSIGNER}/wallets/${walletId}/alerts`);
  console.log(`7. Alerts sent to the client:\n${alerts.map((a) => `   - [${a.type}] ${a.message}`).join("\n")}`);
});
