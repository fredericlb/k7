// api.ts — two destinations, and NEITHER is z0's backend. What this editor opens is a git
// repository the médiathèque owns, on the machine the account works from: so which engines
// exist comes from pl8 (under `/pl8`), who you are comes from st0's `/auth/*` at the origin root,
// and the project's files come from that machine's file service, cross-origin, through
// @studio/project-shell.
//
// z0's own backend holds the game — its guest sessions, its Grist state, its one render
// engine named by environment. None of that answers "which repositories do I have", and
// pointing at it would mean a second registry and a second login for one account.

import { engineAccess } from "@studio/engine-browser/access";
import { projectApi } from "@studio/project-shell/project";
import type { PublicEngine } from "@studio/web-protocol";
import { SERVICE_PATHS } from "@studio/web-protocol/services";

/** Where pl8 answers; read from the table, which is the one place a prefix is spelled. */
const PL8 = SERVICE_PATHS.pl8;

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
  // A GETTER, and BARE `/auth/*`: a constant froze the return page, and the flow is prefixless.
  get loginUrl(): string {
    const here = window.location.pathname + window.location.search;
    return `/auth/login?return_to=${encodeURIComponent(here)}`;
  },

  me: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    return (await json<{ user: AuthUser }>(res, "auth/me")).user;
  },
};

/** The five registry routes, the probe, the policy and the lease — bound to pl8's prefix. */
export const engines = engineAccess<PublicEngine>(PL8, json);

/** The open project, on the engine's machine. Every route is the shared one. */
export const api = projectApi;
