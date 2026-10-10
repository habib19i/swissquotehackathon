/**
 * M4 check against the running services and Base Sepolia. Node plays the phone; a software P-256 key
 * stands in for the Face ID passkey and produces the same WebAuthn assertion format (the browser uses
 * the real passkey). Every operation is real, on Base Sepolia, with its explorer link.
 */
import { randomUUID } from "node:crypto";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { hexToBytes, type Hex } from "viem";
import { newPocketKey } from "@sqw/bitcoin";
import {
  accountAddress,
  baseClient,
  batchCall,
  ethOwnershipDigest,
  ethOwnershipMessage,
  ethOwnershipProof,
  formatUsdc,
  isDeployed,
  mpcSignature,
  mpcSignerAddress,
  passkeySignature,
  payContactCall,
  pendingSync,
  rulesTarget,
  selfCall,
  usdcBalance,
  usdcTransfer,
  userOpFromJson,
  userOpHash,
  userOpToJson,
  type AccountSettings,
} from "@sqw/ethereum";
import {
  KeygenParty,
  PARTY_ID,
  SignParty,
  coordinateKeygen,
  coordinateSign,
  ethereumSignature,
  localKeygenParty,
  remoteKeygenParty,
  remoteSigner,
} from "@sqw/mpc";
import { nodeDkls } from "@sqw/mpc/node";
import {
  DEMO_ATTACKER_ETH_ADDRESS,
  DEMO_CONTACTS,
  contactProof,
  explorer,
  rulebookChangeDigest,
  type EthAccountRecord,
  type EthFeeQuote,
  type EthPrepared,
  type EthSent,
  type EthStatus,
  type Rulebook,
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

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("Expected a refusal");
    },
    (err: Error) => err.message,
  );

/** A software passkey: the WebAuthn assertion a browser returns, over `challenge`. */
function softwarePasskey() {
  const secretKey = p256.utils.randomSecretKey();
  const spki = `3059301306072a8648ce3d020106082a8648ce3d030107034200${bytesToHex(p256.getPublicKey(secretKey, false))}`;
  const sign = (challenge: Hex) => {
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({ type: "webauthn.get", challenge: Buffer.from(hexToBytes(challenge)).toString("base64url"), origin: "http://localhost:3000" }),
    );
    const authenticatorData = new Uint8Array([...sha256(new TextEncoder().encode("localhost")), 0x05, 0, 0, 0, 1]);
    const digest = sha256(new Uint8Array([...authenticatorData, ...sha256(clientDataJSON)]));
    const signature = p256.sign(digest, secretKey, { prehash: false, lowS: false, format: "der" });
    return passkeySignature({ authenticatorData, clientDataJSON, signature });
  };
  return { spki, sign };
}

