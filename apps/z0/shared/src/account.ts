// Where a z0 SPA sends the browser to sign in, and what signing out has to
// close. One rule for the six of them: the ACCOUNT login belongs to st0, at the
// origin root — z0 owns only the guest cookie. See apps/z0/docs/auth.md.

// The service prefix, not any SPA's: z0's backend answers under /z0/api while a
// SPA may sit deeper. Same constant every api.ts passes as createApiClient's
// basePath.
const Z0 = "/z0";

const post = (path: string): Promise<Response> =>
  fetch(path, { method: "POST", credentials: "include" });

/**
 * Sign in. st0 serves the origin root, so its `/auth/login` is prefixless —
 * and that is not a detail: the IdP has only `<origin>/auth/callback`
 * registered, so a flow run under `/z0` is refused before the user ever sees a
 * password field.
 */
export function login(): void {
  const back = encodeURIComponent(window.location.href);
  window.location.assign(`/auth/login?return_to=${back}`);
}

/**
 * Sign out, and close whatever the principal actually holds.
 *
 * A guest holds z0's `bt_session` and nothing else. An account holds st0's
 * `studio.sid`, which z0's backend can read but never expire — it does not sign
 * it. Posting only to z0 would leave an account user still signed in, with a
 * "Se déconnecter" button that reloads into the same session forever.
 */
/**
 * Why a 401 is sometimes not an invitation to log in.
 *
 * If the backend has no secret to verify st0's `studio.sid`, it can only ever
 * see guests. Showing the login button then costs a round trip to st0 and back
 * — the account IS signed in, z0 just cannot read it — and the gate reappears
 * unchanged. That reads as a loop, so `/auth/me` says which case it is.
 */
export const ACCOUNTS_UNCONFIGURED =
  "La connexion par compte n'est pas configurée sur ce serveur : il ne peut pas " +
  "lire la session de la médiathèque (STUDIO_SESSION_SECRET). Seuls les invités " +
  "peuvent entrer.";

/** The message when accounts are impossible here, or null when it is a plain 401. */
export async function accountsUnconfigured(
  res: Response,
): Promise<string | null> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { accountsConfigured?: boolean } | null;
  return body?.accountsConfigured === false ? ACCOUNTS_UNCONFIGURED : null;
}

export async function logout(kind?: string): Promise<void> {
  try {
    await post(`${Z0}/api/auth/logout`);
    if (kind === "user") await post("/auth/logout");
  } catch {
    /* ignore — the reload below is what the user asked for either way */
  }
  window.location.reload();
}
