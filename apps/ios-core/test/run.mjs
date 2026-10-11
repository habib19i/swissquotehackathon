/**
 * End-to-end test of the wallet core, without Xcode: the core runs in headless Edge or Chrome, with
 * test/fake-native.ts playing the iOS app, against the running services (`pnpm dev`) and the testnets.
 *
 *   pnpm --filter @sqw/ios-core check          (BROWSER=path to override the browser)
 *
 * It opens a safe exactly as the iOS app will (Face ID key, MPC key generation, Swissquote's checks and
 * ownership proofs), reads balances and rules, and, if Swissquote's demo account still has test USDC,
 * pays Léo with a Face ID signature in the Secure Enclave's format: the account on Base verifies it.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../dist");
const PORT = 3456;
const DEBUG_PORT = 9333;
const SERVICES = { "/svc/cosigner/": "http://localhost:4001/", "/svc/recovery/": "http://localhost:4002/", "/api/": "http://localhost:3000/api/" };

const BROWSERS = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean);

// ---------------------------------------------------------------- the page: core + test phone, and the proxy

const fakeNative = await build({
  entryPoints: [join(here, "fake-native.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  logLevel: "warning",
});
const PAGE = `<!doctype html><meta charset="utf-8"><title>wallet core test</title>
<script>${fakeNative.outputFiles[0].text}</script><script src="wallet-core.js"></script>`;
const TYPES = { ".js": "text/javascript", ".wasm": "application/wasm", ".map": "application/json" };

/** Serves the core like the iOS app's scheme handler: its files, and the services under the same origin. */
const server = createServer((req, res) => {
  const prefix = Object.keys(SERVICES).find((p) => req.url.startsWith(p));
  if (prefix) {
    const target = new URL(SERVICES[prefix] + req.url.slice(prefix.length));
    const upstream = httpRequest(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => {
      res.writeHead(502).end(JSON.stringify({ error: "service not reachable" }));
    });
    req.pipe(upstream);
    return;
  }
  if (req.url === "/" || req.url === "/index.html") return res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
  const file = join(dist, req.url.split("?")[0]);
  if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((resolve) => server.listen(PORT, resolve));

// ---------------------------------------------------------------- headless browser, driven over CDP

const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) throw new Error("No Edge or Chrome found: set BROWSER to its path.");
const profileDir = mkdtempSync(join(tmpdir(), "sqw-core-test-"));
const browser = spawn(browserPath, [
  "--headless=new",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "about:blank",
]);

async function pageSocket() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // the browser is still starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("The browser did not start.");
}

const ws = new WebSocket(await pageSocket());
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error" && msg.params.entry.source !== "network") {
    // Network answers (a 404 the wallet layer expects, the test page's favicon) are not page errors.
    consoleErrors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
};
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

/** Runs an expression in the page and returns its (awaited) value. */
async function evaluate(expression) {
  const { result } = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

/** Calls the core the way the iOS app does, and unwraps its answer. */
async function core(method, ...args) {
  const answer = JSON.parse(await evaluate(`window.sqwCore.call(${JSON.stringify(method)}, ${JSON.stringify(JSON.stringify(args))})`));
  if (!answer.ok) throw new Error(`${method}: ${answer.error.message} (${answer.error.name})`);
  return answer.value;
}

// ---------------------------------------------------------------- the test

let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};

