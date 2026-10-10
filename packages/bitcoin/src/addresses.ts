/**
 * The client's two Bitcoin addresses (CLAUDE.md section 7).
 *
 * Savings safe: a plain P2WPKH address of the 2-of-3 MPC key.
 *
 * Spending pocket: a P2WSH address with two ways to spend:
 *   OP_IF <pocket key> OP_ELSE <MPC key> OP_ENDIF OP_CHECKSIG
 * - the phone spends alone with its pocket key (Face ID), for everyday payments;
 * - the 2-of-3 MPC key can always sweep it, so recovery rescues the pocket without the pocket key
 *   ever being copied or escrowed.
 */
import { networks, opcodes, payments, script } from "bitcoinjs-lib";

/** Signet uses testnet's address format (tb1...). */
export const signet = networks.testnet;

export interface SavingsSafe {
  address: string;
  output: Uint8Array;
}

export interface SpendingPocket {
  address: string;
  output: Uint8Array;
  witnessScript: Uint8Array;
}

export function savingsSafe(mpcPublicKey: Uint8Array): SavingsSafe {
  const p = payments.p2wpkh({ pubkey: mpcPublicKey, network: signet });
  return { address: p.address!, output: p.output! };
}

export function pocketScript(pocketPublicKey: Uint8Array, mpcPublicKey: Uint8Array): Uint8Array {
  return script.compile([
    opcodes.OP_IF,
    pocketPublicKey,
    opcodes.OP_ELSE,
    mpcPublicKey,
    opcodes.OP_ENDIF,
    opcodes.OP_CHECKSIG,
  ]);
}

export function spendingPocket(pocketPublicKey: Uint8Array, mpcPublicKey: Uint8Array): SpendingPocket {
  const witnessScript = pocketScript(pocketPublicKey, mpcPublicKey);
  const p = payments.p2wsh({ redeem: { output: witnessScript }, network: signet });
  return { address: p.address!, output: p.output!, witnessScript };
}
