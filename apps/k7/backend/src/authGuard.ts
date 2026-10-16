// authGuard.ts — refuses a backend whose sign-in would fall back on the dev stub, which signs ANY
// visitor in as one shared "Dev User", or whose session secret is guessable (../docs/hardening.md).
// A pure decision over an environment: server.ts runs it before setupAuth and exits on a refusal.

/** The literal commons' `setupAuth` signs with when `SESSION_SECRET` is unset. */
export const DEFAULT_SESSION_SECRET = "dev-insecure-secret-change-me";
/** Shorter is guessable; the desktop's and the phone's generated secret is 64 hex characters. */
const MIN_SESSION_SECRET = 32;

/** Why this environment must not start, one line per reason; empty means it may. */
export function authRefusals(
  env: Record<string, string | undefined>,
): string[] {
  // A device's own backend and an explicit dev session are the two that may run the stub.
  if (env.STUDIO_LOCAL_USER === "1" || env.STUDIO_DEV_AUTH === "1") return [];
  const reasons: string[] = [];
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID)
    reasons.push(
      "OIDC_ISSUER and OIDC_CLIENT_ID must both be set, or every visitor is signed in as the dev user",
    );
  const secret = env.SESSION_SECRET ?? "";
  if (secret === DEFAULT_SESSION_SECRET)
    reasons.push("SESSION_SECRET is the public development default");
  else if (secret.length < MIN_SESSION_SECRET)
    reasons.push(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET} characters (it is ${secret.length})`,
    );
  return reasons;
}
