// liveBlobTransfer.ts — a replica's HTTP side of the blob store: is it there, send it, bring it down.
// Every transfer streams, and a download lands in the cache only once its sha256 is the one asked for.
// See ../../file-hub/docs/blobs.md.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, rmSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadable } from "node:stream/web";
import type { BlobCache } from "./liveBlobs.ts";

/** The relay's HTTP twin for blobs: `ws(s)://host/api/sync` → `http(s)://host/api/sync/blobs`. */
export const blobsUrl = (syncUrl: string): string =>
  `${syncUrl.replace(/^ws/, "http").replace(/\/+$/, "")}/blobs`;

export class BlobTransfer {
  constructor(
    private readonly base: string,
    private readonly headers: Record<string, string>,
  ) {}

  /** True when the store holds `hash`; throws when it cannot say. */
  async has(hash: string): Promise<boolean> {
    const r = await fetch(`${this.base}/${hash}`, {
      method: "HEAD",
      headers: this.headers,
    });
    if (r.status === 404) return false;
    if (!r.ok) throw new Error(`HEAD ${r.status}`);
    return true;
  }

  /** Send `file`'s bytes as blob `hash`; the store refuses them when they are not. */
  async put(hash: string, file: string): Promise<void> {
    const r = await fetch(`${this.base}/${hash}`, {
      method: "PUT",
      headers: { ...this.headers, "content-type": "application/octet-stream" },
      body: Readable.toWeb(createReadStream(file)) as ReadableStream,
      duplex: "half",
    } as RequestInit);
    if (!r.ok) throw new Error(`PUT ${r.status}: ${await r.text()}`);
  }

  /** Bring blob `hash` into `cache`, verified; a 404 or a mismatch throws. */
  async get(hash: string, cache: BlobCache): Promise<void> {
    const r = await fetch(`${this.base}/${hash}`, { headers: this.headers });
    if (!r.ok || !r.body) throw new Error(`GET ${r.status}`);
    const tmp = cache.tmp();
    const sha = createHash("sha256");
    const hashing = new Transform({
      transform(chunk: Buffer, _enc, done) {
        sha.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(r.body as WebReadable),
        hashing,
        createWriteStream(tmp),
      );
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    if (sha.digest("hex") !== hash) {
      rmSync(tmp, { force: true });
      throw new Error("the bytes do not match their hash");
    }
    cache.keep(tmp, hash);
  }
}
