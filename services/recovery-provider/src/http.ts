import express, { type NextFunction, type Request, type Response } from "express";

/** Minimal CORS for the local web app; tighten before any real deployment. */
export function cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

export function createApp() {
  const app = express();
  app.use(cors);
  app.use(express.json({ limit: "10mb" })); // MPC protocol rounds carry large messages
  return app;
}
