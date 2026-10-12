// blobStore.test.ts — the blob store over real HTTP: the gate, a verified PUT, HEAD and GET, and a refused mismatch.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { blobsDir, blobsRouter } from "./blobStore.ts";

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
        c.token === "tok" || c.secret === "sec" ? "acct" : null,
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
    expect(readdirSync(dir).filter((d) => d !== "tmp")).toEqual([]);
    expect(readdirSync(join(dir, "tmp"))).toEqual([]);
  });
});
