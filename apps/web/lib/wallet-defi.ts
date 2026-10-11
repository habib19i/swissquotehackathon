/**
 * DeFi apps from the wallet (Explore): exchange on Uniswap, earn on Aave, on Base Sepolia.
 *
 * - An app the client approved: Face ID alone (the passkey signs `useApp`); the account checks on-chain
 *   that the app is approved and that the apps' own daily limit holds.
 * - Any other vetted app: the MPC key (`useAppChecked`), after Swissquote explains the operation.
 * Either way, Swissquote-vetted adapters send everything back to the client's own account.
 */
import { hexToBytes, isAddressEqual, type Address } from "viem";
import {
  USDC,
  adapterOf,
  appParams,
  batchCall,
  defiPositions,
  passkeySignature,
  supportsApps,
  useAppCall,
  type AppRequest,
} from "@sqw/ethereum";
import type { EthPrepared, EthSent, ShieldResult } from "@sqw/shared";
import { cosigner, swissquoteOnline } from "./cosigner";
import { signWithPasskey } from "./passkey";
import type { WalletProfile } from "./profile";
import { withShare } from "./wallet-bitcoin";
import { USDC_OFFLINE, baseReader, checked, mpcSign, submit, updateCalls, usdcAccount } from "./wallet-usdc";

/** ETH held in the safe, and ETH deposited in Aave. Undefined when the safe has no apps. */
export async function loadPositions(profile: WalletProfile): Promise<{ eth: bigint; ethInAave: bigint } | undefined> {
  const record = await usdcAccount(profile);
  return supportsApps(record) ? defiPositions(baseReader, record.address) : undefined;
}

export async function appsAvailable(profile: WalletProfile): Promise<boolean> {
  return supportsApps(await usdcAccount(profile));
}

export interface AppUse {
  request: AppRequest;
  /** "passkey": an approved app, Face ID alone. "mpc": checked and co-signed by Swissquote. */
  signer: "passkey" | "mpc";
  prepared: EthPrepared;
  review?: ShieldResult;
}

export async function prepareAppUse(profile: WalletProfile, request: AppRequest): Promise<AppUse> {
  if (!(await swissquoteOnline())) throw new Error(USDC_OFFLINE);
  const record = await usdcAccount(profile);
  if (!supportsApps(record)) throw new Error("Your safe was opened before apps were available. Open a new safe to use them.");
  const adapter = adapterOf(request.app) as Address;
  const id = profile.walletId;
  const status = await cosigner.ethStatus(id);

  const usdcOut = request.app === "uniswap" && isAddressEqual(request.tokenIn, USDC.address) ? request.amountIn : 0n;
  const approved = status.rulesUpToDate && status.onChain.apps.some((a) => isAddressEqual(a, adapter)) && !status.onChain.frozen;
  const withinLimit = usdcOut <= BigInt(status.onChain.remainingAppToday);
  const params = appParams(request);

  if (approved && withinLimit) {
    const callData = useAppCall(adapter, params, false);
    const prepared = checked(await cosigner.ethPrepare(id, { callData, signer: "passkey" }), record.address, callData);
    return { request, signer: "passkey", prepared };
  }
  // Outside the approved apps or their limit: Swissquote checks it, and the rules on Base catch up too.
  const callData = batchCall([...(await updateCalls(profile, record, status)), { target: record.address, value: 0n, data: useAppCall(adapter, params, true) }]);
  const prepared = checked(await cosigner.ethPrepare(id, { callData, signer: "mpc" }), record.address, callData);
  return { request, signer: "mpc", prepared, review: prepared.review };
}

/** Face ID: the passkey signs an approved app's use, or unlocks the share for the MPC key. */
export async function sendAppUse(profile: WalletProfile, use: AppUse, clientConfirmed = false): Promise<EthSent> {
  const { prepared } = use;
  const signature =
    use.signer === "passkey"
      ? passkeySignature(await signWithPasskey(profile.passkey, hexToBytes(prepared.userOpHash)))
      : await withShare(profile, (share) => mpcSign(profile, share, prepared, clientConfirmed));
  return submit(profile, prepared, signature);
}
