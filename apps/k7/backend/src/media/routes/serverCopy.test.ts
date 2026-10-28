import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileHub } from "@studio/file-hub";
import { ensureLayout } from "@studio/mediatek/layout";
import { removeLibrary } from "@studio/mediatek/testLibrary";
import type { LibraryPlacement, MediatekEntry } from "@studio/mediatek/types";
import express, { type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEVICE_LIBRARY_ROUTE,
  deviceLibraryRouter,
  serverCopyRouter,
} from "./serverCopy.ts";

// The local volume is this process's; the "server" is a stub answering the device routes from fixed data.
let root: string;
let servers: Server[] = [];
let paired: boolean;

const listen = (app: express.Express): Promise<string> =>
  new Promise((ok) => {
    const s = app.listen(0, () =>
      ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`),
    );
    servers.push(s);
  });

const entry = (path: string): MediatekEntry => ({
  family: "samples",
  id: path,
  name: path.split("/").pop() ?? path,
  path,
  kind: "audio",
  mtime: 0,
});

async function stubServer(): Promise<string> {
  const app = express();
  app.use(DEVICE_LIBRARY_ROUTE, (req, res, next) =>
    req.headers.authorization === "Bearer dev-token"
      ? next()
      : res.status(401).end(),
  );
  app.get(`${DEVICE_LIBRARY_ROUTE}/list`, (_req, res) =>
    res.json({
      family: "samples",
      rev: "1",
      entries: [
        entry("samples/audio/kit/here.wav"),
        entry("samples/audio/kit/there.wav"),
      ],
      unlisted: [],
    }),
  );
  app.get(`${DEVICE_LIBRARY_ROUTE}/manifest`, (_req, res) =>
    res.json({
      family: "samples",
      rev: "1",
      files: [
        { path: "samples/audio/kit/here.wav", bytes: 4, mtime: 1 },
        { path: "samples/audio/kit/there.wav", bytes: 5, mtime: 1 },
      ],
    }),
  );
  app.get(`${DEVICE_LIBRARY_ROUTE}/file`, (req, res) =>
    res.send(`bytes of ${req.query.path}`),
  );
  return listen(app);
}

async function localBackend(remote: string): Promise<string> {
  const hub = {
    sync: {
      remoteOf: () =>
        paired
          ? {
              url: `${remote.replace(/^http/, "ws")}/api/sync`,
              token: "dev-token",
              user: "a@b",
            }
          : null,
    },
  } as unknown as FileHub;
  const app = express();
  app.use(express.json());
  app.use("/api/sync/library", serverCopyRouter(hub));
  return listen(app);
}

let local: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "server-copy-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  mkdirSync(join(root, "samples/audio/kit"), { recursive: true });
  writeFileSync(join(root, "samples/audio/kit/here.wav"), "here");
  writeFileSync(join(root, "samples/audio/kit/mine.wav"), "mine");
  paired = true;
  local = await localBackend(await stubServer());
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  servers = [];
  delete process.env.STUDIO_MEDIATEK;
  await removeLibrary(root);
});

const placement = async (): Promise<LibraryPlacement> =>
  (await (
    await fetch(`${local}/api/sync/library?family=samples`)
  ).json()) as LibraryPlacement;

describe("placing a paired machine's library", () => {
  it("says nothing when the account is not paired", async () => {
    paired = false;
    expect(await placement()).toMatchObject({ paired: false, synced: [] });
  });

  it("splits by path: both, and the server's alone", async () => {
    const p = await placement();
    expect(p.paired).toBe(true);
    expect(p.synced).toEqual(["samples/audio/kit/here.wav"]);
    expect(p.serverOnly.map((e) => e.path)).toEqual([
      "samples/audio/kit/there.wav",
    ]);
  });

  it("brings a server-only entry down, after which it is synced", async () => {
    const r = await fetch(`${local}/api/sync/library/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        family: "samples",
        path: "samples/audio/kit/there.wav",
      }),
    });
    expect(r.status).toBe(200);
    expect(
      readFileSync(join(root, "samples/audio/kit/there.wav"), "utf8"),
    ).toBe("bytes of samples/audio/kit/there.wav");
    expect((await placement()).serverOnly).toEqual([]);
  });

  it("refuses a path the server does not have", async () => {
    const r = await fetch(`${local}/api/sync/library/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ family: "samples", path: "samples/nope.wav" }),
    });
    expect(r.status).toBe(404);
  });

  it("brings a list down in one call and names what the server lacks", async () => {
    const r = await fetch(`${local}/api/sync/library/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        family: "samples",
        paths: ["samples/audio/kit/there.wav", "samples/nope.wav"],
      }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      files: 1,
      missing: ["samples/nope.wav"],
    });
    expect((await placement()).serverOnly).toEqual([]);
  });

  it("brings a whole folder down — an album — through its path", async () => {
    const r = await fetch(`${local}/api/sync/library/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ family: "samples", paths: ["samples/audio/kit"] }),
    });
    expect(r.status).toBe(200);
    expect(
      readFileSync(join(root, "samples/audio/kit/there.wav"), "utf8"),
    ).toBe("bytes of samples/audio/kit/there.wav");
  });
});

describe("the origin's library for a device", () => {
  const gate: RequestHandler = (req, res, next) =>
    req.headers.authorization ? next() : res.status(401).end();
  let origin: string;
  beforeEach(async () => {
    const app = express();
    app.use(DEVICE_LIBRARY_ROUTE, deviceLibraryRouter(gate));
    origin = await listen(app);
  });

  it("answers a read behind the gate, and nothing without it", async () => {
    const auth = { authorization: "Bearer x" };
    const ok = await fetch(
      `${origin}${DEVICE_LIBRARY_ROUTE}/list?family=samples`,
      {
        headers: auth,
      },
    );
    expect(ok.status).toBe(200);
    expect(
      (await fetch(`${origin}${DEVICE_LIBRARY_ROUTE}/list?family=samples`))
        .status,
    ).toBe(401);
  });

  it("refuses every write", async () => {
    const r = await fetch(`${origin}${DEVICE_LIBRARY_ROUTE}/file?path=x`, {
      method: "PUT",
      headers: { authorization: "Bearer x" },
      body: "x",
    });
    expect(r.status).toBe(405);
  });
});
