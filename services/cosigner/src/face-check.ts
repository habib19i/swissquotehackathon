/**
 * MOCK face check (CLAUDE.md section 8, recovery step 3). In production Swissquote compares a liveness
 * check with the client's KYC photo; here the app simulates the outcome. Swissquote signs the result
 * (BIP-340 Schnorr, @noble/curves) so the recovery provider can verify it came from Swissquote.
 */
import type { DatabaseSync } from "node:sqlite";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { faceCheckPayload, type FaceCheckAttestation } from "@sqw/shared";

export function faceChecks(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attestation_key (secret_key BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS face_checks (
      recovery_id TEXT NOT NULL,
      wallet_id   TEXT NOT NULL,
      result      TEXT NOT NULL,
      at          TEXT NOT NULL
    );
  `);
  let row = db.prepare("SELECT secret_key FROM attestation_key").get() as { secret_key: Uint8Array } | undefined;
  if (!row) {
    db.prepare("INSERT INTO attestation_key (secret_key) VALUES (?)").run(schnorr.utils.randomSecretKey());
    row = db.prepare("SELECT secret_key FROM attestation_key").get() as { secret_key: Uint8Array };
  }
  const secretKey = new Uint8Array(row.secret_key);

  return {
    publicKey: bytesToHex(schnorr.getPublicKey(secretKey)),

    issue(walletId: string, recoveryId: string, result: FaceCheckAttestation["result"]): FaceCheckAttestation {
      const fields = { walletId, recoveryId, result, at: new Date().toISOString() };
      const signature = schnorr.sign(sha256(new TextEncoder().encode(faceCheckPayload(fields))), secretKey);
      db.prepare("INSERT INTO face_checks (recovery_id, wallet_id, result, at) VALUES (?, ?, ?, ?)").run(recoveryId, walletId, result, fields.at);
      return { ...fields, signature: bytesToHex(signature) };
    },

    /** Did Swissquote's face check pass for this recovery? */
    passed(walletId: string, recoveryId: string): boolean {
      const row = db
        .prepare("SELECT result FROM face_checks WHERE recovery_id = ? AND wallet_id = ? ORDER BY at DESC")
        .get(recoveryId, walletId) as { result: string } | undefined;
      return row?.result === "match";
    },
  };
}
