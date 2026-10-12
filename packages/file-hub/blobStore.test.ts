// blobStore.test.ts — the blob store over real HTTP: the gate, a verified PUT, HEAD and GET, a refused mismatch,
// the libraries' store every account reads, Range, a resumed upload, and the sweep of orphans.

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blobRef } from "@studio/live-sync/blob";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { blobsDir, blobsRouter } from "./blobStore.ts";
import { sweepBlobs } from "./blobSweep.ts";
import { roomDir } from "./syncRelay.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

async function store(maxBytes?: number) {
  const dataRoot = mkdtempSync(join(tmpdir(), "blobs-"));
  const app = express();
  app.use(
    "/api/sync/blobs",
    blobsRouter({
      accountDir: (slug) => join(dataRoot, slug),
      accountOf: async (c) =>
        c.token === "tok" || c.secret === "sec"
          ? "acct"
          : c.secret === "lib"
            ? "_libraries"
            : null,
      sweepEveryMs: 0,
      maxBytes,
    }),
  );
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sync/blobs`;
  return { base, dataRoot };
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const auth = { authorization: "Bearer tok" };

describe("the blob store", () => {
  it("refuses a caller with no account, and a name that is not a sha256", async () => {
    const { base } = await store();
    const h = sha(Buffer.from("x"));
    expect((await fetch(`${base}/${h}`, { method: "HEAD" })).status).toBe(401);
    expect(
      (
        await fetch(`${base}/${h}`, {
          headers: { "x-studio-hub-secret": "nope" },
        })
      ).status,
    ).toBe(401);
    expect((await fetch(`${base}/abc`, { headers: auth })).status).toBe(400);
  });

  it("stores bytes under their hash, answers HEAD and GET, and takes the same PUT twice", async () => {
    const { base, dataRoot } = await store();
    const bytes = randomBytes(300_000);
    const h = sha(bytes);
    expect(
      (await fetch(`${base}/${h}`, { method: "HEAD", headers: auth })).status,
    ).toBe(404);
    const put = () =>
      fetch(`${base}/${h}`, { method: "PUT", headers: auth, body: bytes });
    expect((await put()).status).toBe(201);
    expect((await put()).status).toBe(200);
    const head = await fetch(`${base}/${h}`, {
      method: "HEAD",
      headers: { "x-studio-hub-secret": "sec" },
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(bytes.length));
    const got = Buffer.from(
      await (await fetch(`${base}/${h}`, { headers: auth })).arrayBuffer(),
    );
    expect(got.equals(bytes)).toBe(true);
    const dir = blobsDir(join(dataRoot, "acct"));
    expect(existsSync(join(dir, h.slice(0, 2), h))).toBe(true);
    // A room is a folder under `.sync-relay`: the blobs must not be one.
    expect(existsSync(join(dataRoot, "acct", ".sync-relay"))).toBe(false);
  });

  it("refuses bytes that are not the ones named, and a body past the limit, keeping nothing", async () => {
    const { base, dataRoot } = await store(1000);
    const bytes = randomBytes(500);
    const wrong = sha(Buffer.from("other"));
    const r = await fetch(`${base}/${wrong}`, {
      method: "PUT",
      headers: auth,
      body: bytes,
    });
    expect(r.status).toBe(400);
    const big = randomBytes(5000);
    const r2 = await fetch(`${base}/${sha(big)}`, {
      method: "PUT",
      headers: auth,
      body: big,
    });
    expect(r2.status).toBe(413);
    const dir = blobsDir(join(dataRoot, "acct"));
    expect(readdirSync(dir).filter((d) => d !== "partial")).toEqual([]);
    expect(readdirSync(join(dir, "partial"))).toEqual([]);
  });
});

describe("the libraries' store", () => {
  it("is read by any account at /lib/<hash>, and written by the libraries' replica alone", async () => {
    const { base, dataRoot } = await store();
    const bytes = randomBytes(2000);
    const h = sha(bytes);
    const lib = { "x-studio-hub-secret": "lib" };
    expect(
      (
        await fetch(`${base}/lib/${h}`, {
          method: "PUT",
          headers: auth,
          body: bytes,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/lib/${h}`, {
          method: "PUT",
          headers: lib,
          body: bytes,
        })
      ).status,
    ).toBe(201);
    expect(
      existsSync(
        join(blobsDir(join(dataRoot, "_libraries")), h.slice(0, 2), h),
      ),
    ).toBe(true);
    // The account's own store does not hold it: only the libraries' path does.
    expect(
      (await fetch(`${base}/${h}`, { method: "HEAD", headers: auth })).status,
    ).toBe(404);
    expect(
      (await fetch(`${base}/lib/${h}`, { method: "HEAD", headers: auth }))
        .status,
    ).toBe(200);
    const got = Buffer.from(
      await (await fetch(`${base}/lib/${h}`, { headers: auth })).arrayBuffer(),
    );
    expect(got.equals(bytes)).toBe(true);
    expect((await fetch(`${base}/lib/${h}`)).status).toBe(401);
  });
});