try {
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Log.enable");
  await cdp("Page.navigate", { url: `http://localhost:${PORT}/` });
  for (let i = 0; i < 50 && !(await evaluate("Boolean(window.sqwCore)").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 200));

  const methods = await evaluate("window.sqwCore.methods");
  check(methods.length > 40, `core loaded, ${methods.length} methods`);

  const client = { name: "Test Client", clientNumber: `CH-TEST-ios${Date.now().toString(36).slice(-5)}` };
  await core("client.save", client);
  check((await core("client.load")).clientNumber === client.clientNumber, "Swissquote login (Mock) stored natively");

  const passkey = await core("setUpFaceId", client);
  check(passkey.protection === "secure-enclave" && passkey.algorithm === -7 && passkey.publicKey.length === 182, "Face ID key: P-256, SPKI recorded");

  const started = Date.now();
  const { profile, share } = await core("createSafe", client, passkey);
  const progress = await evaluate("window.fakeNative.events.filter(e => e.event === 'keygen-progress').length");
  check(/^0[23][0-9a-f]{64}$/.test(profile.mpcPublicKey) && share.startsWith("h"), `2-of-3 MPC key generated in ${((Date.now() - started) / 1000).toFixed(1)} s (${progress} progress events)`);
  check(profile.savingsAddress.startsWith("tb1q") && profile.pocketAddress.startsWith("tb1q"), `Savings safe ${profile.savingsAddress}`);

  const record = await core("finishSetup", share, "premium");
  check(Boolean(record.ownershipVerifiedAt), "Swissquote registered the safe and verified the ownership proof (BIP-322, MPC signature)");
  const usdc = await core("usdcAccount");
  check(/^0x[0-9a-fA-F]{40}$/.test(usdc.address), `USDC account ${usdc.address}`);
  const again = await core("swissquoteRecord", profile.walletId);
  check(Boolean(again.ethereum?.ownershipVerifiedAt), "Swissquote verified the USDC account's ownership proof (ERC-6492, before deployment)");

  const balances = await core("loadBalances");
  check(balances.pocket.confirmed === "0" && balances.savings.confirmed === "0", "balances read from signet (new safe: empty)");
  const rulebook = await core("loadRulebook", profile.walletId);
  check(rulebook.contacts.length >= 3, `rulebook: ${rulebook.contacts.map((c) => c.name).join(", ")}`);

  // A Face ID payment on Base, if Swissquote's demo account can fund it: the on-chain proof of the format.
  const demo = await core("cosigner.demoAccount");
  const demoUsdc = BigInt(demo.base?.usdc ?? "0");
  if (demoUsdc >= 150_000n) {
    // CHF 0.12 is about USDC 0.15: enough for USDC 0.10 to Léo (Premium: Swissquote pays the gas).
    const txHash = await core("cosigner.demoTransferUsdc", profile.walletId, 0.12);
    console.log(`     funded with test USDC: https://sepolia.basescan.org/tx/${txHash}`);
    await new Promise((r) => setTimeout(r, 6000));
    const leo = rulebook.contacts.find((c) => c.id === "leo");
    const payment = await core("prepareUsdcPayment", leo, "100000");
    check(payment.signer === "passkey", "USDC 0.10 to Léo: Face ID alone (within the rules)");
    const before = await evaluate("window.fakeNative.faceId");
    const sent = await core("sendUsdcPayment", payment.handle);
    check(sent.success && (await evaluate("window.fakeNative.faceId")) === before + 1, `Base accepted the Secure Enclave-format signature: https://sepolia.basescan.org/tx/${sent.txHash}`);
  } else {
    console.log(`skip USDC payment: Swissquote's demo account has ${Number(demoUsdc) / 1e6} test USDC (top it up at faucet.circle.com)`);
  }

  const refused = JSON.parse(await evaluate(`window.sqwCore.call("sendPayment", '["h999", 70000]')`));
  check(!refused.ok && /expired/.test(refused.error.message), "an unknown handle is refused in plain language");

  await core("forgetThisPhone");
  check((await core("profile.load")) === null, "Lose this phone: profile, vault and Face ID key forgotten");
  check(consoleErrors.length === 0, `no uncaught errors in the page${consoleErrors.length ? `: ${consoleErrors.join("; ")}` : ""}`);
} catch (err) {
  console.log(`FAIL ${err.message}`);
  for (const e of consoleErrors) console.log(`     page error: ${e}`);
  failed = true;
} finally {
  ws.close();
  browser.kill();
  server.close();
  setTimeout(() => rmSync(profileDir, { recursive: true, force: true }), 500);
}
process.exitCode = failed ? 1 : 0;
