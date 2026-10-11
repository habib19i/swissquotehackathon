/**
 * Bundles the wallet core for the iOS app: `dist/index.html`, `dist/wallet-core.js` and `dist/dkls.wasm`.
 *
 * The web app's own wallet layer (apps/web/lib) is bundled as it is, except four modules that are swapped
 * for native-backed versions: the Face ID passkey, the vault, the DKLs loader and storage; the recovery-key
 * ceremony goes through the web page (`@simplewebauthn/browser` is swapped too).
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webLib = resolve(here, "../web/lib");
const native = (name) => join(here, "src/native", `${name}.ts`);

/** Module swaps, for imports made by the web app's wallet layer only (never inside packages). */
const SWAPPED = {
  "./passkey": "passkey",
  "./vault": "vault",
  "./dkls": "dkls",
  "idb-keyval": "storage",
  "@simplewebauthn/browser": "webauthn",
  // WalletConnect sessions run natively (Reown's Swift SDK); the core only prepares their transactions.
  "@reown/walletkit": "no-walletkit",
  "@walletconnect/core": "no-walletkit",
  "@walletconnect/utils": "no-walletkit",
};

const insideWebLib = (dir) => {
  const path = resolve(dir);
  return path === webLib || path.startsWith(webLib + "\\") || path.startsWith(webLib + "/");
};

const nativeModules = {
  name: "native-modules",
  setup(b) {
    b.onResolve({ filter: /^(\.\/(passkey|vault|dkls)|idb-keyval|@simplewebauthn\/browser|@reown\/walletkit|@walletconnect\/(core|utils))$/ }, (args) => {
      if (!insideWebLib(args.resolveDir)) return undefined;
      // "./passkey" from apps/web/lib/assistant would be another module: only swap the lib's own.
      if (args.path.startsWith("./") && resolve(args.resolveDir) !== webLib) return undefined;
      return { path: native(SWAPPED[args.path]) };
    });
  },
};

const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });

const result = await build({
  entryPoints: [join(here, "src/index.ts")],
  outfile: join(dist, "wallet-core.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "safari16",
  minify: process.argv.includes("--minify"),
  sourcemap: "linked",
  metafile: true,
  plugins: [nativeModules],
  define: {
    // As in the web app's browser code: no environment, so every setting takes its default (public
    // explorers, demo timers). The services and /api are reached through the app's own scheme.
    "process.env.NODE_ENV": '"production"',
    "process.env": "{}",
  },
  logLevel: "warning",
});

// The same DKLs23 WebAssembly the web app serves.
const require = createRequire(join(here, "package.json"));
const wasm = join(dirname(require.resolve("@silencelaboratories/dkls-wasm-ll-web")), "dkls-wasm-ll-web_bg.wasm");
copyFileSync(wasm, join(dist, "dkls.wasm"));
copyFileSync(join(here, "src/index.html"), join(dist, "index.html"));

const bytes = result.metafile.outputs[join("dist", "wallet-core.js").replace(/\\/g, "/")]?.bytes ?? readFileSync(join(dist, "wallet-core.js")).length;
console.log(`wallet core: dist/wallet-core.js (${Math.round(bytes / 1024)} KB), dist/dkls.wasm, dist/index.html`);
