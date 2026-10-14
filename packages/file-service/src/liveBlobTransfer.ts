// liveBlobTransfer.ts — a replica's HTTP side of the blob store: is it there, send it, bring it down.
// Every transfer streams and RESUMES: an upload from the store's partial length, a download by Range into a kept partial.
// A download lands in the cache only once its sha256 is the one asked for. See ../../file-hub/docs/blobs.md.

import { createHash, type Hash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadable } from "node:stream/web";
import type { BlobCache } from "./liveBlobs.ts";

/** What a HEAD of a blob the store lacks answers when it keeps a partial upload of it: the bytes kept. */
export const PARTIAL_LENGTH_HEADER = "x-k7fs-partial-length";

/** The path segment of the libraries' store, which every account may read: `<blobs>/lib/<hash>`. */
export const SHARED_STORE = "lib";

/** The prefix a followed library's room is named by — the relay's SHARED_PREFIX (file-hub/syncRelay.ts). */
const SHARED_ROOM = "@lib/";

/** The relay's HTTP twin for blobs: `ws(s)://host/api/sync` → `http(s)://host/api/sync/blobs`. */
export const blobsUrl = (syncUrl: string): string =>
  `${syncUrl.replace(/^ws/, "http").replace(/\/+$/, "")}/blobs`;

/** Feed a file's first bytes into `sha`: a resumed transfer hashes what it kept before what it receives. */
async function hashFile(sha: Hash, file: string): Promise<void> {
  for await (const chunk of createReadStream(file)) sha.update(chunk as Buffer);
}

export class BlobTransfer {
  constructor(
    private readonly base: string,
    private readonly headers: Record<string, string>,
  ) {}

  /** The URL of blob `hash`: a workspace followed as `@lib/<name>` reads the libraries' store. */
  private url(hash: string, workspace?: string): string {
    return workspace?.startsWith(SHARED_ROOM)
      ? `${this.base}/${SHARED_STORE}/${hash}`
      : `${this.base}/${hash}`;
  }

  /** Whether the store holds `hash`, and how many bytes of a partial upload it keeps otherwise; throws when it cannot say. */
  private async head(hash: string): Promise<{ has: boolean; partial: number }> {
    const r = await fetch(this.url(hash), {
      method: "HEAD",
      headers: this.headers,
    });
    if (r.status === 404)
      return {
        has: false,
        partial: Number(r.headers.get(PARTIAL_LENGTH_HEADER) ?? 0) || 0,
      };
    if (!r.ok) throw new Error(`HEAD ${r.status}`);
    return { has: true, partial: 0 };
  }

  /** True when the store holds `hash`; throws when it cannot say. */
  async has(hash: string): Promise<boolean> {
    return (await this.head(hash)).has;
  }

  /** Send `file`'s bytes as blob `hash`, from whatever a previous attempt left on the store; it refuses bytes that are not. */
  async put(hash: string, file: string): Promise<void> {
    const at = await this.head(hash);
    if (at.has) return;
    const size = statSync(file).size;
    const offset = at.partial <= size ? at.partial : 0;
    const r = await fetch(`${this.url(hash)}?offset=${offset}`, {
      method: "PUT",
      headers: { ...this.headers, "content-type": "application/octet-stream" },
      body: Readable.toWeb(
        createReadStream(file, { start: offset }),
      ) as ReadableStream,
      duplex: "half",
    } as RequestInit);
    if (!r.ok) throw new Error(`PUT ${r.status}: ${await r.text()}`);
  }

  /** Bring blob `hash` into `cache`, verified, resuming a partial download; pass the workspace so a followed library reads its own store. */
  async get(hash: string, cache: BlobCache, workspace?: string): Promise<void> {
    const part = cache.partial(hash);
    const have = existsSync(part) ? statSync(part).size : 0;
    const r = await fetch(this.url(hash, workspace), {
      headers: have
        ? { ...this.headers, range: `bytes=${have}-` }
        : this.headers,
    });
    const sha = createHash("sha256");
    // Nothing past what is kept: the partial is the whole blob, or more than it.
    if (r.status === 416) {
      await hashFile(sha, part);
      return this.settle(sha, hash, part, cache);
    }
    if (!r.ok || !r.body) throw new Error(`GET ${r.status}`);
    const append = r.status === 206 && have > 0;
    if (append) await hashFile(sha, part);
    const hashing = new Transform({
      transform(chunk: Buffer, _enc, done) {
        sha.update(chunk);
        done(null, chunk);
      },
    });
    // A failure keeps the bytes that arrived: the next attempt asks for the rest.
    await pipeline(
      Readable.fromWeb(r.body as WebReadable),
      hashing,
      createWriteStream(part, { flags: append ? "a" : "w" }),
    );
    this.settle(sha, hash, part, cache);
  }

  /** Keep a complete partial under its hash, or drop it when its bytes are not the ones asked for. */
  private settle(
    sha: Hash,
    hash: string,
    part: string,
    cache: BlobCache,
  ): void {
    if (sha.digest("hex") !== hash) {
      rmSync(part, { force: true });
      throw new Error("the bytes do not match their hash");
    }
    cache.keep(part, hash);
  }
}
