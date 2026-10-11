/**
 * Type check only (never bundled): each native-backed module offers what the web app's wallet layer
 * uses from the module it replaces, with the same signatures. `pnpm typecheck` fails if they drift.
 * (Storage is left out: idb-keyval accepts any key type, the wallet layer only uses strings.)
 */
import type * as WebDkls from "../../web/lib/dkls";
import type * as WebPasskey from "../../web/lib/passkey";
import type * as WebVault from "../../web/lib/vault";
import * as NativeDkls from "../src/native/dkls";
import * as NativePasskey from "../src/native/passkey";
import * as NativeVault from "../src/native/vault";

export const passkey: Pick<typeof WebPasskey, "passkeysSupported" | "createWalletPasskey" | "signWithPasskey" | "confirmWithFaceId"> = NativePasskey;
export const vault: Pick<typeof WebVault, "lockVault" | "unlockVault" | "VAULT_STORAGE_KEYS"> = NativeVault;
export const dkls: typeof WebDkls = NativeDkls;
