// Signing in, which k7 does not do itself: st0 owns /auth/* for the whole origin,
// so an anonymous tab is sent straight there and comes back by `return_to`.
// The one-shot marker is the safety rail — without it a session that never takes
// (a bad cookie, a stale secret) ping-pongs between here and the IdP forever.

import { api } from "./api";

const BOUNCED = "k7.signin-bounced";

/** Leave for pl8's login, remembering the trip so we only make it once. */
export function signIn(): void {
  sessionStorage.setItem(BOUNCED, "1");
  // replace, not assign: the anonymous URL must not sit in history, or Back
  // lands on it and bounces again.
  window.location.replace(api.loginUrl);
}

/** True when we already went and came back still anonymous — stop, don't loop. */
export function signInLooped(): boolean {
  return sessionStorage.getItem(BOUNCED) === "1";
}

/** Called once a session is in hand, so the next anonymous tab may bounce again. */
export function signInSettled(): void {
  sessionStorage.removeItem(BOUNCED);
}
