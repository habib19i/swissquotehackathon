/**
 * DKLs23 comes in two builds with the same API: `-node` for the services and `-web` for the phone.
 * Protocol code takes the build as a parameter so it runs unchanged in both places.
 */
import type * as Dkls from "@silencelaboratories/dkls-wasm-ll-node";

export type DklsLib = Pick<typeof Dkls, "KeygenSession" | "Keyshare" | "Message" | "SignSession">;
export type DklsKeygenSession = Dkls.KeygenSession;
export type DklsKeyshare = Dkls.Keyshare;
export type DklsMessage = Dkls.Message;
