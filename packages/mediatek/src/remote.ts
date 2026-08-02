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
  /** e.g. https://media.studio.frediver.se */
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
