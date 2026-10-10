/**
 * What a UserOperation asks the client's account to do: encoded by the app from its structured draft,
 * decoded by Swissquote before it co-signs or sponsors anything.
 */
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, isAddressEqual, type Address, type Hex } from "viem";
import { rulebookAccountAbi } from "./abi";
import { USDC } from "./config";

/** ERC-7821 batch mode: call type 0x01 (batch), default execution type, no extra data. */
export const BATCH_MODE: Hex = `0x01${"00".repeat(31)}`;

const CALLS = [
  {
    type: "tuple[]",
    components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

export type AccountAction =
  /** A daily payment the passkey may sign alone: approved contact, within the daily limit. */
  | { kind: "payContact"; to: Address; amount: bigint; proof: readonly Hex[]; fee: bigint }
  /** Any USDC transfer from the account; needs the MPC key. */
  | { kind: "usdcTransfer"; to: Address; amount: bigint }
  | { kind: "setRulebook"; root: Hex; limit: bigint }
  | { kind: "setFrozen"; frozen: boolean }
  | { kind: "setPasskey"; x: Hex; y: Hex }
  | { kind: "revokeContact"; contact: Address };

/** What the account does to itself: its rules and its passkey. */
export type SelfAction = Extract<AccountAction, { kind: "setRulebook" | "setFrozen" | "setPasskey" }>;

export class UnsupportedCallError extends Error {}

export function payContactCall(to: Address, amount: bigint, proof: readonly Hex[], fee: bigint): Hex {
  return encodeFunctionData({ abi: rulebookAccountAbi, functionName: "payContact", args: [to, amount, proof, fee] });
}

export function usdcTransfer(to: Address, amount: bigint): Call {
  return { target: USDC.address, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) };
}

/** A call from the account to itself, e.g. a rulebook update inside a batch. */
export function selfCall(account: Address, action: SelfAction): Call {
  const data =
    action.kind === "setRulebook"
      ? encodeFunctionData({ abi: rulebookAccountAbi, functionName: "setRulebook", args: [action.root, action.limit] })
      : action.kind === "setFrozen"
        ? encodeFunctionData({ abi: rulebookAccountAbi, functionName: "setFrozen", args: [action.frozen] })
        : encodeFunctionData({ abi: rulebookAccountAbi, functionName: "setPasskey", args: [action.x, action.y] });
  return { target: account, value: 0n, data };
}

/** Several calls in one operation (ERC-7821 `execute`); only the MPC key may sign it. */
export function batchCall(calls: Call[]): Hex {
  return encodeFunctionData({ abi: rulebookAccountAbi, functionName: "execute", args: [BATCH_MODE, encodeAbiParameters(CALLS, [calls])] });
}

function accountAction(data: Hex): AccountAction {
  const call = decodeFunctionData({ abi: rulebookAccountAbi, data });
  switch (call.functionName) {
    case "payContact": {
      const [to, amount, proof, fee] = call.args;
      return { kind: "payContact", to, amount, proof, fee };
    }
    case "setRulebook":
      return { kind: "setRulebook", root: call.args[0], limit: call.args[1] };
    case "setFrozen":
      return { kind: "setFrozen", frozen: call.args[0] };
    case "setPasskey":
      return { kind: "setPasskey", x: call.args[0], y: call.args[1] };
    case "revokeContact":
      return { kind: "revokeContact", contact: call.args[0] };
    default:
      throw new UnsupportedCallError(`The account call ${call.functionName} is not supported here.`);
  }
}

function batchedAction(account: Address, { target, value, data }: Call): AccountAction {
  if (value !== 0n) throw new UnsupportedCallError("Operations from a safe never send ETH.");
  if (isAddressEqual(target, account)) {
    const action = accountAction(data);
    if (action.kind === "payContact") throw new UnsupportedCallError("A daily payment cannot be part of a batch.");
    return action;
  }
  if (isAddressEqual(target, USDC.address)) {
    const call = decodeFunctionData({ abi: erc20Abi, data });
    if (call.functionName !== "transfer") throw new UnsupportedCallError(`USDC ${call.functionName} is not supported.`);
    return { kind: "usdcTransfer", to: call.args[0], amount: call.args[1] };
  }
  throw new UnsupportedCallError("This operation calls a contract Swissquote does not support.");
}

/** Every action in a UserOperation's callData; throws on anything the wallet does not use. */
export function decodeActions(account: Address, callData: Hex): AccountAction[] {
  let call;
  try {
    call = decodeFunctionData({ abi: rulebookAccountAbi, data: callData });
  } catch {
    throw new UnsupportedCallError("This operation does not call the safe in a known way.");
  }
  if (call.functionName !== "execute") return [accountAction(callData)];

  const [mode, executionData] = call.args;
  if (mode !== BATCH_MODE) throw new UnsupportedCallError("Unsupported execution mode.");
  const [calls] = decodeAbiParameters(CALLS, executionData);
  return calls.map((c) => batchedAction(account, c));
}
