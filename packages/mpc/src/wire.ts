/**
 * Protocol messages as they travel between the phone and the services (JSON, hex payloads).
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { DklsLib, DklsMessage } from "./lib";

export interface WireMessage {
  from: number;
  /** Recipient party id; undefined for a broadcast. */
  to?: number;
  /** Hex payload. When `sealed`, it is a NaCl box only the recipient can open (see seal.ts). */
  payload: string;
  sealed?: boolean;
}

export function toWire(msgs: DklsMessage[]): WireMessage[] {
  return msgs.map((m) => {
    const wire: WireMessage = { from: m.from_id, payload: bytesToHex(m.payload) };
    if (m.to_id !== undefined) wire.to = m.to_id;
    m.free();
    return wire;
  });
}

export function fromWire(lib: DklsLib, msgs: WireMessage[]): DklsMessage[] {
  return msgs.map((m) => {
    if (m.sealed) throw new Error("Sealed protocol message must be opened before use");
    return new lib.Message(hexToBytes(m.payload), m.from, m.to);
  });
}

/** Messages party `id` must receive: broadcasts from the others and direct messages addressed to it. */
export function deliverTo(msgs: WireMessage[], id: number): WireMessage[] {
  return msgs.filter((m) => (m.to === undefined ? m.from !== id : m.to === id));
}
