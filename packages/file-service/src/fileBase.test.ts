// `PUT /file` with a base: the write is refused (409) when the file on disk is no longer the text
// the buffer was edited from, which is what keeps a stale autosave off a newer version. Without a
// base it writes as an older client always did.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { textHash } from "@studio/web-protocol/text-hash";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertBase, StaleBase } from "./fileBase.ts";
import { fileRouter } from "./routes/fileRoutes.ts";
import { Workspace } from "./workspace.ts";

describe("assertBase", () => {
  it("lets through a write with no base, or onto a missing file", () => {
    expect(() => assertBase(() => "x", "a", undefined, "m")).not.toThrow();
    expect(() => assertBase(() => null, "a", textHash("y"), "m")).not.toThrow();
  });

  it("refuses a base the disk no longer holds", () => {
    expect(() => assertBase(() => "new", "a", textHash("old"), "m")).toThrow(
      StaleBase,
    );
    expect(() =>
      assertBase(() => "old", "a", textHash("old"), "m"),
    ).not.toThrow();
  });

  it("takes a retry whose first try already landed as no conflict", () => {
    expect(() =>
      assertBase(() => "mine", "a", textHash("old"), "mine"),
    ).not.toThrow();
  });
});

describe("PUT /file", () => {
  let root: string;
  let server: ReturnType<express.Express["listen"]>;
  let base: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "fs-file-base-"));
    writeFileSync(join(root, "notes.txt"), "disk\n");
    const ws = new Workspace(root);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { ws: unknown }).ws = ws;
      next();
    });
    app.use(fileRouter);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    rmSync(root, { recursive: true, force: true });
  });

  const put = (body: object) =>
    fetch(`${base}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "notes.txt", ...body }),
    });
  const onDisk = () => readFileSync(join(root, "notes.txt"), "utf8");

  it("writes when the base is what is on disk", async () => {
    const r = await put({ content: "mine\n", base: textHash("disk\n") });
    expect(r.status).toBe(200);
    expect(onDisk()).toBe("mine\n");
  });

  it("answers 409 and leaves the newer file alone when the base is stale", async () => {
    const r = await put({ content: "mine\n", base: textHash("older\n") });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { stale?: boolean }).stale).toBe(true);
    expect(onDisk()).toBe("disk\n");
  });

  it("writes unchecked for a client that sends no base", async () => {
    const r = await put({ content: "mine\n" });
    expect(r.status).toBe(200);
    expect(onDisk()).toBe("mine\n");
  });
});
