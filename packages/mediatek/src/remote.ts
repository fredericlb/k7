// remote.ts — the hosted library over HTTP, as the local cache sees it. A thin client, and
// the PORT the sync is written against: `LibrarySource` is what a cache needs, so a test
// supplies one without a server and the sync never knows the difference.

import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Manifest } from "./manifest.ts";
import type { Family, FamilyListing } from "./types.ts";

/** What a cache needs from whatever owns the library; `download` takes a destination so a video never sits in memory. */
export interface LibrarySource {
  revisions(): Promise<Record<Family, string>>;
  manifest(family: Family): Promise<Manifest>;
  download(path: string, dest: string): Promise<void>;
}

export interface RemoteConfig {
  /** The library's fixed address, DERIVED by every caller and never typed — `@studio/web-protocol/services`. */
  base: string;
  /** A personal access token — a headless service has no cookie jar. */
  token?: string;
}

export class RemoteError extends Error {}

/** Everything an `Error` knows, its `cause` chain flattened into the message — see docs/sync.md. */
function why(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  // Bounded: `cause` is caller-supplied and nothing forbids a cycle.
  for (let i = 0; cur instanceof Error && i < 5; i++) {
    const code = (cur as { code?: string }).code;
    parts.push(code ? `${cur.message} (${code})` : cur.message);
    cur = cur.cause;
  }
  return parts.join(" ← ") || String(e);
}

/** The hosted service as a `LibrarySource`. */
export function remoteLibrary(cfg: RemoteConfig): LibrarySource {
  const url = (path: string): string =>
    `${cfg.base.replace(/\/+$/, "")}/api/mediatek${path}`;
  const headers: Record<string, string> = cfg.token
    ? { authorization: `Bearer ${cfg.token}` }
    : {};

  const get = async (path: string): Promise<Response> => {
    let res: Response;
    try {
      res = await fetch(url(path), { headers });
    } catch (e) {
      // The ADDRESS, not just the path: it is derived, so which library it tried is half the answer.
      throw new RemoteError(`mediatek GET ${url(path)}: ${why(e)}`);
    }
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

    /** One file onto the disk, through a TEMPORARY name so a truncated master never appears — docs/sync.md. */
    async download(path, dest) {
      const res = await get(`/file?path=${encodeURIComponent(path)}`);
      if (!res.body) throw new RemoteError(`mediatek ${path}: empty response`);
      mkdirSync(dirname(dest), { recursive: true });
      const part = `${dest}.part`;
      try {
        // Streamed to disk: a video must never be held whole in memory on the way through.
        await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
        renameSync(part, dest);
      } catch (e) {
        rmSync(part, { force: true }); // never leave half a file to be mistaken for a whole one
        // `terminated` alone says only "the body stopped"; the cause says which of six things it was.
        throw new RemoteError(
          `mediatek GET ${url(`/file`)} ${path}: ${why(e)}`,
        );
      }
    },
  };
}

/** Where a library's content is PUT — separate from `LibrarySource`, because a cache only ever reads. */
export interface LibrarySink {
  put(path: string, body: Uint8Array | string): Promise<void>;
  remove(path: string): Promise<void>;
  /** A whole subtree — its own method, so removing a folder is never done while meaning one entry. */
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
    const at = url(`${route}?path=${encodeURIComponent(path)}`);
    let res: Response;
    try {
      res = await fetch(
        at,
        // Octet-stream regardless: the library files by extension, and a guess here would be a second opinion.
        {
          method,
          headers: body
            ? { ...auth, "content-type": "application/octet-stream" }
            : auth,
          // Uint8Array is a valid body for undici's fetch; TS's lib types just predate it.
          body: body as string | undefined,
        },
      );
    } catch (e) {
      // Same reason the reader says the address: a write that cannot reach is usually aimed wrong.
      throw new RemoteError(`mediatek ${method} ${at}: ${why(e)}`);
    }
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

/** Push one audio file in as a SONG: the caller sends the three tags, the library builds the path (docs/songs.md). */
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

/** Push one capture into the raw zone: bytes plus a moment, and the library names the file — docs/recordings.md. */
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
  // Omitted rather than defaulted to now: the server's clock is the better answer, and it applies it.
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
      // Uint8Array is a valid body for undici's fetch; TS's lib types just predate it.
      body: opts.bytes as unknown as string,
    },
  );
  if (!res.ok)
    throw new RemoteError(
      `mediatek recording: ${res.status} ${res.statusText}`,
    );
  return (await res.json()) as { path: string; day: string; name: string };
}

/** Tell the library a song's detected tempo, one way and never overwriting — see docs/songs.md. */
export async function pushSongBpm(
  cfg: RemoteConfig,
  folder: string,
  bpm: number,
): Promise<{ set: boolean }> {
  const res = await fetch(`${cfg.base.replace(/\/+$/, "")}/api/mediatek/bpm`, {
    method: "POST",
    headers: {
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({ path: folder, bpm }),
  });
  if (!res.ok)
    throw new RemoteError(`mediatek bpm: ${res.status} ${res.statusText}`);
  return (await res.json()) as { set: boolean };
}
