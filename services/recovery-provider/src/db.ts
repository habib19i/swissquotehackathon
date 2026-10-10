/**
 * This service's OWN storage (CLAUDE.md section 4): a SQLite file that no other process opens.
 * Uses Node's built-in node:sqlite (Node >= 22.13).
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../recovery-provider.db", import.meta.url));
export const db = new DatabaseSync(file);

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
