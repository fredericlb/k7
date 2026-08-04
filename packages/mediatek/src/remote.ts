// remote.ts — the hosted library over HTTP, as the local cache sees it. A thin client, and
// the PORT the sync is written against: `LibrarySource` is what a cache needs, so a test
// supplies one without a server and the sync never knows the difference.

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Manifest } from "./manifest.ts";
import type { Family, FamilyListing } from "./types.ts";

/**
 * What a cache needs from whatever owns the library.
 *
 * `download` takes a destination rather than returning bytes: a sample pack is one thing,
 * a video is another, and a port that hands back a buffer makes holding a whole file in
 * memory the only option. The owner decides how the bytes travel.
 */
export interface LibrarySource {
  revisions(): Promise<Record<Family, string>>;
  manifest(family: Family): Promise<Manifest>;
  download(path: string, dest: string): Promise<void>;
}

export interface RemoteConfig {
  /** The library's fixed address — `https://studio.frediver.se` in production, since st0
   *  answers the origin root. Derived by every caller, never typed:
   *  see `@studio/web-protocol/services` and docs/tokens.md. */
  base: string;
  /** A personal access token — a headless service has no cookie jar. */
  token?: string;
}

export class RemoteError extends Error {}

/** The hosted service as a `LibrarySource`. */
export function remoteLibrary(cfg: RemoteConfig): LibrarySource {
  const url = (path: string): string =>
    `${cfg.base.replace(/\/+$/, "")}/api/mediatek${path}`;
  const headers: Record<string, string> = cfg.token
    ? { authorization: `Bearer ${cfg.token}` }
    : {};

  const get = async (path: string): Promise<Response> => {
    const res = await fetch(url(path), { headers });
    if (!res.ok)
      throw new RemoteError(
        `mediatek ${path}: ${res.status} ${res.statusText}`,
      );
    return res;
  };

  return {
    revisions: async () =>
      (
        (await (await get("/revision")).json()) as {
          revisions: Record<Family, string>;
        }
      ).revisions,

    manifest: async (family) =>
      (
        (await (
          await get(`/manifest?family=${encodeURIComponent(family)}`)
        ).json()) as { files: Manifest }
      ).files,

    async download(path, dest) {
      const res = await get(`/file?path=${encodeURIComponent(path)}`);
      if (!res.body) throw new RemoteError(`mediatek ${path}: empty response`);
      mkdirSync(dirname(dest), { recursive: true });
      // Streamed to disk: a video must never be held whole in memory on the way through.
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    },
  };
}

/**
 * Where a library's content is PUT. Separate from `LibrarySource` on purpose: a cache
 * only ever reads, and giving it a port it could write through would make "which side
 * owns this" a question the type system stops answering.
 */
export interface LibrarySink {
  put(path: string, body: Uint8Array | string): Promise<void>;
  remove(path: string): Promise<void>;
  /** A whole subtree. Its own method for the same reason it is its own route: removing a
   *  folder must never be something a caller does while meaning to remove one entry. */
  removeTree(path: string): Promise<void>;
}

/** The hosted service as a `LibrarySink`. */
export function remoteWriter(cfg: RemoteConfig): LibrarySink {
  const url = (path: string): string =>
    `${cfg.base.replace(/\/+$/, "")}/api/mediatek${path}`;
  const auth: Record<string, string> = cfg.token
    ? { authorization: `Bearer ${cfg.token}` }
    : {};

  const send = async (
    method: string,
    path: string,
    body?: string | Uint8Array,
    route = "/file",
  ) => {
    const res = await fetch(
      url(`${route}?path=${encodeURIComponent(path)}`),
      // Octet-stream regardless of what it is: the library files by extension, and a
      // guessed content type here would be a second, quieter opinion about the same thing.
      {
        method,
        headers: body
          ? { ...auth, "content-type": "application/octet-stream" }
          : auth,
        // Uint8Array is a valid body for undici's fetch; TS's lib types just predate it.
        body: body as string | undefined,
      },
    );
    if (!res.ok)
      throw new RemoteError(
        `mediatek ${method} ${path}: ${res.status} ${res.statusText}`,
      );
  };

  return {
    put: (path, body) => send("PUT", path, body),
    remove: (path) => send("DELETE", path),
    removeTree: (path) => send("DELETE", path, undefined, "/folder"),
  };
}

