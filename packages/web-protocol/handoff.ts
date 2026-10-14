// handoff.ts — how an app moves a sign-in made in the SYSTEM browser into its own views (RFC 8252 §8.12).
// Both halves read this one rule; a return address it allows is where a signed-in session is sent. See apps/k7/backend/docs/handoff.md.

import { isLoopbackReturn } from "./pairing.ts";

/** Opened in the system browser: signs in if needed, then sends a one-use code to `redirect`. */
export const HANDOFF_ISSUE = "/auth/handoff/issue";

/** Loaded in the app's own view: trades that code and the app's verifier for a session. */
export const HANDOFF_REDEEM = "/auth/handoff/redeem";

/** The desktop's signed-out user, minted by its own backend only. */
export const LOCAL_SIGN_IN = "/auth/local";

/** The Android app's URL scheme; mirrored in its manifest and in AuthHandoff.kt. */
export const APP_SCHEME = "se.frediver.k7";

/** Is this an address a handoff code may be sent to? Loopback http, or the Android app's own scheme. */
export function isHandoffReturn(raw: string): boolean {
  if (isLoopbackReturn(raw)) return true;
  try {
    return new URL(raw).protocol === `${APP_SCHEME}:`;
  } catch {
    return false;
  }
}

/** The address the app opens in the system browser. */
export function handoffIssueUrl(
  origin: string,
  p: { redirect: string; challenge: string; state: string; forget?: boolean },
): string {
  const u = new URL(HANDOFF_ISSUE, origin);
  u.searchParams.set("redirect", p.redirect);
  u.searchParams.set("challenge", p.challenge);
  u.searchParams.set("state", p.state);
  if (p.forget) u.searchParams.set("forget", "1");
  return u.toString();
}

/** The address the app loads in its own view once the code is back. */
export function handoffRedeemUrl(
  origin: string,
  p: { code: string; verifier: string; returnTo?: string },
): string {
  const u = new URL(HANDOFF_REDEEM, origin);
  u.searchParams.set("code", p.code);
  u.searchParams.set("verifier", p.verifier);
  u.searchParams.set("return_to", p.returnTo ?? "/");
  return u.toString();
}
