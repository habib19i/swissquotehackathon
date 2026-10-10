/**
 * The client's RECOVERY passkey (CLAUDE.md section 5), registered only with this provider and never
 * used for daily payments. WebAuthn verification with @simplewebauthn/server.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import type { RecoveryKeyKind } from "@sqw/shared";

/** WebAuthn relying party: the app's host name, and the origins it is served from. */
const RP_ID = process.env.RP_ID ?? "localhost";
const EXPECTED_ORIGINS = (process.env.APP_ORIGINS ?? "http://localhost:3000,https://localhost:3000").split(",");
const CHALLENGE_TTL_MS = 5 * 60_000;

export type ChallengePurpose = "register" | "recovery" | "offline-approval";

export class RecoveryKeyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface KeyRow {
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  kind: RecoveryKeyKind;
}

export function recoveryKeys(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recovery_keys (
      wallet_id     TEXT PRIMARY KEY,
      client_number TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      public_key    BLOB NOT NULL,
      counter       INTEGER NOT NULL,
      transports    TEXT,
      kind          TEXT NOT NULL,
      registered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id         TEXT PRIMARY KEY,
      wallet_id  TEXT NOT NULL,
      purpose    TEXT NOT NULL,
      challenge  TEXT NOT NULL,
      context    TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at    TEXT
    );
  `);

  const keyOf = (walletId: string) =>
    db.prepare("SELECT credential_id, public_key, counter, transports, kind FROM recovery_keys WHERE wallet_id = ?").get(walletId) as
      | KeyRow
      | undefined;

  function credentialOf(walletId: string): WebAuthnCredential | undefined {
    const row = keyOf(walletId);
    return (
      row && {
        id: row.credential_id,
        publicKey: new Uint8Array(row.public_key),
        counter: row.counter,
        transports: row.transports ? JSON.parse(row.transports) : undefined,
      }
    );
  }

  function saveChallenge(walletId: string, purpose: ChallengePurpose, challenge: string, context: object): string {
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO webauthn_challenges (id, wallet_id, purpose, challenge, context, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, walletId, purpose, challenge, JSON.stringify(context), Date.now() + CHALLENGE_TTL_MS);
    return id;
  }

  /** A challenge is valid once, for its own wallet and purpose, before it expires. */
  function takeChallenge(id: string, walletId: string, purpose: ChallengePurpose) {
    const row = db.prepare("SELECT * FROM webauthn_challenges WHERE id = ?").get(id) as
      | { wallet_id: string; purpose: string; challenge: string; context: string; expires_at: number; used_at: string | null }
      | undefined;
    if (!row || row.wallet_id !== walletId || row.purpose !== purpose) throw new RecoveryKeyError(400, "Unknown request. Please start again.");
    if (row.used_at || row.expires_at < Date.now()) throw new RecoveryKeyError(400, "This request has expired. Please start again.");
    db.prepare("UPDATE webauthn_challenges SET used_at = datetime('now') WHERE id = ?").run(id);
    return { challenge: row.challenge, context: JSON.parse(row.context) };
  }

  return {
    kindOf: (walletId: string): RecoveryKeyKind | undefined => keyOf(walletId)?.kind,

    async registrationOptions(walletId: string, clientNumber: string, kind: RecoveryKeyKind) {
      if (keyOf(walletId)) throw new RecoveryKeyError(409, "A recovery key is already registered for this safe.");
      const options = await generateRegistrationOptions({
        rpName: "Swissquote Wallet recovery (independent provider)",
        rpID: RP_ID,
        userName: clientNumber,
        userDisplayName: `Recovery key for ${clientNumber}`,
        attestationType: "none",
        authenticatorSelection:
          kind === "security-key"
            ? { authenticatorAttachment: "cross-platform", residentKey: "discouraged", userVerification: "preferred" }
            : { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
        preferredAuthenticatorType: kind === "security-key" ? "securityKey" : "localDevice",
      });
      return { requestId: saveChallenge(walletId, "register", options.challenge, { clientNumber, kind }), options };
    },

    async register(walletId: string, requestId: string, response: RegistrationResponseJSON) {
      const { challenge, context } = takeChallenge(requestId, walletId, "register");
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: EXPECTED_ORIGINS,
        expectedRPID: RP_ID,
        requireUserVerification: context.kind === "synced",
      });
      if (!result.verified) throw new RecoveryKeyError(400, "The recovery key could not be verified.");
      const { credential } = result.registrationInfo;
      db.prepare(
        `INSERT INTO recovery_keys (wallet_id, client_number, credential_id, public_key, counter, transports, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        walletId,
        context.clientNumber,
        credential.id,
        credential.publicKey,
        credential.counter,
        credential.transports ? JSON.stringify(credential.transports) : null,
        context.kind,
      );
      return context.kind as RecoveryKeyKind;
    },

    /** Options asking for the registered recovery key, for a recovery or an offline approval. */
    async assertionOptions(walletId: string, purpose: Exclude<ChallengePurpose, "register">, context: object) {
      const credential = credentialOf(walletId);
      if (!credential) throw new RecoveryKeyError(404, "No recovery key is registered for this safe.");
      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials: [{ id: credential.id, transports: credential.transports }],
        userVerification: "preferred",
      });
      return { requestId: saveChallenge(walletId, purpose, options.challenge, context), options };
    },

    /** Checks an assertion of the registered recovery key. Returns the challenge context if valid. */
    async verifyAssertion(
      walletId: string,
      requestId: string,
      purpose: Exclude<ChallengePurpose, "register">,
      response: AuthenticationResponseJSON,
    ): Promise<object | undefined> {
      const credential = credentialOf(walletId);
      if (!credential) return undefined;
      const { challenge, context } = takeChallenge(requestId, walletId, purpose);
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: EXPECTED_ORIGINS,
        expectedRPID: RP_ID,
        credential,
        requireUserVerification: false,
      }).catch(() => undefined);
      if (!result?.verified) return undefined;
      db.prepare("UPDATE recovery_keys SET counter = ? WHERE wallet_id = ?").run(result.authenticationInfo.newCounter, walletId);
      return context;
    },
  };
}
