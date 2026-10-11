/**
 * DeFi apps check against the running services and Base Sepolia, with Node playing the phone (a software
 * P-256 key stands in for Face ID): Uniswap with Swissquote's check, approving apps in the rules, then
 * Uniswap and Aave with Face ID alone. Every operation is real, with its explorer link.
 */
import { randomUUID } from "node:crypto";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { hexToBytes, maxUint256, type Hex } from "viem";
import { newPocketKey } from "@sqw/bitcoin";
import {
  DEPLOYMENTS,
  USDC,
  appParams,
  baseClient,
  batchCall,
  defiPositions,
  formatEth,
  formatUsdc,
  minimumOut,
  mpcSignature,
  passkeySignature,
  pendingSync,
  quoteSwap,
  selfCall,
  useAppCall,
  userOpFromJson,
  userOpHash,
  userOpToJson,
  type AppRequest,
} from "@sqw/ethereum";
import { KeygenParty, PARTY_ID, SignParty, coordinateKeygen, coordinateSign, ethereumSignature, localKeygenParty, remoteKeygenParty, remoteSigner } from "@sqw/mpc";
import { nodeDkls } from "@sqw/mpc/node";
import { LOOSENING_DELAY_SECONDS, explorer, rulebookChangeDigest, type EthAccountRecord, type EthPrepared, type EthSent, type EthStatus, type RulebookChange } from "@sqw/shared";
import { run } from "./wallet";

