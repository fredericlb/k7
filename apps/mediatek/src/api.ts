// api.ts — one server now: the mediatek's own backend, same-origin. The catalogue lives
// there, so browsing it needs no engine and no local service. The LOCAL cache is what the
// moteur plays from, and nothing on this screen reads it.

import type { MediatekEntry } from "@studio/mediatek/types";

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} ${res.status}`);
  return (await res.json()) as T;
}

const get = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`/api/mediatek${path}`), what);

export const auth = {
  loginUrl: `/auth/login?redirect=${encodeURIComponent(window.location.pathname)}`,

  /** The session's user, or null when anonymous. */
  me: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    return (await json<{ user: AuthUser }>(res, "auth/me")).user;
  },
};

export const library = {
  summary: () =>
    get<{ present: boolean; counts: Record<string, number> }>("", "mediatek"),

  revisions: () =>
    get<{ present: boolean; revisions: Record<string, string> }>(
      "/revision",
      "revision",
    ),

  list: (family: string) =>
    get<{ family: string; rev: string; entries: MediatekEntry[] }>(
      `/list?family=${encodeURIComponent(family)}`,
      "list",
    ),

  /** A file's bytes, for an <audio>/<video> src. Served with Range, so seeking works. */
  fileUrl: (path: string) =>
    `/api/mediatek/file?path=${encodeURIComponent(path)}`,

  /** One file's text. The library serves bytes; a module is YAML, so this reads it back. */
  readFile: async (
    path: string,
  ): Promise<{ path: string; content: string }> => {
    const res = await fetch(
      `/api/mediatek/file?path=${encodeURIComponent(path)}`,
    );
    if (!res.ok) throw new Error(`file ${res.status}`);
    return { path, content: await res.text() };
  },

  /** Write one file back. The library replaces — there is no fork, see docs/ingest.md. */
  writeFile: async (path: string, content: string): Promise<void> => {
    const res = await fetch(
      `/api/mediatek/file?path=${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: content,
      },
    );
    if (!res.ok) throw new Error(`write ${res.status}`);
  },
};
