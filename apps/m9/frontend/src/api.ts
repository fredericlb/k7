// api.ts — two destinations. m9's own backend, same-origin: who you are, which engines exist,
// and which one this account works from. And the chosen machine's file service, cross-origin,
// which holds the project — that half is @studio/project-shell's, shared with l8 so a route
// name cannot drift between them.

import { registryClient } from "@studio/engine-browser/registry";
import { projectApi } from "@studio/project-shell/project";
import type { PublicEngine } from "@studio/web-protocol";

// The app is mounted under a path (studio.test/<service>), so every backend
// path below carries it. BASE_URL is vite's `base`; it ends in a slash, trimmed
// here so the literals keep reading as paths.
// Exported because the engine probe needs it too: the relay answers under this same prefix.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

// The five registry routes every hosted service mounts. Shared rather than spelled here: st0's
// copy of this was the same 36 lines, comments included.
export const engines = registryClient<PublicEngine>(BASE, json);

/**
 * The open project, on the engine's machine. Every route here is the shared one — m9 adds
 * none of its own, which is the point: this app is l8 without the timeline, not a second
 * dialect of the same file service.
 */
export const api = projectApi;
