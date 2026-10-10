// Copies the browser build of DKLs23 into /public so the app can load it with init("/wasm/dkls.wasm").
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve("@silencelaboratories/dkls-wasm-ll-web/package.json"));
mkdirSync("public/wasm", { recursive: true });
copyFileSync(join(pkg, "dkls-wasm-ll-web_bg.wasm"), "public/wasm/dkls.wasm");
