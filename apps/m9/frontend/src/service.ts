// service.ts — the CHOSEN machine's file service, the only thing that knows where the
// médiathèque's cache sits on that disk. m9 needs it because the moteur opens file
// paths, not URLs, and the paths are that machine's. See docs/plumbing.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import { USER_HEADER } from "@studio/web-protocol";

/**
 * How to reach ONE machine's file service, as the chosen engine reported it.
 *
 * Both halves used to be typed into text boxes: the address defaulted to
 * `http://127.0.0.1:8770`, and the DJ wrote their own identity into a second box which the
 * file service then trusted. Now the address comes from the engine's own probe reply — the
 * file service sits on the same host as the engine, and only the engine knows which host
 * that is — and the identity comes from the session.
 */
export interface FileLink {
  base: string;
  /** The signed-in identity. The file service files workspaces under it and gates the
   *  médiathèque routes on it, so it is required even though m9 opens no workspace. */
  user: string;
}

/** The link for a chosen engine. Null when the probe found no file service on its host. */
export function fileLink(
  engine: { fileBase: string | null },
  user: string,
): FileLink | null {
  return engine.fileBase ? { base: engine.fileBase, user } : null;
}

async function get<T>(s: FileLink, path: string): Promise<T> {
  const res = await fetch(`${s.base}${path}`, {
    headers: { [USER_HEADER]: s.user },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export interface CacheSummary {
  present: boolean;
  /** The cache's ABSOLUTE root on this machine — the half of a playable path the catalogue
   *  cannot carry, since an entry's own `path` is relative to it. */
  root: string;
  counts: Record<string, number>;
}

export const service = {
  summary: (s: FileLink) => get<CacheSummary>(s, "/mediatek"),

  songs: (s: FileLink) =>
    get<{ entries: MediatekEntry[] }>(s, "/mediatek/list?family=songs"),

  modules: (s: FileLink) =>
    get<{ entries: MediatekEntry[] }>(s, "/mediatek/list?family=modules"),

  /** One cached file's text. The deck needs a module's `plugin:` block, and the catalogue
   *  carries where a module IS, never what it runs. */
  moduleFile: async (s: FileLink, path: string): Promise<string> => {
    const res = await fetch(
      `${s.base}/mediatek/file?path=${encodeURIComponent(path)}`,
      { headers: { [USER_HEADER]: s.user } },
    );
    if (!res.ok) throw new Error(`module ${res.status}`);
    return res.text();
  },
};

/**
 * A catalogue entry as a file the engine can open, or null.
 *
 * Null happens for a real reason and is not a failure to handle quietly: a song is a
 * FOLDER, and one that carries a sidecar but no audio yet — a mirror that failed halfway,
 * a folder someone made by hand — has nothing to play. The scan reports the master's
 * filename in `meta.master`; its absence is that state.
 */
export function playablePath(
  root: string,
  entry: MediatekEntry,
): string | null {
  const master = entry.meta?.master;
  if (typeof master !== "string" || !master) return null;
  // The service reports a native root ("C:\…" or "/home/…") while entry paths are POSIX,
  // and the engine takes either — so they are joined with a separator picked from the root
  // rather than normalised into one shape this app has no business choosing.
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return [root, entry.path, master].join(sep);
}
