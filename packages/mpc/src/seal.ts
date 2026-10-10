/**
 * End-to-end sealing of protocol messages between the two services, with NaCl `box`
 * (tweetnacl: X25519 + XSalsa20-Poly1305). The phone relays these messages but cannot read or forge them.
 */
import nacl from "tweetnacl";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import type { WireMessage } from "./wire";

export interface BoxKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function newBoxKeyPair(): BoxKeyPair {
  return nacl.box.keyPair();
}

export function seal(msg: WireMessage, recipientPublicKey: Uint8Array, senderSecretKey: Uint8Array): WireMessage {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(hexToBytes(msg.payload), nonce, recipientPublicKey, senderSecretKey);
  return { ...msg, payload: bytesToHex(concatBytes(nonce, box)), sealed: true };
}

/** Opens a sealed message; throws if it was not sealed by `senderPublicKey` for us. */
export function unseal(msg: WireMessage, senderPublicKey: Uint8Array, recipientSecretKey: Uint8Array): WireMessage {
  if (!msg.sealed) throw new Error(`Message from party ${msg.from} must be sealed`);
  const bytes = hexToBytes(msg.payload);
  const nonce = bytes.subarray(0, nacl.box.nonceLength);
  const opened = nacl.box.open(bytes.subarray(nacl.box.nonceLength), nonce, senderPublicKey, recipientSecretKey);
  if (!opened) throw new Error(`Message from party ${msg.from} failed authentication`);
  const { sealed: _sealed, ...plain } = msg;
  return { ...plain, payload: bytesToHex(opened) };
}
