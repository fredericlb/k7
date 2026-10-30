// revisionMemo.test.ts — the token's walk is skipped only while a WATCHING feed stands still, and
// never past the ceiling; with a real capture, an edit on disk still moves the token. The project list
// leans on the same feed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveCapture } from "./liveCapture.ts";
import type { WalkedFile } from "./projectWalk.ts";
import {
  REVISION_WALK_ANYWAY_MS,
  RevisionMemo,
  type WatchingFeed,
} from "./revisionMemo.ts";
import { isBinary, skip, Workspace } from "./workspace.ts";

const file = (mtimeMs: number): WalkedFile => ({
  abs: "/p/a.k7x",
  size: 1,
  mtimeMs,
  binary: false,
  source: true,
});

/** A feed whose generation and watching the test moves by hand. */
const fakeFeed = (): WatchingFeed & { gen: number; on: boolean } => {
  const f = {
    gen: 0,
    on: true,
    root: "",
    get generation() {
      return f.gen;
    },
    get watching() {
      return f.on;
    },
    onChange: () => () => {},
  };
  return f;
};

describe("RevisionMemo", () => {
  it("walks every time without a feed", () => {
    const memo = new RevisionMemo(() => null);
    const walk = vi.fn(() => [file(1)]);
    memo.sources("/p", walk);
    memo.sources("/p", walk);
    expect(walk).toHaveBeenCalledTimes(2);
  });

  it("keeps the summary while the feed stands still, and walks once it moves", () => {
    const feed = fakeFeed();
    const memo = new RevisionMemo(() => feed);
    let mtime = 1;
    const walk = vi.fn(() => [file(mtime)]);
    expect(memo.sources("/p", walk).newest).toBe(1);
    mtime = 2;
    expect(memo.sources("/p", walk).newest).toBe(1);
    expect(walk).toHaveBeenCalledTimes(1);
    feed.gen++;
    expect(memo.sources("/p", walk).newest).toBe(2);
  });

  it("walks for another project, a feed that stopped watching, and past the ceiling", () => {
    const feed = fakeFeed();
    let now = 0;
    const memo = new RevisionMemo(
      () => feed,
      () => now,
    );
    const walk = vi.fn(() => [file(1)]);
    memo.sources("/p", walk);
    memo.sources("/q", walk);
    expect(walk).toHaveBeenCalledTimes(2);
    feed.on = false;
    memo.sources("/q", walk);
    expect(walk).toHaveBeenCalledTimes(3);
    feed.on = true;
    memo.sources("/q", walk);
    now += REVISION_WALK_ANYWAY_MS;
    memo.sources("/q", walk);
    expect(walk).toHaveBeenCalledTimes(5);
  });
});

describe("the project list over a still feed", () => {
  let root = "";
  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it("is kept past the window while nothing moved, and rescanned once something did", () => {
    root = mkdtempSync(join(tmpdir(), "projects-still-"));
    mkdirSync(join(root, "a.k7"));
    writeFileSync(join(root, "a.k7", "project.k7x"), 'project("a")\n');
    const ws = new Workspace(root);
    const feed = fakeFeed();
    ws.liveCapture = Object.assign(feed, { hold() {}, release() {} });
    const t0 = Date.now();
    vi.useFakeTimers({ now: t0, toFake: ["Date"] });
    expect(ws.workspaceInfo().projects).toEqual(["a.k7"]);
    mkdirSync(join(root, "b.k7"));
    writeFileSync(join(root, "b.k7", "project.k7x"), 'project("b")\n');
    vi.setSystemTime(t0 + 10_000);
    expect(ws.workspaceInfo().projects).toEqual(["a.k7"]);
    feed.gen++;
    expect(ws.workspaceInfo().projects).toEqual(["a.k7", "b.k7"]);
  });
});

describe("the token over a live capture", () => {
  let root = "";
  let capture: LiveCapture | null = null;
  afterEach(() => {
    capture?.stop();
    capture = null;
    rmSync(root, { recursive: true, force: true });
  });

  it("moves for an edit made on disk, heard through the feed", async () => {
    root = mkdtempSync(join(tmpdir(), "rev-memo-"));
    mkdirSync(join(root, "song.k7"));
    writeFileSync(join(root, "song.k7", "project.k7x"), 'project("t")\n');
    const ws = new Workspace(root);
    ws.setActiveProject("song.k7");
    capture = new LiveCapture({
      root,
      replica: "a",
      skip,
      isBinary,
      onBatch: () => {},
      quietMs: 20,
      reconcileMs: 0,
    });
    capture.start();
    ws.liveCapture = capture;
    const was = ws.revision().rev;
    expect(ws.revision().rev).toBe(was);
    await vi.waitFor(
      () => {
        writeFileSync(join(root, "song.k7", "graph.k7x"), "in -> out\n");
        expect(ws.revision().rev).not.toBe(was);
      },
      { timeout: 5000, interval: 50 },
    );
    // A write of this process: the poll that follows names the instant the write's reply named.
    const r = await ws.recordChange("edit", () =>
      ws.write("song.k7/graph.k7x", "in -> fx -> out\n"),
    );
    expect(ws.revision().rev).toBe(r.after);
  });
});
