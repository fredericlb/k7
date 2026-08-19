// service.ts — the CHOSEN machine's file service, the only thing that knows where the
// médiathèque's cache sits on that disk. m9 needs it because the moteur opens file
// paths, not URLs, and the paths are that machine's. The same route, written down:
// apps/st0/docs/playback.md, « Deux disques ».

import type { MediatekEntry } from "@studio/mediatek/types";
import { fileHeaders } from "@studio/project-shell/fileApi";
import type { Envelope } from "./waveform";

/**
 * WHERE one machine's file service is, as the chosen engine reported it.
 *
 * It used to be a text box defaulting to `http://127.0.0.1:8770`, beside a second box the DJ
 * typed their own identity into — which the file service then trusted. The address now comes
 * from the engine's own probe reply, because the file service sits on the engine's host and
 * only the engine knows which host that is.
 *
 * The identity is NOT here any more. It travels with the other two headers the service wants,
 * from the transport the gate configured (`fileHeaders`) — one place, so a call cannot be
 * made with a partial set again.
 */
export interface FileLink {
  base: string;
}

/** The link for a chosen engine. Null when the probe found no file service on its host. */
export function fileLink(engine: { fileBase: string | null }): FileLink | null {
  return engine.fileBase ? { base: engine.fileBase } : null;
}

/**
 * The headers a file-service call needs — the SHARED set, not a second dialect.
 *
 * There are three, and this file used to send one. The two missing ones are not optional:
 * `requireEngineToken` gates the whole service before `/mediatek` is even mounted, so a call
 * without the engine token is a 401 whatever it asks for — which is exactly what a deck got,
 * on every machine where a token is configured. The token comes from the engine's own whoami
 * probe and only the gate has it, so taking the header set from `@studio/project-shell` is
 * both the fix and the rule m9's AGENTS.md already states: a route m9 needs and l8 has goes
 * through the package.
 *
 * Safe to call here because `ProjectGate` configures the transport before `Studio` — and so
 * before any view — renders. Nothing in m9 reaches the médiathèque outside the gate.
 */
async function get<T>(s: FileLink, path: string): Promise<T> {
  const res = await fetch(`${s.base}${path}`, { headers: fileHeaders() });
  if (!res.ok) {
    // The SERVER's sentence, not just its number. Every route here answers `{error}` with
    // something actionable — "engine binary not found", "is not in this cache" — and this
    // used to throw the bare status, turning each of them into `→ 503`. A surface can only
    // be as honest as the error it is handed.
    const said = await res
      .json()
      .then((b: { error?: string }) => b?.error)
      .catch(() => undefined);
    throw new Error(said || `${path} → ${res.status}`);
  }
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

  /**
   * One cached song's waveform envelope, transients and tempo.
   *
   * Slow the first time for a song nobody has analysed — the engine on that machine computes
   * the sidecar — and a read afterwards. The caller shows that it is working rather than an
   * empty box, because "no waveform yet" and "no waveform at all" look identical otherwise.
   */
  envelope: (s: FileLink, path: string) =>
    get<Envelope>(s, `/mediatek/envelope?path=${encodeURIComponent(path)}`),

  /** One cached file's text. The deck needs a module's `plugin:` block, and the catalogue
   *  carries where a module IS, never what it runs. */
  moduleFile: async (s: FileLink, path: string): Promise<string> => {
    const res = await fetch(
      `${s.base}/mediatek/file?path=${encodeURIComponent(path)}`,
      // The same three headers as every other call — this route is behind the same gate.
      // Not routed through `get` because the reply is TEXT: a module's `plugin:` block.
      { headers: fileHeaders() },
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
/**
 * The entry's master, CACHE-relative (`songs/artist/album/title/original.mp3`).
 *
 * The half of a playable path that does not depend on which machine holds the cache — which
 * is exactly what a route taking a cache-relative `path` wants, and what `playablePath`
 * prefixes a root onto. Written once so the two cannot disagree about where a master is.
 */
export function cacheRelPath(
  entry: MediatekEntry,
  /** The audio inside the folder. Omitted is the MASTER, which is every caller that has not
   *  got a set list line in its hand; a playlist naming a variant passes that variant's file,
   *  and without this the desk would silently put the original on the deck. */
  file?: string | null,
): string | null {
  const name = file ?? entry.meta?.master;
  if (typeof name !== "string" || !name) return null;
  return `${entry.path}/${name}`;
}

export function playablePath(
  root: string,
  entry: MediatekEntry,
  file?: string | null,
): string | null {
  const master = file ?? entry.meta?.master;
  if (typeof master !== "string" || !master) return null;
  // The service reports a native root ("C:\…" or "/home/…") while entry paths are POSIX,
  // and the engine takes either — so they are joined with a separator picked from the root
  // rather than normalised into one shape this app has no business choosing.
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return [root, entry.path, master].join(sep);
}