const COSIGNER = process.env.COSIGNER_URL ?? "http://localhost:4001";
const RECOVERY = process.env.RECOVERY_URL ?? "http://localhost:4002";

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${json.error}`);
  return json as T;
}

function softwarePasskey() {
  const secretKey = p256.utils.randomSecretKey();
  const spki = `3059301306072a8648ce3d020106082a8648ce3d030107034200${bytesToHex(p256.getPublicKey(secretKey, false))}`;
  const sign = (challenge: Hex) => {
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: Buffer.from(hexToBytes(challenge)).toString("base64url"), origin: "http://localhost:3000" }));
    const authenticatorData = new Uint8Array([...sha256(new TextEncoder().encode("localhost")), 0x05, 0, 0, 0, 1]);
    const digest = sha256(new Uint8Array([...authenticatorData, ...sha256(clientDataJSON)]));
    return passkeySignature({ authenticatorData, clientDataJSON, signature: p256.sign(digest, secretKey, { prehash: false, lowS: false, format: "der" }) });
  };
  return { spki, sign };
}

run(async () => {
  const client = baseClient(process.env.BASE_SEPOLIA_RPC_URL);
  const walletId = randomUUID();
  const sessionId = randomUUID();
  const phone = localKeygenParty(KeygenParty.create(nodeDkls, PARTY_ID.phone));
  const mpcPublicKey = await coordinateKeygen([
    phone,
    remoteKeygenParty(COSIGNER, PARTY_ID.cosigner, walletId, sessionId),
    remoteKeygenParty(RECOVERY, PARTY_ID["recovery-provider"], walletId, sessionId),
  ]);
  const share = phone.share();
  await call(`${COSIGNER}/wallets`, { walletId, clientNumber: `CH-TEST-${walletId.slice(0, 4)}`, pocketPublicKey: bytesToHex(secp256k1.getPublicKey(newPocketKey(), true)), plan: "premium" });
  const wallet = (path: string) => `${COSIGNER}/wallets/${walletId}${path}`;
  const passkey = softwarePasskey();
  const record = await call<EthAccountRecord>(wallet("/ethereum"), { passkeySpki: passkey.spki });
  if (record.factory !== DEPLOYMENTS.factory) throw new Error("New safes should use the account version with apps");
  const account = record.address;

  const transfer = await call<{ txHash: string }>(wallet("/demo/transfer"), { asset: "USDC", amountChf: 0.6 });
  await client.waitForTransactionReceipt({ hash: transfer.txHash as Hex });
  console.log(`1. New safe ${account}, funded with test USDC: ${explorer.baseTx(transfer.txHash)}`);

  const mpcSign = async (userOp: Record<string, string>, clientConfirmed = false) => {
    const op = userOpFromJson(userOp);
    const digest = hexToBytes(userOpHash(op));
    const remote = remoteSigner(COSIGNER, PARTY_ID.cosigner, walletId, randomUUID(), { kind: "eth-userop", userOp, clientConfirmed });
    const { r, s } = await coordinateSign(SignParty.create(nodeDkls, share), remote, digest);
    return userOpToJson({ ...op, signature: mpcSignature(ethereumSignature(r, s, digest, hexToBytes(`0x${mpcPublicKey}`))) });
  };
  const send = async (userOp: Record<string, string>) => {
    const sent = await call<EthSent>(wallet("/ethereum/ops/send"), { userOp });
    if (!sent.success) throw new Error(`Not carried out: ${sent.reason} ${explorer.baseTx(sent.txHash)}`);
    return sent;
  };
  const swapRequest = async (amountIn: bigint): Promise<AppRequest> => ({
    app: "uniswap",
    tokenIn: USDC.address,
    amountIn,
    minOut: minimumOut(await quoteSwap(client, USDC.address, amountIn)),
  });

  // 2. Uniswap before approval: the MPC key, after Swissquote explains it and the client confirms.
  const checked = await call<EthPrepared>(wallet("/ethereum/ops/prepare"), {
    callData: useAppCall(DEPLOYMENTS.adapters.uniswap, appParams(await swapRequest(250_000n)), true),
    signer: "mpc",
  });
  console.log(`2. Swissquote's check: ${checked.review?.verdict}. "${checked.review?.reasons.join(" ")}"`);
  const swapped = await send(await mpcSign(checked.userOp, true));
  console.log(`   Exchanged ${formatUsdc(250_000n)} on Uniswap, co-signed: ${explorer.baseTx(swapped.txHash)}`);

  // 3. Approve Uniswap and Aave in the rules (loosening: waiting period), then write them on-chain.
  const requestChange = async (change: RulebookChange) => {
    const nonce = randomUUID();
    const remote = remoteSigner(COSIGNER, PARTY_ID.cosigner, walletId, randomUUID(), { kind: "rulebook-change", change, nonce });
    await coordinateSign(SignParty.create(nodeDkls, share), remote, rulebookChangeDigest(walletId, change, nonce));
  };
  await requestChange({ kind: "addApp", appId: "uniswap" });
  await requestChange({ kind: "addApp", appId: "aave" });
  console.log(`3. Uniswap and Aave approved in the rules; waiting ${LOOSENING_DELAY_SECONDS + 2} s (demo waiting period)…`);
  await new Promise((resolve) => setTimeout(resolve, (LOOSENING_DELAY_SECONDS + 2) * 1000));
  const status = await call<EthStatus>(wallet("/ethereum/status"));
  const sync = pendingSync(status);
  const syncOp = await call<EthPrepared>(wallet("/ethereum/ops/prepare"), { callData: batchCall(sync.map((a) => selfCall(account, a))), signer: "mpc" });
  const synced = await send(await mpcSign(syncOp.userOp));
  console.log(`   Written on Base (${sync.map((a) => a.kind).join(", ")}): ${explorer.baseTx(synced.txHash)}`);

  // 4. Face ID alone: Uniswap, then Aave deposit and withdrawal.
  const faceId = async (request: AppRequest, label: string) => {
    const prepared = await call<EthPrepared>(wallet("/ethereum/ops/prepare"), {
      callData: useAppCall(DEPLOYMENTS.adapters[request.app], appParams(request), false),
      signer: "passkey",
    });
    const sent = await send({ ...prepared.userOp, signature: passkey.sign(prepared.userOpHash) });
    console.log(`   ${label}, Face ID alone: ${explorer.baseTx(sent.txHash)}`);
  };
  console.log("4. With Face ID alone:");
  await faceId(await swapRequest(250_000n), `Exchanged ${formatUsdc(250_000n)} for ETH on Uniswap`);
  const { eth } = await defiPositions(client, account);
  await faceId({ app: "aave", action: "supply", amount: eth }, `Deposited ${formatEth(eth)} in Aave`);
  const inAave = await defiPositions(client, account);
  console.log(`   In Aave: ${formatEth(inAave.ethInAave)}; app limit left today: ${formatUsdc(BigInt((await call<EthStatus>(wallet("/ethereum/status"))).onChain.remainingAppToday))}`);
  await faceId({ app: "aave", action: "withdraw", amount: maxUint256 }, "Took everything back from Aave");
  const after = await defiPositions(client, account);
  console.log(`5. Back in the safe: ${formatEth(after.eth)}, in Aave: ${formatEth(after.ethInAave)}`);
});
