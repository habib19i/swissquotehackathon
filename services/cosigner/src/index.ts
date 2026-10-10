/**
 * Swissquote co-signer service (workstream 2). MOCK of Swissquote's backend.
 * Holds MPC share 2, runs the scam shield, enforces rulebook delays, pays fees on the Premium plan.
 * Runs as its own process with its own database (CLAUDE.md section 4).
 */
import { createApp, notImplemented } from "./http";
import "./db";

const PORT = Number(process.env.COSIGNER_PORT ?? 4001);
const app = createApp();
const WS2 = "workstream 2 (Swissquote Co-signer)";

/** Demo switch for the "Swissquote is gone" scenario (CLAUDE.md section 8). */
let offline = false;

app.get("/health", (_req, res) => res.json({ service: "cosigner", mock: true, offline }));

app.post("/demo/offline", (req, res) => {
  offline = Boolean(req.body?.offline);
  res.json({ offline });
});

app.use((req, res, next) => {
  if (offline && !req.path.startsWith("/demo")) {
    return res.status(503).json({ error: "Swissquote is offline (demo switch)" });
  }
  next();
});

app.post("/shield/payment", notImplemented(WS2));
app.get("/wallets/:walletId/rulebook", notImplemented(WS2));
app.post("/wallets/:walletId/rulebook/changes", notImplemented(WS2));
app.post("/wallets/:walletId/rulebook/changes/:changeId/cancel", notImplemented(WS2));
app.post("/fees/quote", notImplemented(WS2));
app.post("/mock/face-check", notImplemented(WS2));

app.listen(PORT, () => console.log(`[cosigner] MOCK Swissquote co-signer on http://localhost:${PORT}`));