describe("resumable transfers", () => {
  it("answers a Range with 206, and a range past the end with 416", async () => {
    const { base } = await store();
    const bytes = randomBytes(10_000);
    const h = sha(bytes);
    await fetch(`${base}/${h}`, { method: "PUT", headers: auth, body: bytes });
    const r = await fetch(`${base}/${h}`, {
      headers: { ...auth, range: "bytes=4000-" },
    });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 4000-9999/10000");
    expect(
      Buffer.from(await r.arrayBuffer()).equals(bytes.subarray(4000)),
    ).toBe(true);
    const mid = await fetch(`${base}/${h}`, {
      headers: { ...auth, range: "bytes=10-19" },
    });
    expect(
      Buffer.from(await mid.arrayBuffer()).equals(bytes.subarray(10, 20)),
    ).toBe(true);
    expect(
      (
        await fetch(`${base}/${h}`, {
          headers: { ...auth, range: "bytes=10000-" },
        })
      ).status,
    ).toBe(416);
  });

  it("keeps a cut upload's bytes, says how many, and completes from there", async () => {
    const { base, dataRoot } = await store();
    const bytes = randomBytes(200_000);
    const h = sha(bytes);
    // A body that dies half way, as a dropped connection does.
    const half = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.subarray(0, 120_000));
      },
      pull(c) {
        setTimeout(() => c.error(new Error("cut")), 50);
      },
    });
    await fetch(`${base}/${h}`, {
      method: "PUT",
      headers: auth,
      body: half,
      duplex: "half",
    } as RequestInit).catch(() => null);
    const part = join(blobsDir(join(dataRoot, "acct")), "partial", h);
    await until(() => existsSync(part) && statSync(part).size === 120_000);
    const head = await fetch(`${base}/${h}`, { method: "HEAD", headers: auth });
    expect(head.status).toBe(404);
    expect(head.headers.get("x-st0fs-partial-length")).toBe("120000");
    // An offset past what is kept is refused with the length to resume from.
    const ahead = await fetch(`${base}/${h}?offset=150000`, {
      method: "PUT",
      headers: auth,
      body: bytes.subarray(150_000),
    });
    expect(ahead.status).toBe(409);
    expect(ahead.headers.get("x-st0fs-partial-length")).toBe("120000");
    const rest = await fetch(`${base}/${h}?offset=120000`, {
      method: "PUT",
      headers: auth,
      body: bytes.subarray(120_000),
    });
    expect(rest.status).toBe(201);
    expect(existsSync(part)).toBe(false);
    const got = Buffer.from(
      await (await fetch(`${base}/${h}`, { headers: auth })).arrayBuffer(),
    );
    expect(got.equals(bytes)).toBe(true);
  });

  it("drops a resumed whole whose hash is not the one named", async () => {
    const { base, dataRoot } = await store();
    const bytes = randomBytes(1000);
    const h = sha(bytes);
    const dir = blobsDir(join(dataRoot, "acct"));
    mkdirSync(join(dir, "partial"), { recursive: true });
    writeFileSync(join(dir, "partial", h), randomBytes(500));
    const r = await fetch(`${base}/${h}?offset=500`, {
      method: "PUT",
      headers: auth,
      body: bytes.subarray(500),
    });
    expect(r.status).toBe(400);
    expect(existsSync(join(dir, "partial", h))).toBe(false);
  });
});

describe("the sweep of orphans", () => {
  it("removes an old blob no room names, and keeps named, young and history-only ones", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "blobs-"));
    const acct = join(dataRoot, "acct");
    const dir = blobsDir(acct);
    const put = (b: Buffer, old: boolean) => {
      const h = sha(b);
      mkdirSync(join(dir, h.slice(0, 2)), { recursive: true });
      writeFileSync(join(dir, h.slice(0, 2), h), b);
      if (old)
        utimesSync(join(dir, h.slice(0, 2), h), new Date(0), new Date(0));
      return h;
    };
    const current = put(Buffer.from("current"), true);
    const inHistory = put(Buffer.from("history"), true);
    const inConflict = put(Buffer.from("conflict"), true);
    const orphan = put(Buffer.from("orphan"), true);
    const young = put(Buffer.from("young"), false);
    const ref = (h: string, n: number) => blobRef(h, n);
    const room = roomDir(acct, "band");
    mkdirSync(join(room, "log"), { recursive: true });
    writeFileSync(
      join(room, "room.json"),
      JSON.stringify({
        head: 9,
        files: { "a.wav": ref(current, 7) },
        conflicts: [
          {
            id: "9.0",
            op: { kind: "text", file: "b.wav", text: ref(inConflict, 8) },
          },
        ],
      }),
    );
    writeFileSync(
      join(room, "log", "1.jsonl"),
      `${JSON.stringify({ seq: 1, batch: { ops: [{ kind: "text", file: "c.wav", text: ref(inHistory, 7) }] } })}\n`,
    );
    mkdirSync(join(dir, "partial"), { recursive: true });
    writeFileSync(join(dir, "partial", orphan), "x");
    utimesSync(join(dir, "partial", orphan), new Date(0), new Date(0));

    const gone = await sweepBlobs(dir, acct);
    expect(gone).toEqual([orphan]);
    for (const h of [current, inHistory, inConflict, young])
      expect(existsSync(join(dir, h.slice(0, 2), h))).toBe(true);
    expect(existsSync(join(dir, "partial", orphan))).toBe(false);
  });
});

async function until(f: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
