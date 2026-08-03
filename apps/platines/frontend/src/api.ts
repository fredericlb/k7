// api.ts — platines' own backend, same-origin: who you are, which engines exist, and which
// one this account DJs from. It holds no media and no files — the decks reach the machine's
// file service and its moteur directly, cross-origin, as they always have.

import type { PublicEngine } from "@studio/web-protocol";

// The app is mounted under a path (studio.test/<service>), so every backend
// path below carries it. BASE_URL is vite's `base`; it ends in a slash, trimmed
// here so the literals keep reading as paths.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Who is signed in, held at module level for the SESSION id and the file service's header.
 *
 * Module state rather than a prop threaded through the deck, because this SPA has one gate
 * and therefore one user for its whole life. Set once, by that gate, before anything below
 * it renders. It REPLACED a text box the DJ typed their own identity into — which the file
 * service then trusted, and which nothing checked.
 */
let signedInAs = "";
export const currentUser = (): string => signedInAs;

export const auth = {
  // `return_to` is the name the OIDC package reads; `redirect` was silently
  // ignored, which only looked fine while this app owned the origin root.
  loginUrl: `/auth/login?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`,

  me: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    const user = (await json<{ user: AuthUser }>(res, "auth/me")).user;
    signedInAs = user.email ?? user.sub ?? "";
    return user;
  },
};

export const engines = {
  list: async () =>
    json<PublicEngine[]>(await fetch(`${BASE}/api/engines`), "engines"),
  select: async (id: string, token: string, tier: number) =>
    json<{ ok: true }>(
      await fetch(`${BASE}/api/engine/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, token, tier }),
      }),
      "select",
    ),
  prefs: async () =>
    json<{ engineId?: string }>(
      await fetch(`${BASE}/api/preferences`),
      "preferences",
    ),
  savePrefs: async (p: { engineId?: string }) =>
    json<{ ok: true }>(
      await fetch(`${BASE}/api/preferences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      }),
      "preferences",
    ),
};
