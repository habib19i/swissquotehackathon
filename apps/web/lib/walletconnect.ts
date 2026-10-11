/**
 * WalletConnect (Reown WalletKit): websites such as app.aave.com connect to the wallet by QR code or link.
 *
 * - Sessions: Base Sepolia only, for the client's USDC account.
 * - Requests: `eth_sendTransaction` only. Each one becomes an operation signed with the MPC key, after
 *   Swissquote decodes it and checks that it only uses vetted contracts for the client's own safe; the
 *   client confirms it with Face ID. Message signing is refused in this prototype.
 * The website gets the real transaction hash, or an error that says why.
 */
import type { IWalletKit, WalletKitTypes } from "@reown/walletkit";
import { isAddress, isHex, type Hex } from "viem";
import { batchCall } from "@sqw/ethereum";
import type { EthPrepared, EthSent } from "@sqw/shared";
import { cosigner, swissquoteOnline } from "./cosigner";
import type { WalletProfile } from "./profile";
import { withShare } from "./wallet-bitcoin";
import { USDC_OFFLINE, checked, mpcSign, submit, updateCalls, usdcAccount } from "./wallet-usdc";

export const BASE_SEPOLIA = "eip155:84532";
const PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID;

export const walletConnectAvailable = () => Boolean(PROJECT_ID);

let kit: Promise<IWalletKit> | undefined;

/** One WalletKit for the app, created on first use; it restores the connected apps from this browser. */
export function walletKit(): Promise<IWalletKit> {
  if (!PROJECT_ID) return Promise.reject(new Error("WalletConnect is not set up: NEXT_PUBLIC_REOWN_PROJECT_ID is missing."));
  kit ??= (async () => {
    const [{ Core }, { WalletKit }] = await Promise.all([import("@walletconnect/core"), import("@reown/walletkit")]);
    return WalletKit.init({
      core: new Core({ projectId: PROJECT_ID }),
      metadata: {
        name: "Swissquote Wallet (prototype)",
        description: "Self-custody wallet prototype, protected by Swissquote",
        url: window.location.origin,
        icons: [`${window.location.origin}/swissquote-logo.png`],
      },
    });
  })();
  return kit;
}

/** A WalletConnect link (from a QR code, or copied from the website). */
export const isPairingLink = (text: string) => /^wc:[0-9a-f]+@2\?/i.test(text.trim());

export async function pair(uri: string) {
  await (await walletKit()).pair({ uri: uri.trim() });
}

/** Whether the website offers Base Sepolia, the only network this wallet works on. */
export function offersBaseSepolia(proposal: WalletKitTypes.SessionProposal): boolean {
  const { requiredNamespaces, optionalNamespaces } = proposal.params;
  return [requiredNamespaces, optionalNamespaces].some((namespaces) =>
    Object.entries(namespaces ?? {}).some(([key, ns]) => (key === BASE_SEPOLIA ? true : key === "eip155" && ns.chains?.includes(BASE_SEPOLIA))),
  );
}

export async function approveConnection(profile: WalletProfile, proposal: WalletKitTypes.SessionProposal) {
  const [{ buildApprovedNamespaces }, account] = await Promise.all([import("@walletconnect/utils"), usdcAccount(profile)]);
  const namespaces = buildApprovedNamespaces({
    proposal: proposal.params,
    supportedNamespaces: {
      eip155: {
        chains: [BASE_SEPOLIA],
        // Advertised so websites accept the wallet; only eth_sendTransaction is carried out.
        methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"],
        events: ["accountsChanged", "chainChanged"],
        accounts: [`${BASE_SEPOLIA}:${account.address}`],
      },
    },
  });
  await (await walletKit()).approveSession({ id: proposal.id, namespaces });
}

export async function rejectConnection(proposal: WalletKitTypes.SessionProposal) {
  const { getSdkError } = await import("@walletconnect/utils");
  await (await walletKit()).rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
}

export async function connectedApps() {
  return Object.values((await walletKit()).getActiveSessions());
}

export async function disconnect(topic: string) {
  const { getSdkError } = await import("@walletconnect/utils");
  await (await walletKit()).disconnectSession({ topic, reason: getSdkError("USER_DISCONNECTED") });
}

export async function respond(request: WalletKitTypes.SessionRequest, result: { hash: Hex } | { error: string }) {
  await (await walletKit()).respondSessionRequest({
    topic: request.topic,
    response: "hash" in result ? { id: request.id, jsonrpc: "2.0", result: result.hash } : { id: request.id, jsonrpc: "2.0", error: { code: 5000, message: result.error } },
  });
}

// ---------------------------------------------------------------- transactions

/** The transaction a website asked for, checked for shape before anything else. */
export function transactionOf(request: WalletKitTypes.SessionRequest): { to: Hex; data: Hex; value: bigint } {
  const { method, params } = request.params.request;
  if (method !== "eth_sendTransaction") throw new Error("This wallet only carries out transactions for apps, not message signatures.");
  if (request.params.chainId !== BASE_SEPOLIA) throw new Error("This wallet only works on Base Sepolia.");
  const tx = (params as { to?: string; data?: string; input?: string; value?: string }[])[0] ?? {};
  const data = tx.data ?? tx.input ?? "0x";
  if (!tx.to || !isAddress(tx.to) || !isHex(data)) throw new Error("The app sent a transaction this wallet cannot read.");
  return { to: tx.to, data, value: tx.value ? BigInt(tx.value) : 0n };
}

/** Swissquote prepares and checks the website's transaction; the operation is shown before Face ID. */
export async function prepareDappTransaction(profile: WalletProfile, tx: { to: Hex; data: Hex; value: bigint }): Promise<EthPrepared> {
  if (tx.value !== 0n) throw new Error("This wallet does not send ETH directly. In the app, choose WETH instead of ETH.");
  if (!(await swissquoteOnline())) throw new Error(USDC_OFFLINE);
  const record = await usdcAccount(profile);
  const status = await cosigner.ethStatus(profile.walletId);
  const callData = batchCall([...(await updateCalls(profile, record, status)), { target: tx.to, value: 0n, data: tx.data }]);
  return checked(await cosigner.ethPrepare(profile.walletId, { callData, signer: "mpc" }), record.address, callData);
}

/** Face ID unlocks the share; the phone and Swissquote sign; Swissquote's bundler submits it. */
export function sendDappTransaction(profile: WalletProfile, prepared: EthPrepared): Promise<EthSent> {
  return withShare(profile, async (share) => submit(profile, prepared, await mpcSign(profile, share, prepared, true)));
}
