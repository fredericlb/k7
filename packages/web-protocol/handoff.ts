// handoff.ts — how an app moves a sign-in made in the SYSTEM browser into its own views (RFC 8252 §8.12).
// Both halves read this one rule; a return address it allows is where a signed-in session is sent. See apps/k7/backend/docs/handoff.md.

import { isLoopbackReturn } from "./pairing.ts";

/** Opened in the system browser: signs in if needed, then sends a one-use code to `redirect`. */
export const HANDOFF_ISSUE = "/auth/handoff/issue";

/** Loaded in the app's own view: trades that code and the app's verifier for a session. */
export const HANDOFF_REDEEM = "/auth/handoff/redeem";

/** The machine's signed-out user, minted by its own backend only (the tray's, a phone app's). */
export const LOCAL_SIGN_IN = "/auth/local";

/** The Android app's URL scheme — its application id; mirrored in its manifest and in AuthHandoff.kt. */
export const APP_SCHEME = "se.frediver.k7";

/** The shipped app's and its e2e build's, which installs beside it: each must get its own answer back. */
export const APP_SCHEMES: readonly string[] = [APP_SCHEME, `${APP_SCHEME}.e2e`];

/** Is this an address a handoff code may be sent to? Loopback http, or one of the Android app's own schemes. */
export function isHandoffReturn(raw: string): boolean {
  if (isLoopbackReturn(raw)) return true;
  try {
    return APP_SCHEMES.includes(new URL(raw).protocol.slice(0, -1));
  } catch {
    return false;
  }
}
