/** The browser build of DKLs23, as in the web app; the app serves `dkls.wasm` next to the core. */
import type { DklsLib } from "@sqw/mpc";

let dkls: Promise<DklsLib> | undefined;

export function loadDkls(): Promise<DklsLib> {
  dkls ??= import("@silencelaboratories/dkls-wasm-ll-web").then(async (lib) => {
    await lib.default(new URL("dkls.wasm", document.baseURI));
    return lib;
  });
  return dkls;
}
