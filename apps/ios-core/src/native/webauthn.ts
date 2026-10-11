/**
 * The RECOVERY key in the iOS app (replaces `@simplewebauthn/browser` in the core). The recovery provider
 * verifies a real WebAuthn ceremony against the web app's origin, so the app opens the web page
 * `/native/recovery-key` (ASWebAuthenticationSession), which runs it and hands the result back.
 */
import { native } from "../bridge";

export async function startRegistration({ optionsJSON }: { optionsJSON: unknown }): Promise<unknown> {
  const { response } = await native<{ response: unknown }>("recoveryKey.register", { options: optionsJSON });
  return response;
}

export async function startAuthentication({ optionsJSON }: { optionsJSON: unknown }): Promise<unknown> {
  const { response } = await native<{ response: unknown }>("recoveryKey.authenticate", { options: optionsJSON });
  return response;
}
