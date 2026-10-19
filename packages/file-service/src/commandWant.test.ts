// `POST /command` builds the graph only when the caller will draw it.
//
// The cost never shows up in an answer: k7 runs mute, solo and every fader through a path that
// never refetches `/graph`, so an unconditional picture — 62 ms on the reference song, on the
// service's one thread — is built and dropped. A test reading only the reply passes either way,
// so this COUNTS the builds instead; an integer does not fluctuate (docs/audit-perf-web.md).
//
// It mounts the router rather than the server: `req.ws` and `req.userEmail` are what
// `resolveWorkspace` would have set, and this route needs no other gate.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeModule, writeNode } from "@studio/song/testSupport";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filesRouter } from "./routes/files.ts";
import { Workspace } from "./workspace.ts";

let root: string;
let ws: Workspace;
let server: ReturnType<express.Express["listen"]>;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "fs-want-"));
  const proj = join(root, "song.k7");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeDoc(join(proj, "project.k7x"), { project: { name: "song" } });
  writeDoc(join(proj, "graph.k7x"), {
    modules: { gtr: ["amp"], amp: ["OUT"] },
  });
  writeNode(proj, "gtr", { extends: "@meta/track", events: [] });
  writeModule(proj, "audio", "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  ws = new Workspace(root);
  ws.setActiveProject("song.k7");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const r = req as express.Request & { ws: Workspace; userEmail: string };
    r.ws = ws;
    r.userEmail = "a@b.c";
    next();
  });
  app.use(filesRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
});

const command = (body: Record<string, unknown>) =>
  fetch(`${base}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<{ graph?: unknown; rev?: string }>);

// A verb that WRITES: anything leaving the project untouched takes the `rev === before` branch.
const WRITES = "track mute gtr";

describe("POST /command — want", () => {
  it("builds the graph when the caller says nothing, exactly as before", async () => {
    const built = vi.spyOn(ws, "graphDoc");
    const r = await command({ line: WRITES });
    expect(built).toHaveBeenCalledTimes(1);
    expect(r.graph).toBeDefined();
  });

  it("builds none, and calls none, for a caller that asked for none", async () => {
    const built = vi.spyOn(ws, "graphDoc");
    const r = await command({ line: WRITES, want: [] });
    expect(built).not.toHaveBeenCalled(); // the point: not built, not merely not sent
    expect(r.graph).toBeUndefined();
    // …and the command really wrote, or the test would pass for the wrong reason.
    expect(r.rev).toBeTruthy();
  });

  it("answers with the new token either way — `rev` does not ride on the graph", async () => {
    const withGraph = await command({ line: WRITES });
    const without = await command({ line: WRITES, want: [] });
    expect(withGraph.rev).toBeTruthy();
    expect(without.rev).toBeTruthy();
    // Two writes, two different moments: the token is the project's, not the reply's shape.
    expect(without.rev).not.toBe(withGraph.rev);
  });

  it("still builds it for a caller that asks by name", async () => {
    const built = vi.spyOn(ws, "graphDoc");
    const r = await command({ line: WRITES, want: ["graph"] });
    expect(built).toHaveBeenCalledTimes(1);
    expect(r.graph).toBeDefined();
  });
});
