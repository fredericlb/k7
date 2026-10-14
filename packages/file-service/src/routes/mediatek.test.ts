// The cache shell's read side. It and apps/k7/backend's media routes carry MIME tables that must not drift:
// the two extensions asserted here are what such a drift costs — an .aiff or a .nam this side
// cannot serve, a cover the hosted side cannot.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLayout } from "@studio/mediatek/layout";
import { FAMILY_ERROR } from "@studio/mediatek/types";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mediatekRouter } from "./mediatek.ts";

let root: string;
let server: Server;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mediatek-cache-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  const app = express();
  // Mounted bare, the way server.ts does: these paths carry their own /mediatek prefix.
  app.use(mediatekRouter);
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const put = (rel: string, body = "x") => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
};

describe("GET /mediatek", () => {
  it("reports the cache, and says it is one", async () => {
    const r = await fetch(`${base}/mediatek`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { cached: boolean; root: string };
    expect(body.cached).toBe(true);
    expect(body.root).toBe(root);
  });
});

describe("GET /mediatek/file", () => {
  it("serves an AIFF as audio, which it could not before", async () => {
    put("samples/audio/kit/snare.aiff", "FORM");
    const r = await fetch(
      `${base}/mediatek/file?path=samples/audio/kit/snare.aiff`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/aiff");
  });

  it("serves an amp model as json, which it could not before", async () => {
    put("library/nam/fender.nam", "{}");
    const r = await fetch(`${base}/mediatek/file?path=library/nam/fender.nam`);
    expect(r.headers.get("content-type")).toBe("application/json");
  });

  it("still serves what it always could", async () => {
    put("samples/audio/kit/kick.wav", "RIFF");
    const r = await fetch(
      `${base}/mediatek/file?path=samples/audio/kit/kick.wav`,
    );
    expect(r.headers.get("content-type")).toBe("audio/wav");
  });

  // A path that escapes is the caller's mistake: 400, never 500 and never a file.
  it("refuses a path that escapes the cache root", async () => {
    const r = await fetch(`${base}/mediatek/file?path=../../secret`);
    expect(r.status).toBe(400);
  });

  it("answers 404 for a file that is not there", async () => {
    const r = await fetch(`${base}/mediatek/file?path=samples/audio/nope.wav`);
    expect(r.status).toBe(404);
  });

  it("requires a path at all", async () => {
    const r = await fetch(`${base}/mediatek/file`);
    expect(r.status).toBe(400);
  });
});

describe("GET /mediatek/list", () => {
  // The same sentence the hosted shell answers with — one constant, two witnesses.
  it("refuses a bogus family with the shared sentence", async () => {
    const r = await fetch(`${base}/mediatek/list?family=bogus`);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe(FAMILY_ERROR);
  });
});

describe("GET /mediatek/search", () => {
  it("clamps a greedy limit rather than refusing it", async () => {
    const r = await fetch(`${base}/mediatek/search?limit=99999`);
    expect(r.status).toBe(200);
    expect(
      Array.isArray(((await r.json()) as { entries: unknown[] }).entries),
    ).toBe(true);
  });
});
