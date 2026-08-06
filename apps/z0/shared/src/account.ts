// Where a z0 SPA sends the browser to sign in, and what signing out has to
// close. One rule for the six of them: the ACCOUNT login belongs to st0, at the
// origin root — z0 owns only the guest cookie. See apps/z0/docs/auth.md.

// The service prefix, not any SPA's: z0's backend answers under /z0/api while a
// SPA may sit deeper. Same constant every api.ts passes as createApiClient's
// basePath.
const Z0 = "/z0";

const post = (path: string): Promise<Response> =>
  fetch(path, { method: "POST", credentials: "include" });

// A login that does not stick reads as a loop: st0 knows you, so it bounces the
// browser straight back, and the gate reappears unchanged. The cause is always
// the same shape — z0's SESSION_SECRET is not the one st0 signed `studio.sid`
// with — but the backend cannot detect it: a wrong key and no cookie both just
// fail to verify. So the SPA notices instead, by remembering that it asked.
const RETURNING = "z0.auth.returning";

export const SIGN_IN_DID_NOT_STICK =
  "Vous revenez de la connexion sans être identifié : ce serveur n'a pas pu lire " +
  "votre session studio. Son SESSION_SECRET doit être celui de la médiathèque " +
  "(section `common`).";

/**
 * True exactly once, when this page load follows a login we sent off and came
 * back from still anonymous. Consumed on read, so a later plain 401 — someone
 * who simply never signed in — still shows the ordinary gate.
 */
export function cameBackStillAnonymous(): boolean {
  try {
    const asked = sessionStorage.getItem(RETURNING);
    sessionStorage.removeItem(RETURNING);
    return asked === "1";
  } catch {
    return false; // private mode, or storage denied — fall back to the gate
  }
}

/**
 * Sign in. st0 serves the origin root, so its `/auth/login` is prefixless —
 * and that is not a detail: the IdP has only `<origin>/auth/callback`
 * registered, so a flow run under `/z0` is refused before the user ever sees a
 * password field.
 */
export function login(): void {
  try {
    sessionStorage.setItem(RETURNING, "1");
  } catch {
    /* storage denied — we lose the diagnosis, not the login */
  }
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
export async function logout(kind?: string): Promise<void> {
  try {
    await post(`${Z0}/api/auth/logout`);
    if (kind === "user") await post("/auth/logout");
  } catch {
    /* ignore — the reload below is what the user asked for either way */
  }
  window.location.reload();
}
