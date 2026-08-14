// api.ts — two destinations, and NEITHER is z0's backend. What this editor opens is a git
// repository the médiathèque owns, on the machine the account works from: so who you are and
// which engines exist come from st0 at the origin root, and the project's files come from
// that machine's file service, cross-origin, through @studio/project-shell.
//
// z0's own backend holds the game — its guest sessions, its Grist state, its one render
// engine named by environment. None of that answers "which repositories do I have", so
// pointing at it would have meant a second registry and a second login for one account.

import { engineAccess } from "@studio/engine-browser/access";
import { projectApi } from "@studio/project-shell/project";
import type { PublicEngine } from "@studio/web-protocol";
import { SERVICE_PATHS } from "@studio/web-protocol/services";

/** st0's prefix, which is the origin root — the empty string is a real entry in that table. */
const ST0 = SERVICE_PATHS.st0;

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} ${res.status}`);
  return (await res.json()) as T;
}

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
}

export const auth = {
  // A GETTER, not a constant: evaluated at import it captures whatever page happened to load
  // the module, so every later click returned you there instead of where you were.
  get loginUrl(): string {
    const here = window.location.pathname + window.location.search;
    return `${ST0}/auth/login?return_to=${encodeURIComponent(here)}`;
  },

  me: async (): Promise<AuthUser | null> => {
    const res = await fetch(`${ST0}/auth/me`);
    if (res.status === 401) return null;
    return (await json<{ user: AuthUser }>(res, "auth/me")).user;
  },
};

/** The five registry routes, the probe, the policy and the lease — bound to st0's prefix. */
export const engines = engineAccess<PublicEngine>(ST0, json);

/** The open project, on the engine's machine. Every route is the shared one. */
export const api = projectApi;
