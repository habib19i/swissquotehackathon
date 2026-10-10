import express, { type Request, type Response, type NextFunction } from "express";

/** Minimal CORS for the local web app; tighten before any real deployment. */
export function cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

export function notImplemented(workstream: string) {
  return (_req: Request, res: Response) =>
    res.status(501).json({ error: "Not implemented yet", owner: workstream });
}

export function createApp() {
  const app = express();
  app.use(cors);
  app.use(express.json());
  return app;
}
