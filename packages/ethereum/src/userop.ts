/**
 * ERC-4337 UserOperations (EntryPoint v0.9), with viem's packing and hashing, plus the layout of
 * SwissquotePaymaster's sponsorship and a JSON form for sending operations between app and services.
 */
import {
  concat,
  encodeAbiParameters,
  isAddress,
  isHex,
  keccak256,
  numberToHex,
  slice,
  type Address,
  type Hex,
} from "viem";
import { getUserOperationHash, toPackedUserOperation, type UserOperation } from "viem/account-abstraction";
import { ENTRY_POINT, ENTRY_POINT_VERSION, chain } from "./config";

export type UserOp = UserOperation<typeof ENTRY_POINT_VERSION>;

/**
 * Gas limits. Validation: generous fixed values (unused validation gas costs nothing). Execution: measured
 * by simulation when the account exists (DeFi apps need far more than a payment), else these defaults.
 */
export const GAS = {
  verification: 400_000n,
  /** The first operation also deploys the account. */
  verificationWithDeployment: 700_000n,
  call: 200_000n,
  /** Before the account exists its calls cannot be simulated: room for an app's first use. */
  callUndeployed: 600_000n,
  preVerification: 60_000n,
  paymasterVerification: 60_000n,
  paymasterPostOp: 0n,
} as const;

/** The hash the account's key signs (EIP-712 in EntryPoint v0.8+). */
export function userOpHash(op: UserOp): Hex {
  return getUserOperationHash({
    chainId: chain.id,
    entryPointAddress: ENTRY_POINT,
    entryPointVersion: ENTRY_POINT_VERSION,
    userOperation: { ...op, signature: "0x" },
  });
}

/** Most gas the operation may use: what the paymaster's deposit must cover, times the gas price. */
export function maxGas(op: UserOp): bigint {
  return (
    op.verificationGasLimit +
    op.callGasLimit +
    op.preVerificationGas +
    (op.paymasterVerificationGasLimit ?? 0n) +
    (op.paymasterPostOpGasLimit ?? 0n)
  );
}

export const packed = (op: UserOp) => toPackedUserOperation(op);

/** What Swissquote signs to sponsor `op`: mirrors SwissquotePaymaster.getHash. */
export function paymasterHash(op: UserOp, validUntil: number, validAfter: number): Hex {
  if (!op.paymaster) throw new Error("The operation names no paymaster.");
  const p = packed({ ...op, paymasterData: "0x" });
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint48" },
        { type: "uint48" },
      ],
      [
        p.sender,
        p.nonce,
        keccak256(p.initCode),
        keccak256(p.callData),
        p.accountGasLimits,
        slice(p.paymasterAndData, 20, 52),
        p.preVerificationGas,
        p.gasFees,
        BigInt(chain.id),
        op.paymaster,
        validUntil,
        validAfter,
      ],
    ),
  );
}

/** paymasterData = validUntil (6 bytes) | validAfter (6 bytes) | Swissquote's signature (65 bytes). */
export function paymasterData(validUntil: number, validAfter: number, signature: Hex): Hex {
  return concat([numberToHex(validUntil, { size: 6 }), numberToHex(validAfter, { size: 6 }), signature]);
}

// ------------------------------------------------------------------ JSON transport

const BIGINT_FIELDS = [
  "nonce",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "paymasterVerificationGasLimit",
  "paymasterPostOpGasLimit",
] as const;
const ADDRESS_FIELDS = ["sender", "factory", "paymaster"] as const;
const HEX_FIELDS = ["callData", "factoryData", "paymasterData", "signature"] as const;

export type UserOpJson = Record<string, string>;

export function userOpToJson(op: UserOp): UserOpJson {
  const json: UserOpJson = {};
  for (const [key, value] of Object.entries(op)) {
    if (value === undefined) continue;
    json[key] = typeof value === "bigint" ? numberToHex(value) : String(value);
  }
  return json;
}

/** Parses an operation received over the network, checking every field's type. */
export function userOpFromJson(json: unknown): UserOp {
  if (!json || typeof json !== "object") throw new Error("Missing operation.");
  const input = json as Record<string, unknown>;
  const op: Record<string, unknown> = {};
  for (const key of BIGINT_FIELDS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !isHex(value)) throw new Error(`Invalid ${key}.`);
    op[key] = BigInt(value);
  }
  for (const key of ADDRESS_FIELDS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !isAddress(value)) throw new Error(`Invalid ${key}.`);
    op[key] = value as Address;
  }
  for (const key of HEX_FIELDS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !isHex(value)) throw new Error(`Invalid ${key}.`);
    op[key] = value;
  }
  for (const key of ["sender", "nonce", "callData", "callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas"]) {
    if (op[key] === undefined) throw new Error(`The operation has no ${key}.`);
  }
  return { signature: "0x", ...op } as unknown as UserOp;
}
