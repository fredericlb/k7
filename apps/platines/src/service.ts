// service.ts — the machine's own file service, which is the only thing that knows where
// the médiathèque's CACHE sits on this disk. platines needs that because the moteur opens
// file paths, not URLs. See docs/plumbing.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import { USER_HEADER } from "@studio/web-protocol";

/** Where the local service listens, unless told otherwise. Matches its own LANES_FILE_PORT
 *  default — a constant on both sides rather than a discovery handshake this app does not
 *  need, since it only ever talks to the machine it is running on. */
export const DEFAULT_SERVICE = "http://127.0.0.1:8770";

export interface Settings {
  service: string;
  /** The identity the file service files workspaces under. It gates the médiathèque routes
   *  too, so it is required even though platines never opens a workspace. */
  user: string;
}

const KEY = "platines.settings";

export function loadSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "");
    return { service: String(v.service), user: String(v.user) };
  } catch {
    return { service: DEFAULT_SERVICE, user: "" };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

async function get<T>(s: Settings, path: string): Promise<T> {
  const res = await fetch(`${s.service}${path}`, {
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
  summary: (s: Settings) => get<CacheSummary>(s, "/mediatek"),

  morceaux: (s: Settings) =>
    get<{ entries: MediatekEntry[] }>(s, "/mediatek/list?family=morceaux"),

  modules: (s: Settings) =>
    get<{ entries: MediatekEntry[] }>(s, "/mediatek/list?family=modules"),

  /** One cached file's text. The deck needs a module's `plugin:` block, and the catalogue
   *  carries where a module IS, never what it runs. */
  moduleFile: async (s: Settings, path: string): Promise<string> => {
    const res = await fetch(
      `${s.service}/mediatek/file?path=${encodeURIComponent(path)}`,
      { headers: { [USER_HEADER]: s.user } },
    );
    if (!res.ok) throw new Error(`module ${res.status}`);
    return res.text();
  },
};

/**
 * A catalogue entry as a file the engine can open, or null.
 *
 * Null happens for a real reason and is not a failure to handle quietly: a morceau is a
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
