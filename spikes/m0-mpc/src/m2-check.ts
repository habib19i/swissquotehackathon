/**
 * M2 check against the running services, with Node playing the phone: create a key, register the
 * safe with Swissquote, prove ownership (BIP-322, phone + Swissquote), and check that Swissquote
 * refuses to co-sign coins it cannot find on the network.
 */
import { randomUUID } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { buildSavingsPayment, newPocketKey, savingsSafe, signAllInputs } from "@sqw/bitcoin";
import { encodeOwnershipProof, ownershipMessage, ownershipToSign } from "@sqw/bitcoin/ownership";
import {
  KeygenParty,
  PARTY_ID,
  SignParty,
  bitcoinCompact,
  coordinateKeygen,
  coordinateSign,
  localKeygenParty,
  remoteKeygenParty,
  remoteSigner,
  verifyDigest,
} from "@sqw/mpc";
import { nodeDkls } from "@sqw/mpc/node";
import type { WalletRecord } from "@sqw/shared";
import { run } from "./wallet";

const COSIGNER = process.env.COSIGNER_URL ?? "http://localhost:4001";
const RECOVERY = process.env.RECOVERY_URL ?? "http://localhost:4002";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${COSIGNER}${path}`, {
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
  const mpcPublicKey = await coordinateKeygen([
    phone,
    remoteKeygenParty(COSIGNER, PARTY_ID.cosigner, walletId, sessionId),
    remoteKeygenParty(RECOVERY, PARTY_ID["recovery-provider"], walletId, sessionId),
  ]);
  const share = phone.share();
  console.log(`1. Key created: ${mpcPublicKey}`);

  const pocketPublicKey = bytesToHex(secp256k1.getPublicKey(newPocketKey(), true));
  const record = await call<WalletRecord>("/wallets", { walletId, clientNumber: "CH-4417-2093", pocketPublicKey, plan: "standard" });
  console.log(`2. Registered. Savings safe ${record.savingsAddress}`);

  const cosign = (request: unknown) => (inputIndex: number) => ({
    publicKey: share.publicKey,
    sign: async (hash: Uint8Array) => {
      const remote = remoteSigner(COSIGNER, PARTY_ID.cosigner, walletId, randomUUID(), request);
      const { r, s } = await coordinateSign(SignParty.create(nodeDkls, share), remote, hash);
      return bitcoinCompact(r, s);
    },
  });

  const { issuedAt } = await call<{ issuedAt: string }>(`/wallets/${walletId}/ownership/challenge`, {});
  const safe = savingsSafe(share.publicKey);
  const toSign = ownershipToSign(ownershipMessage("CH-4417-2093", safe.address, issuedAt), safe.output);
  await signAllInputs(toSign, cosign({ kind: "ownership-proof" }), (pk, h, sig) => verifyDigest(sig, h, pk));
  const verified = await call<WalletRecord>(`/wallets/${walletId}/ownership/proof`, { signature: encodeOwnershipProof(toSign) });
  console.log(`3. Ownership verified by Swissquote at ${verified.ownershipVerifiedAt}`);

  const fake = buildSavingsPayment({
    safe,
    utxos: [{ txid: "ab".repeat(32), vout: 0, value: 500_000, status: { confirmed: true } }],
    to: "tb1qlq2jjz3690pnygrytqptyy4rhterj4rswsw8pd",
    amount: 100_000n,
    feeRate: 1,
  });
  const refused = await call(`/wallets/${walletId}/btc/review`, { psbt: fake.psbt.toBase64(), purpose: "savings-payment" }).catch(
    (err: Error) => err.message,
  );
  console.log(`4. Spending coins that do not exist: ${refused}`);
});
