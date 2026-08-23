// service.ts — the CHOSEN machine's file service, the only thing that knows where the
// médiathèque's cache sits on that disk. m9 needs it because the moteur opens file
// paths, not URLs, and the paths are that machine's. The same route, written down:
// apps/pl8/docs/playback.md, « Deux disques ».

import type { MediatekEntry } from "@studio/mediatek/types";
import { fileHeaders } from "@studio/project-shell/fileApi";
import type { SeparateJob, StemsReply } from "@studio/web-protocol";
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
 * WHERE the hosted library answers — pl8's API, on the ORIGIN this desk is served from.
 *
 * The package's second seam, and it was one until the stem cut moved. It exists because pl8
 * holds the masters and therefore owns the work done to them, where the file service holds a
 * machine and lends it: two services, two questions, two links.
 *
 * A base rather than a derived path, because the prefix differs by host — pl8 answers at `/api`
 * on its own origin and at `/pl8/api` from st0's — and a package that guessed would be wrong for
 * one of them. Supplied by the host, exactly as `engine` is.
 */
export interface LibraryLink {
  base: string;
}

/**
 * The headers a file-service call needs — the SHARED set, not a second dialect.
 *
 * There are three, and this file used to send one. The two missing ones are not optional:
 * `requireEngineToken` gates the whole service before `/mediatek` is even mounted, so a call
 * without the engine token is a 401 whatever it asks for — which is exactly what a deck got,
 * on every machine where a token is configured. The token comes from the engine's own whoami
 * probe and only the gate has it, so taking the header set from `@studio/project-shell` is
 * both the fix and the rule m9's AGENTS.md already states: a route m9 needs and st0 has goes
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

// `post` stood here — the file-service counterpart of `get`, and the only thing that used it was
// `prepareStems`. The cut moved to the library, so the file service is a read-only surface for
// this package now: the catalogue, an envelope, a module's text. Nothing here writes to a
// machine. The library's own pair is below, and it carries a cookie rather than the headers.

/**
 * The same pair again, for the LIBRARY — and the difference is the credential.
 *
 * pl8 verifies the session cookie every studio service shares; the file service gates on the
 * three `x-studio-*` headers instead, because it sits on a machine that has no cookie jar. So
 * these cannot route through `get`/`post` above: sending `fileHeaders()` at pl8 would be a 401
 * carrying an engine token nobody there can check, and `credentials` is what a cross-prefix call
 * from st0's origin needs.
 */
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

/** The SERVER's sentence out of an error body, or nothing. The same reading `get` does, written
 *  once now that four functions want it — a surface can only be as honest as its error. */
async function said(res: Response): Promise<string | undefined> {
  return res
    .json()
    .then((b: { error?: string }) => b?.error)
    .catch(() => undefined);
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

  /**
   * Separate one song, so this deck's stem knobs have something to subtract.
   *
   * On the LIBRARY, not on the file service, and that is the whole of what changed here: pl8
   * holds the masters, so pl8 owns the cut. It borrows the named engine's model over `/process`
   * and keeps the stems on its own volume — nothing of the library is mirrored onto a machine
   * any more. See apps/pl8/docs/stems.md.
   *
   * `engineId` travels because the library has no opinion about which machine is yours; it is
   * the engine this desk is already on. A CHAIN still does not travel: which module separates
   * and which `.onnx` a machine holds is that machine's one answer, given once to
   * `system stems`, and a desk that sent one would be a third place to spell it.
   *
   * Cheap to call on a record that is already prepared: the reply says `ready` and nothing
   * starts. Cheap to call twice, too — the job id hashes the WORK, so a second tab joins the
   * run in flight (apps/pl8/docs/stems.md).
   */
  prepareStems: (l: LibraryLink, song: string, engineId: string) =>
    libraryPost<StemsReply>(l, "/stems", { song, engineId }),

  /** How a separation is getting on. 404s once the library has forgotten a finished job, which
   *  the caller reads as "look at the disk" rather than as a failure — the same contract the
   *  file service's `/separate/:id` had, answered by whoever now owns the work. */
  separation: (l: LibraryLink, id: string) =>
    libraryGet<SeparateJob>(l, `/stems/${encodeURIComponent(id)}`),

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
