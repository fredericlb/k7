// api.ts — the two servers this app talks to: the hosted backend (same-origin, for who
// you are and which engines exist) and the LOCAL file service (cross-origin, for the
// library itself). Same split as lanes, minus everything to do with a workspace — the
// mediatek is per machine.

import type { MediatekEntry } from "@studio/mediatek/types";
import type { PublicEngine } from "@studio/web-protocol";
import {
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
}

/** Where the file service is and how to prove we may ask it. */
export interface ServiceLink {
  base: string;
  user: string;
  token: string;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} ${res.status}`);
  return (await res.json()) as T;
}

export const backend = {
  loginUrl: `/auth/login?redirect=${encodeURIComponent(window.location.pathname)}`,

  /** The session's user, or null when anonymous. */
  me: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    return (await json<{ user: AuthUser }>(res, "auth/me")).user;
  },

  engines: async (): Promise<PublicEngine[]> =>
    json(await fetch("/api/engines"), "engines"),
};

/**
 * The file service's mediatek routes.
 *
 * The workspace header is sent EMPTY on purpose: these routes are mounted before
 * resolveWorkspace and never read it, and sending a made-up workspace name would be a
 * claim about a thing this app has no opinion on.
 */
export function library(link: ServiceLink) {
  const headers: Record<string, string> = {
    [USER_HEADER]: link.user,
    [WORKSPACE_HEADER]: "",
    ...(link.token ? { [ENGINE_TOKEN_HEADER]: link.token } : {}),
  };
  const get = async <T>(path: string, what: string): Promise<T> =>
    json(await fetch(`${link.base}${path}`, { headers }), what);

  return {
    summary: () =>
      get<{
        present: boolean;
        root: string;
        counts: Record<string, number>;
      }>("/mediatek", "mediatek"),

    revisions: () =>
      get<{ present: boolean; revisions: Record<string, string> }>(
        "/mediatek/revision",
        "revision",
      ),

    list: (family: string) =>
      get<{ family: string; rev: string; entries: MediatekEntry[] }>(
        `/mediatek/list?family=${encodeURIComponent(family)}`,
        "list",
      ),
  };
}