run(async () => {
  const client = baseClient(process.env.BASE_SEPOLIA_RPC_URL);

  // 1. A safe, as in M1-M3: networked 2-of-3 keygen, registered with Swissquote (Premium plan).
  const walletId = randomUUID();
  const sessionId = randomUUID();
  const phone = localKeygenParty(KeygenParty.create(nodeDkls, PARTY_ID.phone));
  const mpcPublicKey = await coordinateKeygen([
    phone,
    remoteKeygenParty(COSIGNER, PARTY_ID.cosigner, walletId, sessionId),
    remoteKeygenParty(RECOVERY, PARTY_ID["recovery-provider"], walletId, sessionId),
  ]);
  const share = phone.share();
  await call(`${COSIGNER}/wallets`, {
    walletId,
    clientNumber: `CH-TEST-${walletId.slice(0, 4)}`,
    pocketPublicKey: bytesToHex(secp256k1.getPublicKey(newPocketKey(), true)),
    plan: "premium",
  });
  const wallet = (path: string) => `${COSIGNER}/wallets/${walletId}${path}`;

  // 2. The USDC account: Swissquote computes the address; the phone checks it independently.
  const passkey = softwarePasskey();
  const record = await call<EthAccountRecord>(wallet("/ethereum"), { passkeySpki: passkey.spki });
  const settings: AccountSettings = { ...record.settings, dailyLimit: BigInt(record.settings.dailyLimit) };
  if (settings.mpcSigner !== mpcSignerAddress(mpcPublicKey)) throw new Error("Wrong MPC signer");
  if ((await accountAddress(client, settings)) !== record.address) throw new Error("Address mismatch");
  console.log(`1. USDC account ${record.address} (not deployed yet), daily limit ${formatUsdc(settings.dailyLimit)}`);

  const mpcSign = async (userOp: Record<string, string>, clientConfirmed = false) => {
    const op = userOpFromJson(userOp);
    const digest = hexToBytes(userOpHash(op));
    const remote = remoteSigner(COSIGNER, PARTY_ID.cosigner, walletId, randomUUID(), { kind: "eth-userop", userOp, clientConfirmed });
    const { r, s } = await coordinateSign(SignParty.create(nodeDkls, share), remote, digest);
    return userOpToJson({ ...op, signature: mpcSignature(ethereumSignature(r, s, digest, hexToBytes(`0x${mpcPublicKey}`))) });
  };
  /** Ownership proof (Travel Rule): ERC-6492 before the account exists, ERC-1271 after. */
  const proveOwnership = async () => {
    const { issuedAt } = await call<{ issuedAt: string }>(wallet("/ethereum/ownership/challenge"), {});
    const digest = hexToBytes(ethOwnershipDigest(ethOwnershipMessage(`CH-TEST-${walletId.slice(0, 4)}`, record.address, issuedAt)));
    const remote = remoteSigner(COSIGNER, PARTY_ID.cosigner, walletId, randomUUID(), { kind: "eth-ownership-proof" });
    const { r, s } = await coordinateSign(SignParty.create(nodeDkls, share), remote, digest);
    const signature = mpcSignature(ethereumSignature(r, s, digest, hexToBytes(`0x${mpcPublicKey}`)));
    const deployed = await isDeployed(client, record.address);
    const verified = await call<EthAccountRecord>(wallet("/ethereum/ownership/proof"), { signature: ethOwnershipProof(signature, deployed, settings) });
    return `${verified.ownershipVerifiedAt ? "verified" : "NOT verified"} by Swissquote (${deployed ? "ERC-1271" : "ERC-6492, account not deployed yet"})`;
  };
  console.log(`   Ownership proof ${await proveOwnership()}`);

  const send = async (userOp: Record<string, string>) => {
    const sent = await call<EthSent>(wallet("/ethereum/ops/send"), { userOp });
    if (!sent.success) throw new Error(`Not carried out: ${sent.reason} ${explorer.baseTx(sent.txHash)}`);
    return sent;
  };

  // 3. A daily payment with Face ID alone: approved contact, within the limit. Deploys the account.
  const rulebook = await call<Rulebook>(wallet("/rulebook"));
  const leo = DEMO_CONTACTS[0].ethAddress!;
  const balance = await usdcBalance(client, record.address);
  const amount = balance >= 1_000_000n ? 1_000_000n : 0n;
  const fee = await call<EthFeeQuote>(wallet("/ethereum/fee"));
  const pay = payContactCall(leo, amount, contactProof(rulebook.contacts, leo), BigInt(fee.feeUsdc));
  const prepared = await call<EthPrepared>(wallet("/ethereum/ops/prepare"), { callData: pay, signer: "passkey" });
  if (prepared.userOpHash !== userOpHash(userOpFromJson(prepared.userOp))) throw new Error("Hash mismatch");
  const paid = await send({ ...prepared.userOp, signature: passkey.sign(prepared.userOpHash) });
  console.log(`2. Face ID payment of ${formatUsdc(amount)} to Léo (fee paid by ${fee.paidBy}): ${explorer.baseTx(paid.txHash)}`);
  console.log(`   Ownership proof ${await proveOwnership()}`);

  // 4. A tightening change (remove Sofia) applies at once at Swissquote, then on-chain via the MPC key.
  const requestChange = async (change: RulebookChange) => {
    const nonce = randomUUID();
    const remote = remoteSigner(COSIGNER, PARTY_ID.cosigner, walletId, randomUUID(), { kind: "rulebook-change", change, nonce });
    await coordinateSign(SignParty.create(nodeDkls, share), remote, rulebookChangeDigest(walletId, change, nonce));
  };
  await requestChange({ kind: "removeContact", contactId: "sofia" });
  let status = await call<EthStatus>(wallet("/ethereum/status"));
  const sync = pendingSync(status);
  console.log(`3. Sofia removed at Swissquote; rules on Base up to date: ${status.rulesUpToDate} (${sync.map((a) => a.kind).join(", ")})`);

  const syncOp = await call<EthPrepared>(wallet("/ethereum/ops/prepare"), {
    callData: batchCall(sync.map((a) => selfCall(record.address, a))),
    signer: "mpc",
  });
  const synced = await send(await mpcSign(syncOp.userOp));
  status = await call<EthStatus>(wallet("/ethereum/status"));
  console.log(`4. New rules written on Base with the MPC key: up to date ${status.rulesUpToDate}: ${explorer.baseTx(synced.txHash)}`);

  // 5. Face ID alone can no longer pay Sofia: the account itself refuses.
  const sofia = DEMO_CONTACTS.find((c) => c.id === "sofia")!.ethAddress!;
  const oldProof = contactProof(rulebook.contacts, sofia);
  const refused = await refusal(call(wallet("/ethereum/ops/prepare"), { callData: payContactCall(sofia, 0n, oldProof, 0n), signer: "passkey" }));
  console.log(`5. Face ID payment to removed Sofia refused: "${refused}"`);

  // 6. Attacker mode: CHF 5,000 in USDC to the thief. The scam shield blocks it; Swissquote will not sponsor or sign.
  const shield = await call<ShieldResult>(wallet("/shield/usdc"), { to: DEMO_ATTACKER_ETH_ADDRESS, amount: String(6_250_000_000n) });
  const theft = batchCall([usdcTransfer(DEMO_ATTACKER_ETH_ADDRESS, 6_250_000_000n)]);
  const blocked = await refusal(call(wallet("/ethereum/ops/prepare"), { callData: theft, signer: "mpc" }));
  console.log(`6. Attacker's USDC 6,250 to himself: ${shield.verdict}. "${blocked}"`);

  // 7. Attacker adds himself (loosening, waiting period): Swissquote refuses to write that root on-chain early.
  const thief = { id: "thief", name: "Mr. Smith", ethAddress: DEMO_ATTACKER_ETH_ADDRESS };
  await requestChange({ kind: "addContact", contact: thief });
  const withThief = rulesTarget({ ...rulebook, contacts: [...rulebook.contacts.filter((c) => c.id !== "sofia"), thief] }, status.usdcChf);
  const early = batchCall([selfCall(record.address, { kind: "setRulebook", root: withThief.contactsRoot, limit: withThief.dailyLimit })]);
  const earlyOp = await refusal(call(wallet("/ethereum/ops/prepare"), { callData: early, signer: "mpc" }));
  console.log(`7. Writing the thief into the rules during the waiting period: refused. "${earlyOp}"`);
});