/**
 * Push one audio file in as a SONG. Like `pushRecording`, the caller sends what it knows —
 * the three tags — and the library builds the path.
 *
 * `source` is the only provenance left, and it is a note rather than a location: it says
 * `k7` for a published version, `upload` for the médiathèque's own button, `mirror` for one
 * pulled. There is no `kind`, because `songs/` no longer files by where a master came from
 * — see `songFolder`.
 */
export async function pushSong(
  cfg: RemoteConfig,
  opts: {
    filename: string;
    bytes: Uint8Array;
    artist?: string;
    album?: string;
    title?: string;
    source?: string;
    replace?: boolean;
  },
): Promise<{ path: string; master: string; replaced: boolean }> {
  const q = new URLSearchParams({ filename: opts.filename });
  for (const k of ["artist", "album", "title", "source"] as const)
    if (opts[k]) q.set(k, opts[k] as string);
  if (opts.replace) q.set("replace", "1");
  const res = await fetch(
    `${cfg.base.replace(/\/+$/, "")}/api/mediatek/song?${q}`,
    {
      method: "POST",
      headers: {
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
        "content-type": "application/octet-stream",
      },
      body: opts.bytes as unknown as string,
    },
  );
  if (!res.ok)
    throw new RemoteError(`mediatek song: ${res.status} ${res.statusText}`);
  return (await res.json()) as {
    path: string;
    master: string;
    replaced: boolean;
  };
}

/**
 * Push one capture into the raw zone. The library names the file; the caller does not.
 *
 * Separate from `LibrarySink` deliberately: a sink writes to a path it chose, and this is
 * the opposite arrangement — bytes plus the moment they were captured, from which the
 * library derives `recordings/<YYYY-MM-DD>/<HH-MM-SS>.<ext>`. `filename` is read for its
 * EXTENSION only. See docs/recordings.md.
 */
export async function pushRecording(
  cfg: RemoteConfig,
  opts: {
    filename: string;
    bytes: Uint8Array;
    at?: Date;
    /** Present == a MOMENT cut out of a session, named as one. See `momentStem`. */
    durationSec?: number;
    label?: string;
  },
): Promise<{ path: string; day: string; name: string }> {
  const q = new URLSearchParams({ filename: opts.filename });
  // Omitted rather than defaulted to now: the server's clock is the better answer when the
  // caller has none, and it already applies that rule.
  if (opts.at) q.set("at", opts.at.toISOString());
  if (opts.durationSec !== undefined)
    q.set("duration", String(opts.durationSec));
  if (opts.label) q.set("label", opts.label);
  const res = await fetch(
    `${cfg.base.replace(/\/+$/, "")}/api/mediatek/recording?${q}`,
    {
      method: "POST",
      headers: {
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
        "content-type": "application/octet-stream",
      },
      // Uint8Array is a valid body for undici's fetch; TS's lib types just predate it,
      // and a service typechecked without the DOM lib has no `BodyInit` to name either.
      body: opts.bytes as unknown as string,
    },
  );
  if (!res.ok)
    throw new RemoteError(
      `mediatek recording: ${res.status} ${res.statusText}`,
    );
  return (await res.json()) as { path: string; day: string; name: string };
}

/** The catalogue as the hosted service reports it — what a surface LISTS, as opposed to
 *  what this machine happens to hold. */
export async function remoteListing(
  cfg: RemoteConfig,
  family: Family,
): Promise<FamilyListing> {
  const res = await fetch(
    `${cfg.base.replace(/\/+$/, "")}/api/mediatek/list?family=${encodeURIComponent(family)}`,
    { headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {} },
  );
  if (!res.ok)
    throw new RemoteError(`mediatek list: ${res.status} ${res.statusText}`);
  return (await res.json()) as FamilyListing;
}
