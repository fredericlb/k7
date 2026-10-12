// blobTransfer.test.ts — a replica's side of the blob store against the real one: a download resumed from its
// kept partial, an upload resumed from the store's, and a followed library read from the libraries' store.

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobCache } from "@studio/file-service/src/liveBlobs.ts";
import { BlobTransfer } from "@studio/file-service/src/liveBlobTransfer.ts";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { blobsDir, blobsRouter } from "./blobStore.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function store() {
  const dataRoot = mkdtempSync(join(tmpdir(), "xfer-"));
  const app = express();
  let gets = 0;
  const ranges: string[] = [];
  app.use((req, _res, next) => {
    if (req.method === "GET") {
      gets++;
      ranges.push(String(req.headers.range ?? ""));
    }
    next();
  });
  app.use(
    "/blobs",
    blobsRouter({
      accountDir: (slug) => join(dataRoot, slug),
      accountOf: async (c) =>
        c.token === "tok" ? "acct" : c.secret === "lib" ? "_libraries" : null,
      sweepEveryMs: 0,
    }),
  );
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/blobs`;
  return { base, dataRoot, ranges, gets: () => gets };
}

describe("a replica's blob transfers", () => {
  it("resumes a download from the bytes it kept, and verifies the whole", async () => {
    const s = await store();
    const bytes = randomBytes(300_000);
    const h = sha(bytes);
    const me = new BlobTransfer(s.base, { authorization: "Bearer tok" });
    const file = join(s.dataRoot, "take.wav");
    writeFileSync(file, bytes);
    await me.put(h, file);
    const cache = new BlobCache(join(s.dataRoot, "cache"));
    writeFileSync(cache.partial(h), bytes.subarray(0, 100_000));
    await me.get(h, cache);
    expect(s.ranges.at(-1)).toBe("bytes=100000-");
    expect(readFileSync(cache.path(h)).equals(bytes)).toBe(true);
    expect(existsSync(cache.partial(h))).toBe(false);
    // A partial that is not a prefix of the blob is dropped once the whole fails its hash.
    const other = new BlobCache(join(s.dataRoot, "cache2"));
    writeFileSync(other.partial(h), randomBytes(100_000));
    await expect(me.get(h, other)).rejects.toThrow(/do not match/);
    expect(existsSync(other.partial(h))).toBe(false);
    await me.get(h, other);
    expect(other.has(h)).toBe(true);
  });

  it("resumes an upload from the partial the store kept", async () => {
    const s = await store();
    const bytes = randomBytes(200_000);
    const h = sha(bytes);
    const part = join(blobsDir(join(s.dataRoot, "acct")), "partial", h);
    mkdirSync(join(part, ".."), { recursive: true });
    writeFileSync(part, bytes.subarray(0, 150_000));
    const file = join(s.dataRoot, "take.wav");
    writeFileSync(file, bytes);
    const me = new BlobTransfer(s.base, { authorization: "Bearer tok" });
    expect(await me.has(h)).toBe(false);
    await me.put(h, file);
    expect(await me.has(h)).toBe(true);
    const cache = new BlobCache(join(s.dataRoot, "cache"));
    await me.get(h, cache);
    expect(readFileSync(cache.path(h)).equals(bytes)).toBe(true);
  });

  it("reads a followed library's blob from the libraries' store", async () => {
    const s = await store();
    const bytes = randomBytes(5000);
    const h = sha(bytes);
    const file = join(s.dataRoot, "ir.wav");
    writeFileSync(file, bytes);
    await new BlobTransfer(s.base, { "x-studio-hub-secret": "lib" }).put(
      h,
      file,
    );
    const me = new BlobTransfer(s.base, { authorization: "Bearer tok" });
    const cache = new BlobCache(join(s.dataRoot, "cache"));
    await expect(me.get(h, cache, "band")).rejects.toThrow(/404/);
    await me.get(h, cache, "@lib/st0");
    expect(readFileSync(cache.path(h)).equals(bytes)).toBe(true);
  });
});
