// remote.ts — the hosted library over HTTP, as the local cache sees it. A thin client, and
// the PORT the sync is written against: `LibrarySource` is what a cache needs, so a test
// supplies one without a server and the sync never knows the difference.

import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Manifest } from "./manifest.ts";
import { placeFile } from "./place.ts";
import type { Family } from "./types.ts";

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
  /** Where the library answers under `base`: `/api/mediatek`, or `/api/sync/mediatek` for a paired device. */
  route?: string;
}

export class RemoteError extends Error {}

/** The library's own measurement of a file: computed once there and kept in its cache. */
export interface RemoteEnvelope {
  sampleRate: number;
  seconds: number;
  rms: number[];
  transients: number[];
  /** Per-bucket peak and the three band peaks, in the same buckets; absent from an older server. */
  peak?: number[];
  low?: number[];
  mid?: number[];
  high?: number[];
}

/** The hosted service: a `LibrarySource`, plus what only a browser-facing host asks of it. */
export interface RemoteLibrary extends LibrarySource {
  /** Like `download`, through `/stream`: a FLAC lands as its MP3 transcode, anything else unchanged. */
  stream(path: string, dest: string): Promise<void>;
  envelope(path: string): Promise<RemoteEnvelope>;
}

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
export function remoteLibrary(cfg: RemoteConfig): RemoteLibrary {
  const url = (path: string): string =>
    `${cfg.base.replace(/\/+$/, "")}${cfg.route ?? "/api/mediatek"}${path}`;
  const headers: Record<string, string> = cfg.token
    ? { authorization: `Bearer ${cfg.token}` }
    : {};

  const get = async (
    path: string,
    timeoutMs = 10 * 60_000,
  ): Promise<Response> => {
    let res: Response;
    try {
      // Bounded, body included — a file comes this way too, so minutes, never for ever.
      res = await fetch(url(path), {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
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

    download: (path, dest) => toDisk("/file", path, dest),
    stream: (path, dest) => toDisk("/stream", path, dest),

    // The library may measure the file first, hours of audio: minutes, not for ever.
    envelope: async (path) =>
      (await (
        await get(`/envelope?path=${encodeURIComponent(path)}`, 5 * 60_000)
      ).json()) as RemoteEnvelope,
  };

  /** One file onto the disk, through a TEMPORARY name so a truncated master never appears — docs/sync.md. */
  async function toDisk(route: string, path: string, dest: string) {
    const res = await get(`${route}?path=${encodeURIComponent(path)}`);
    if (!res.body) throw new RemoteError(`mediatek ${path}: empty response`);
    mkdirSync(dirname(dest), { recursive: true });
    // A random suffix, not just `.part`: two callers racing a cache miss for the SAME dest
    // must never share one temp file — the first to rename would delete it out from under
    // the second, which then fails the rename with an ENOENT that names no real cause.
    const part = `${dest}.${randomUUID()}.part`;
    try {
      // Streamed to disk: a video must never be held whole in memory on the way through.
      await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
      // `dest` may be the master the engine is playing — docs/rename.md.
      await placeFile(part, dest);
    } catch (e) {
      rmSync(part, { force: true }); // never leave half a file to be mistaken for a whole one
      // `terminated` alone says only "the body stopped"; the cause says which of six things it was.
      throw new RemoteError(`mediatek GET ${url(route)} ${path}: ${why(e)}`);
    }
  }
}

/** Where a library's content is PUT — separate from `LibrarySource`, because a cache only ever reads. */
interface LibrarySink {
  put(path: string, body: Uint8Array | Blob | string): Promise<void>;
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
    body?: string | Uint8Array | Blob,
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
          signal: AbortSignal.timeout(30 * 60_000),
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
    // A file-backed Blob (fs.openAsBlob) streams from disk; fetch sends either.
    bytes: Uint8Array | Blob;
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
      signal: AbortSignal.timeout(30 * 60_000),
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
    // A file-backed Blob (fs.openAsBlob) streams from disk; fetch sends either.
    bytes: Uint8Array | Blob;
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
      // An upload of a whole recording: long, but bounded.
      signal: AbortSignal.timeout(30 * 60_000),
    },
  );
  if (!res.ok)
    throw new RemoteError(
      `mediatek recording: ${res.status} ${res.statusText}`,
    );
  return (await res.json()) as { path: string; day: string; name: string };
}
