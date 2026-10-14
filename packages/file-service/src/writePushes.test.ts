// `PUT /file`, `POST /undo` and `POST /redo` push the project to the engine when they CHANGED it.
//
// The gap this pins: a command reaches the engine (through the host's `applyProject`) and so do
// `/open` and a reconnect (through `sendActiveProject`), but a plain write does none of them.
// Without this push, editing a clip's `from`/`to` in the editor moves the file, moves the
// revision and redraws every surface while the engine goes on playing the window it already has
// — until something restarts the link. "I have to restart it for the change to land."
//
// Counting SENDS rather than reading the reply, for the reason commandWant.test.ts does: the
// answer is identical either way, so only the engine-facing side can tell the two apart.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { writeModule, writeYaml } from "@studio/song/testSupport";
import express from "express";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** A stand-in engine that records the documents it is sent — the same shape clientProject.test.ts uses. */
const built: FakeClient[] = [];
class FakeClient {
  sent: ProjectDoc[] = [];
  constructor(
    readonly url: string,
    readonly session: string,
  ) {
    built.push(this);
  }
  on() {}
  connect() {}
  close() {}
  flush() {}
  dropSession() {}
  setAudioDevice() {}
  setInputStereo() {}
  transport() {}
  sendProject(doc: ProjectDoc) {
    this.sent.push(doc);
  }
}
vi.mock("@studio/engine-client/engineClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  EngineClient: FakeClient,
}));

const { filesRouter } = await import("./routes/files.ts");
const { Workspace } = await import("./workspace.ts");
const { setSelectedEngine } = await import("./engineLink.ts");

let root: string;
let proj: string;
let ws: InstanceType<typeof Workspace>;
let server: ReturnType<express.Express["listen"]>;
let base: string;

/** Everything sent so far. The link is cached per session, so a baseline beats clearing it. */
const sentCount = () => built.reduce((n, c) => n + c.sent.length, 0);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "fs-write-push-"));
  proj = join(root, "song.k7");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeFileSync(
    join(proj, "graph.yaml"),
    "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n",
    "utf8",
  );
  writeFileSync(
    join(proj, "nodes", "gtr.yaml"),
    'extends: "@meta/track"\nevents: []\n',
    "utf8",
  );
  writeModule(proj, "audio", "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  ws = new Workspace(root);
  ws.setActiveProject("song.k7");
  setSelectedEngine("ws://127.0.0.1:1/");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const r = req as express.Request & { ws: unknown; userEmail: string };
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

const write = (path: string, content: string) =>
  fetch(`${base}/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  }).then((r) => r.json());

it("pushes the project when a source write changes it", async () => {
  const before = sentCount();
  await write(
    "song.k7/nodes/gtr.yaml",
    'extends: "@meta/track"\nevents: []\n# edited\n',
  );
  expect(sentCount()).toBeGreaterThan(before);
});

it("pushes again for a second, different edit", async () => {
  await write(
    "song.k7/nodes/gtr.yaml",
    'extends: "@meta/track"\nevents: []\n# one\n',
  );
  const after1 = sentCount();
  await write(
    "song.k7/nodes/gtr.yaml",
    'extends: "@meta/track"\nevents: []\n# two\n',
  );
  expect(sentCount()).toBeGreaterThan(after1);
});

it("does NOT push for a write OUTSIDE the active project", async () => {
  // Why there are two gates: this write DOES move the token, so a token-only gate re-sent the whole song.
  const settled = sentCount();
  await write("_playlists/set.yaml", "title: set\nitems: []\n");
  expect(sentCount()).toBe(settled);
});

it("pushes a same-bytes rewrite too, because the token counts the mtime", async () => {
  // Stated rather than fixed: `POST /command` gates on the very same comparison (docs/fileRoutes.md).
  const text = 'extends: "@meta/track"\nevents: []\n# same\n';
  await write("song.k7/nodes/gtr.yaml", text);
  const settled = sentCount();
  await write("song.k7/nodes/gtr.yaml", text);
  expect(sentCount()).toBeGreaterThan(settled);
});

const step = (dir: "undo" | "redo") =>
  fetch(`${base}/${dir}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).then((r) => r.json() as Promise<{ applied?: boolean }>);

it("pushes after an undo and after a redo, which rewrite the project's files", async () => {
  // The bug this pins: an event restored by Ctrl+Z was on disk and on screen, and silent until the next edit.
  await write(
    "song.k7/nodes/gtr.yaml",
    'extends: "@meta/track"\nevents: []\n# to undo\n',
  );
  const beforeUndo = sentCount();
  expect((await step("undo")).applied).toBe(true);
  expect(sentCount()).toBeGreaterThan(beforeUndo);
  const beforeRedo = sentCount();
  expect((await step("redo")).applied).toBe(true);
  expect(sentCount()).toBeGreaterThan(beforeRedo);
});

it("does NOT push when there is nothing to undo", async () => {
  const settled = sentCount();
  expect((await step("redo")).applied).toBe(false);
  expect(sentCount()).toBe(settled);
});
