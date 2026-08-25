// service.ts — the CHOSEN machine's file service, the only thing that knows where the
// médiathèque's cache sits on that disk. The desk needs it because the moteur opens file
// paths, not URLs, and the paths are that machine's. The same route, written down:
// apps/pl8/docs/playback.md, « Deux disques ».

import type { MediatekEntry } from "@studio/mediatek/types";
import { fileHeaders } from "@studio/project-shell/fileApi";
import type { SeparateJob, StemsReply } from "@studio/web-protocol";
import type { Envelope } from "./waveform";

/** WHERE one machine's file service is, from the engine's own probe — the identity is in `fileHeaders`. */
export interface FileLink {
  base: string;
}

/** The link for a chosen engine. Null when the probe found no file service on its host. */
export function fileLink(engine: { fileBase: string | null }): FileLink | null {
  return engine.fileBase ? { base: engine.fileBase } : null;
}

/** WHERE the hosted library answers — a BASE, since the prefix differs by host. See ../docs/hosting.md. */
export interface LibraryLink {
  base: string;
}

/** A file-service call, with the SHARED three headers — all three are gated, see ../docs/hosting.md. */
async function get<T>(s: FileLink, path: string): Promise<T> {
  const res = await fetch(`${s.base}${path}`, { headers: fileHeaders() });
  if (!res.ok) {
    // The SERVER's sentence, not just its number — a surface is only as honest as its error.
    const said = await res
      .json()
      .then((b: { error?: string }) => b?.error)
      .catch(() => undefined);
    throw new Error(said || `${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

// No `post`: the cut goes to the library, so the file service is READ-ONLY for this package.

/** The same pair for the LIBRARY, and the difference is the credential — a cookie, see ../docs/hosting.md. */
async function libraryGet<T>(l: LibraryLink, path: string): Promise<T> {
  const res = await fetch(`${l.base}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error((await said(res)) || `${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function libraryPost<T>(
  l: LibraryLink,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${l.base}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await said(res)) || `${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** The SERVER's sentence out of an error body, or nothing — a surface is only as honest as its error. */
async function said(res: Response): Promise<string | undefined> {
  return res
    .json()
    .then((b: { error?: string }) => b?.error)
    .catch(() => undefined);
}

export interface CacheSummary {
  present: boolean;
  /** The cache's ABSOLUTE root on this machine — an entry's own `path` is relative to it. */
  root: string;
  counts: Record<string, number>;
}

export const service = {
  summary: (s: FileLink) => get<CacheSummary>(s, "/mediatek"),

  songs: (s: FileLink) =>
    get<{ entries: MediatekEntry[] }>(s, "/mediatek/list?family=songs"),

  modules: (s: FileLink) =>
    get<{ entries: MediatekEntry[] }>(s, "/mediatek/list?family=modules"),

  /** One cached song's envelope, transients and tempo — slow the first time, a read afterwards. */
  envelope: (s: FileLink, path: string) =>
    get<Envelope>(s, `/mediatek/envelope?path=${encodeURIComponent(path)}`),

  /** Separate one song, on the LIBRARY: pl8 holds the masters, so pl8 owns the cut — ../docs/stems.md. */
  prepareStems: (l: LibraryLink, song: string, engineId: string) =>
    libraryPost<StemsReply>(l, "/stems", { song, engineId }),

  /** Are this song's stems already on the volume? A READ — `prepareStems` starts a job, so it cannot ask. */
  stemsHeld: (l: LibraryLink, song: string) =>
    libraryGet<StemsReply>(l, `/stems/held?song=${encodeURIComponent(song)}`),

  /** How a separation is going — 404 once a finished job is swept, which the caller reads as "ask the disk". */
  separation: (l: LibraryLink, id: string) =>
    libraryGet<SeparateJob>(l, `/stems/${encodeURIComponent(id)}`),

  /** One cached file's text — the catalogue carries where a module IS, never what it runs. */
  moduleFile: async (s: FileLink, path: string): Promise<string> => {
    const res = await fetch(
      `${s.base}/mediatek/file?path=${encodeURIComponent(path)}`,
      // Not routed through `get` because the reply is TEXT: a module's `plugin:` block.
      { headers: fileHeaders() },
    );
    if (!res.ok) throw new Error(`module ${res.status}`);
    return res.text();
  },
};

/** The entry's master, CACHE-relative — the half of a playable path that names no machine. */
export function cacheRelPath(
  entry: MediatekEntry,
  /** The audio inside the folder — omitted is the MASTER; a set list line passes its own variant. */
  file?: string | null,
): string | null {
  const name = file ?? entry.meta?.master;
  if (typeof name !== "string" || !name) return null;
  return `${entry.path}/${name}`;
}

/** A catalogue entry as a file the engine can open, or null — a folder with a sidecar and no audio. */
export function playablePath(
  root: string,
  entry: MediatekEntry,
  file?: string | null,
): string | null {
  const master = file ?? entry.meta?.master;
  if (typeof master !== "string" || !master) return null;
  // The root is NATIVE and entry paths are POSIX, and the engine takes either — so join by the root's.
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return [root, entry.path, master].join(sep);
}
