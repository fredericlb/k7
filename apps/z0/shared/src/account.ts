// Where a z0 SPA sends the browser to sign in, and what signing out has to
// close. One rule for the six of them: the ACCOUNT login belongs to pl8, at the
// origin root — z0 owns only the guest cookie. See apps/z0/docs/auth.md.

// The SERVICE prefix, not any SPA's: the backend answers under /z0/api while a SPA sits deeper.
const Z0 = "/z0";

const post = (path: string): Promise<Response> =>
  fetch(path, { method: "POST", credentials: "include" });

// The SPA remembers it asked, because only it can tell a mismatched key from a plain 401.
const RETURNING = "z0.auth.returning";

export const SIGN_IN_DID_NOT_STICK =
  "Vous revenez de la connexion sans être identifié : ce serveur n'a pas pu lire " +
  "votre session studio. Son SESSION_SECRET doit être celui de la médiathèque " +
  "(section `common`).";

/** True exactly once, and consumed on read, so a later plain 401 still shows the ordinary gate. */
export function cameBackStillAnonymous(): boolean {
  try {
    const asked = sessionStorage.getItem(RETURNING);
    sessionStorage.removeItem(RETURNING);
    return asked === "1";
  } catch {
    return false; // private mode, or storage denied — fall back to the gate
  }
}

/** Sign in at pl8's PREFIXLESS `/auth/login` — the only one the IdP knows, ../../docs/auth.md. */
export function login(): void {
  try {
    sessionStorage.setItem(RETURNING, "1");
  } catch {
    /* storage denied — we lose the diagnosis, not the login */
  }
  const back = encodeURIComponent(window.location.href);
  window.location.assign(`/auth/login?return_to=${back}`);
}

/** Sign out of what the principal actually holds; z0 cannot expire `studio.sid` itself. */
export async function logout(kind?: string): Promise<void> {
  try {
    await post(`${Z0}/api/auth/logout`);
    if (kind === "user") await post("/auth/logout");
  } catch {
    /* ignore — the reload below is what the user asked for either way */
  }
  window.location.reload();
}
