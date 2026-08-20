// `POST /command` builds the graph only when the caller will draw it.
//
// The field is one line in the route, and the whole reason it exists is a cost that does not
// show up in any answer: st0 runs mute, solo and every fader through a path that never refetches
// `/graph`, so the picture built inside those requests — 62 ms on the reference song, on the one
// thread the service has — was built and dropped. A test that only read the reply would pass
// either way, so this COUNTS the build instead, which is the method docs/audit-perf-web.md asks
// for: an integer does not fluctuate.
//
// It mounts the router rather than the whole server — the first test here to do so. `req.ws` and
// `req.userEmail` are what `resolveWorkspace` would have put there, and nothing else in this
// route needs the gates.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModule, writeYaml } from "@studio/song/testSupport";
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
  const proj = join(root, "song.st0");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeFileSync(
    join(proj, "graph.yaml"),
    "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n",
    "utf8",
  );
  writeFileSync(
    join(proj, "nodes", "gtr.yaml"),
    'extends: "@studio/track"\nevents: []\n',
    "utf8",
  );
  writeModule(proj, "audio", "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");

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

// A verb that WRITES — the same one the mixer's toggle runs. Anything that leaves the project
// untouched takes the `rev === before` branch and would prove nothing about `want`.
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
    // …and the command really wrote. Without this the test passes for the wrong reason: a line
    // that changed nothing takes the `rev === before` branch and skips the build on its own.
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
