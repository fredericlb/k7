// api.ts — two destinations. v1's own backend, same-origin: who you are, which machines exist,
// and which one this account cuts on. And the chosen machine's file service, cross-origin,
// which holds the project AND the footage — that half is @studio/project-shell's, shared with
// l8 and m9 so a route name cannot drift between them.
//
// There is no third destination. l8 has one (the moteur) and v1 does not: a cut has no audio,
// so nothing here needs a process that owns a sound card.

import { engineAccess } from "@studio/engine-browser/access";
import { projectApi } from "@studio/project-shell/project";
import type { PublicEngine } from "@studio/web-protocol";

// The app is mounted under a path (studio.test/v1), so every backend path below carries it.
// BASE_URL is vite's `base`; it ends in a slash, trimmed here so the literals keep reading as
// paths. Exported because the machine probe needs it too: the relay answers under this prefix.
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
 * Who is signed in, held at module level for the file service's header.
 *
 * Module state rather than a prop threaded through the app, because this SPA has one gate and
 * therefore one user for its whole life. Set once, by that gate, before anything below it
 * renders.
 */
let signedInAs = "";
export const currentUser = (): string => signedInAs;

export const auth = {
  // `return_to` is the name the OIDC package reads; `redirect` is silently ignored.
  loginUrl: `/auth/login?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`,

  me: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    const user = (await json<{ user: AuthUser }>(res, "auth/me")).user;
    signedInAs = user.email ?? user.sub ?? "";
    return user;
  },
};

// Everything this browser does to reach a machine: the registry routes every hosted service
// mounts, the probe, the policy and the lease, bound to `/v1` once. See
// @studio/engine-browser/docs/access.md.
export const engines = engineAccess<PublicEngine>(BASE, json);

/**
 * The open project, on the chosen machine. Every route here is the shared one — v1 adds none
 * of its own. The one it leans on that l8 does not is `videoDoc`.
 */
export const api = projectApi;

// The footage, streamed from the same machine. Re-exported so a component reaches for one
// import rather than knowing which package holds the transport.
export { mediaUrl } from "@studio/project-shell/fileApi";
