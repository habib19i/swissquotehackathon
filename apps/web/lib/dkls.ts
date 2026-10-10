import type { DklsLib } from "@sqw/mpc";

let dkls: Promise<DklsLib> | undefined;

/** Loads the browser build of DKLs23 once (the .wasm is copied to /public by scripts/copy-wasm.mjs). */
export function loadDkls(): Promise<DklsLib> {
  dkls ??= import("@silencelaboratories/dkls-wasm-ll-web").then(async (lib) => {
    await lib.default("/wasm/dkls.wasm");
    return lib;
  });
  return dkls;
}
